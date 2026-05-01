import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { sendSMS } from '@/lib/sms';

// Blacklisted phones — never notify about our own numbers
const BLACKLIST = ['5813075983', '5813072678'];

// Keywords for auto-parsing quote data from SMS
const SURFACE_KEYWORDS: Record<string, string> = {
  garage: 'Garage',
  'sous-sol': 'Sous-sol',
  'sous sol': 'Sous-sol',
  basement: 'Sous-sol',
  balcon: 'Balcon',
  patio: 'Patio',
  entree: 'Entrée',
  commercial: 'Commercial',
  entrepot: 'Entrepôt',
  warehouse: 'Entrepôt',
};

function parseQuoteData(text: string): string | null {
  const lower = text.toLowerCase();

  // Detect surface type
  let surfaceType: string | null = null;
  for (const [keyword, label] of Object.entries(SURFACE_KEYWORDS)) {
    if (lower.includes(keyword)) {
      surfaceType = label;
      break;
    }
  }

  // Detect square footage — look for numbers near pi2/pieds/sqft/sf/p2
  const sqftMatch = text.match(/(\d[\d\s.,]*)\s*(?:pi2|pi²|pieds?\s*carr[eé]s?|sqft|sf|p2|pc)/i)
    || text.match(/(?:pi2|pi²|pieds?\s*carr[eé]s?|sqft|sf|p2|pc)\s*[:\-]?\s*(\d[\d\s.,]*)/i);
  let sqft: string | null = null;
  if (sqftMatch) {
    sqft = (sqftMatch[1] || sqftMatch[2] || '').replace(/[\s,]/g, '').replace(/\.+$/, '');
  }

  // Also try standalone large numbers (likely square footage) if we have a surface type
  if (!sqft && surfaceType) {
    const numMatch = text.match(/\b(\d{2,5})\b/);
    if (numMatch) sqft = numMatch[1];
  }

  if (!surfaceType && !sqft) return null;

  const parts: string[] = [];
  if (surfaceType) parts.push(`Type: ${surfaceType}`);
  if (sqft) parts.push(`Surface: ~${sqft} pi²`);
  return `[SMS Auto-Parse] ${parts.join(', ')}`;
}

function isQuietHours(): boolean {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' }));
  const hour = now.getHours();
  return hour < 8 || hour >= 21;
}

// Twilio webhook — receives incoming SMS replies from clients
// Configure in Twilio console: Messaging > Phone Number > Webhook URL
// POST https://novus-epoxy.vercel.app/api/sms/incoming
export async function POST(req: NextRequest) {
  // Validate Twilio signature to prevent forged requests
  const twilioSignature = req.headers.get('x-twilio-signature') ?? '';
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken || !twilioSignature) {
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { status: 403, headers: { 'Content-Type': 'text/xml' } }
    );
  }
  // Twilio signature validation using HMAC-SHA1
  const { createHmac } = await import('crypto');
  const url = process.env.NEXTAUTH_URL
    ? `${process.env.NEXTAUTH_URL}/api/sms/incoming`
    : 'https://novus-epoxy.vercel.app/api/sms/incoming';
  const formData = await req.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => { params[key] = String(value); });
  const sortedParams = Object.keys(params).sort().reduce((acc, key) => acc + key + params[key], '');
  const expectedSig = createHmac('sha1', authToken).update(url + sortedParams).digest('base64');
  if (expectedSig !== twilioSignature) {
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { status: 403, headers: { 'Content-Type': 'text/xml' } }
    );
  }

  const from = params['From'] ?? null;
  const body = params['Body'] ?? '';
  const numMedia = parseInt(params['NumMedia'] ?? '0');

  if (!from) {
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { headers: { 'Content-Type': 'text/xml' } }
    );
  }

  // Normalize phone for DB lookup
  const cleaned = from.replace(/[^0-9]/g, '');
  const last10 = cleaned.slice(-10);

  // Log incoming SMS
  try {
    await query(
      `INSERT INTO sms_logs (direction, from_number, to_number, message, statut) VALUES ('inbound', $1, $2, $3, 'received')`,
      [from, process.env.TWILIO_PHONE_NUMBER || '', body]
    );
  } catch { /* log failed */ }

  // Check blacklist — ignore our own numbers
  if (BLACKLIST.includes(last10)) {
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { headers: { 'Content-Type': 'text/xml' } }
    );
  }

  // Try to find which client this is
  const leads = await query(
    `SELECT id, nom, telephone, email FROM crm_leads
     WHERE REPLACE(REPLACE(REPLACE(telephone, '-', ''), ' ', ''), '+', '') LIKE '%' || $1
     LIMIT 1`,
    [last10]
  );

  const quotes = await query(
    `SELECT id, client_nom, client_tel, client_email FROM quotes
     WHERE REPLACE(REPLACE(REPLACE(client_tel, '-', ''), ' ', ''), '+', '') LIKE '%' || $1
     ORDER BY created_at DESC LIMIT 1`,
    [last10]
  );

  const clientName = (leads[0]?.nom ?? quotes[0]?.client_nom ?? 'Inconnu') as string;
  const clientEmail = (leads[0]?.email ?? quotes[0]?.client_email ?? '') as string;
  const leadId = leads[0]?.id as number | undefined;
  const quoteId = quotes[0]?.id as number | undefined;

  // Extract prenom for personalized reply
  const prenom = clientName !== 'Inconnu' ? clientName.split(' ')[0] : '';

  // --- 0. Handle MMS photos (client sent photos of their floor) ---
  if (numMedia > 0) {
    const mediaUrls: string[] = [];
    for (let i = 0; i < numMedia; i++) {
      const url = params[`MediaUrl${i}`];
      if (url) mediaUrls.push(url);
    }

    if (mediaUrls.length > 0) {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const groupChatId = process.env.TELEGRAM_GROUP_CHAT_ID;
      const accountSid = process.env.TWILIO_ACCOUNT_SID;
      const authToken = process.env.TWILIO_AUTH_TOKEN;

      // Save photo URLs to quote in DB (add column if first time)
      await query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS photos JSONB DEFAULT '[]'`, []).catch(() => {});
      const photoEntries = mediaUrls.map(url => ({ url, received_at: new Date().toISOString(), from }));
      if (quoteId) {
        await query(
          `UPDATE quotes SET photos = COALESCE(photos, '[]'::jsonb) || $1::jsonb WHERE id = $2`,
          [JSON.stringify(photoEntries), quoteId]
        ).catch(() => {});
      }
      // If no quote yet, save to lead notes so they're not lost
      if (!quoteId && leadId) {
        const photoNote = `\n[PHOTOS MMS ${new Date().toLocaleDateString('fr-CA')}] ${mediaUrls.join(' | ')}`;
        await query(`UPDATE crm_leads SET notes = COALESCE(notes, '') || $1 WHERE id = $2`, [photoNote, leadId]).catch(() => {});
      }

      // Send each photo to Telegram group
      if (botToken && groupChatId && accountSid && authToken) {
        const caption = `📸 Photos de plancher — ${clientName} (${from})${quoteId ? ` — Devis #${quoteId}` : ''}`;
        const basicAuth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

        for (const url of mediaUrls) {
          try {
            // Download from Twilio (requires Basic auth)
            const imgRes = await fetch(url, { headers: { Authorization: `Basic ${basicAuth}` } });
            if (!imgRes.ok) continue;
            const imgBuffer = await imgRes.arrayBuffer();
            const contentType = imgRes.headers.get('content-type') || 'image/jpeg';

            // Upload directly to Telegram as binary
            const tgForm = new FormData();
            tgForm.append('chat_id', groupChatId);
            tgForm.append('photo', new Blob([imgBuffer], { type: contentType }), 'photo.jpg');
            tgForm.append('caption', caption);
            await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
              method: 'POST',
              body: tgForm,
            }).catch(() => {});
          } catch { /* skip failed photo */ }
        }
      }

      // Auto-reply to client
      const merciMsg = `Merci${prenom ? ` ${prenom}` : ''}! On a bien reçu vos photos. Notre équipe va les consulter pour finaliser votre soumission. — Novus Époxy`;
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${merciMsg}</Message></Response>`,
        { headers: { 'Content-Type': 'text/xml' } }
      );
    }
  }

  // --- 1. Update lead status to HOT when SMS received ---
  if (leadId) {
    // Parse SMS for quote data
    const parsedData = parseQuoteData(body);
    const noteEntry = `\n[SMS ${new Date().toLocaleDateString('fr-CA')}] ${body}${parsedData ? `\n${parsedData}` : ''}`;

    await query(
      `UPDATE crm_leads
       SET statut = 'contacte',
           temperature = 'chaud',
           notes = COALESCE(notes, '') || $1,
           updated_at = NOW()
       WHERE id = $2`,
      [noteEntry, leadId]
    ).catch(() => {});

    // Try to auto-create quote from SMS reply
    const { tryCreateQuoteFromReply } = await import('@/lib/auto-quote');
    await tryCreateQuoteFromReply(leadId, body).catch(err =>
      console.error('Auto-quote from SMS failed:', err)
    );
  }

  // --- 2. Priority Telegram notification with inline buttons ---
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const groupChatId = process.env.TELEGRAM_GROUP_CHAT_ID;

  if (botToken && groupChatId) {
    const msg = [
      `🔥🔥 LEAD CHAUD — ${clientName} a répondu par SMS!`,
      ``,
      `*Message:* ${body}`,
      `*Tél:* ${from}`,
      clientEmail ? `*Email:* ${clientEmail}` : '',
      leadId ? `*Lead CRM:* #${leadId}` : '',
      quoteId ? `*Devis:* #${quoteId}` : '',
    ].filter(Boolean).join('\n');

    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: '📞 Appeler maintenant', url: `tel:${from}` },
          { text: '📋 Voir CRM', url: 'https://novus-epoxy.vercel.app/dashboard/crm' },
        ],
      ],
    };

    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: groupChatId,
        text: msg,
        parse_mode: 'Markdown',
        reply_markup: inlineKeyboard,
      }),
    }).catch(() => {});
  }

  // --- 3. SMS notifications to Luca + Jason (respect quiet hours) ---
  if (!isQuietHours()) {
    const adminPhone = process.env.ADMIN_PHONE;
    const jasonPhone = process.env.JASON_PHONE;
    const truncatedBody = body.length > 100 ? body.slice(0, 100) + '...' : body;
    const smsAlert = `🔥 ${clientName} a repondu par SMS: '${truncatedBody}' — Rappelez MAINTENANT! Tel: ${from}`;

    const phones = [adminPhone, jasonPhone].filter(Boolean) as string[];
    await Promise.all(phones.map(phone => sendSMS(phone, smsAlert).catch(() => {}))).catch(() => {});
  }

  // --- 4. Smart auto-reply based on what the client said ---
  const greeting = prenom ? `Merci ${prenom}!` : 'Merci!';
  const lower = body.toLowerCase();

  // Detect intent from message
  const wantsQuote = lower.includes('soumission') || lower.includes('devis') || lower.includes('prix') || lower.includes('combien') || lower.includes('cout') || lower.includes('coût') || lower.includes('estimation') || lower.includes('estimé');
  const hasQuestion = body.includes('?') || lower.includes('est-ce') || lower.includes('est ce') || lower.includes('comment') || lower.includes('quand') || lower.includes('disponible');
  const isPositive = lower.includes('oui') || lower.includes('ok') || lower.includes('interesse') || lower.includes('intéressé') || lower.includes('parfait') || lower.includes('super') || lower.includes("j'aimerais") || lower.includes('je veux') || lower.includes('je voudrais');
  const isNegative = lower.includes('pas interesse') || lower.includes('pas intéressé');
  const isOptOut = lower === 'stop' || lower === 'arret' || lower === 'arreter' || lower === 'arrêter' || lower === 'desabonner' || lower === 'désabonner' || lower.includes('arretez') || lower.includes('arrêtez') || lower.includes('ne me contactez plus') || lower.includes('plus de message') || lower.includes('plus de texto') || lower.includes('laisser tranquille');

  let autoReply: string;
  if (isOptOut) {
    // Opt-out: save to DB so we NEVER contact this person again
    const phone = from.startsWith('+') ? from : `+1${last10}`;
    await query(
      `INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`,
      [`sms_optout_${phone}`, JSON.stringify({ phone: from, date: new Date().toISOString(), message: body })]
    ).catch(() => {});

    // Also update lead status if exists
    if (leadId) {
      await query(`UPDATE crm_leads SET statut = 'ferme', notes = COALESCE(notes, '') || $1, updated_at = NOW() WHERE id = $2`,
        [`\n[OPT-OUT SMS ${new Date().toLocaleDateString('fr-CA')}] Client a demande de ne plus etre contacte.`, leadId]
      ).catch(() => {});
    }

    autoReply = `Votre demande est respectee. Vous ne recevrez plus de messages de Novus Epoxy. Si vous changez d'avis, ecrivez-nous a gestionnovusepoxy@gmail.com. Bonne journee!`;
  } else if (isNegative) {
    autoReply = `${greeting} Aucun probleme, on respecte votre choix. Si jamais vous changez d'idee, n'hesitez pas a nous recontacter! — Novus Epoxy`;
  } else if (wantsQuote || isPositive) {
    autoReply = `${greeting} Parfait! Pour vous envoyer une soumission gratuite, on a besoin de: 1) Type de surface (garage, sous-sol, balcon...) 2) Superficie estimee en pi2 3) Votre adresse 4) Votre courriel. Repondez ici et on vous prepare ca! — Novus Epoxy`;
  } else if (hasQuestion) {
    autoReply = `${greeting} Bonne question! Un de nos specialistes va vous repondre tres bientot. En attendant, si vous voulez une soumission gratuite, envoyez-nous: le type de surface, la superficie en pi2, votre adresse et courriel. — Novus Epoxy`;
  } else {
    autoReply = `${greeting} On a bien recu votre message! Voulez-vous une soumission gratuite? Si oui, repondez avec: 1) Type de surface (garage, sous-sol, balcon...) 2) Superficie estimee en pi2 3) Votre adresse 4) Votre courriel. — Novus Epoxy`;
  }

  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${autoReply}</Message></Response>`,
    { headers: { 'Content-Type': 'text/xml' } }
  );
}
