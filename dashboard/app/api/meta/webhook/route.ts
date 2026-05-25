import { NextRequest, NextResponse } from 'next/server';
import { getAdminChatIds } from '@/lib/telegram-utils';
import { createHmac, timingSafeEqual } from 'crypto';
import { query } from '@/lib/db';
import { getOrCreateConversation, processMessage } from '@/lib/agent';
import { sendSMS } from '@/lib/sms';
import { SERVICES, type ServiceType, calculateQuote, formatMoney } from '@/lib/pricing';
import { escapeHtml } from '@/lib/utils';

// GET — Meta webhook verification (subscribe handshake)
export async function GET(req: NextRequest) {
  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN ?? '';
  const { searchParams } = new URL(req.url);
  const mode      = searchParams.get('hub.mode');
  const token     = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: 'Verification failed' }, { status: 403 });
}

// Verify Meta webhook signature (X-Hub-Signature-256)
function verifyMetaSignature(payload: string, signature: string | null): boolean {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) return true; // If secret not configured, allow through (cron sync is backup)
  if (!signature) return false;

  const expected = 'sha256=' + createHmac('sha256', appSecret).update(payload).digest('hex');
  try {
    const expBuf = Buffer.from(expected);
    const sigBuf = Buffer.from(signature);
    if (expBuf.length !== sigBuf.length) return false;
    return timingSafeEqual(expBuf, sigBuf);
  } catch {
    return false;
  }
}

// POST — Receive events from Meta (leadgen + messaging)
export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // Verify signature if META_APP_SECRET is configured
  const signature = req.headers.get('x-hub-signature-256');
  if (!verifyMetaSignature(rawBody, signature)) {
    console.error('Meta webhook signature verification failed');
    // Alert when signature is wrong (secret is set but signature doesn't match)
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatIds = getAdminChatIds();
    if (botToken && chatIds.length) {
      await Promise.all(chatIds.map(id =>
        fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: id.trim(),
            text: `🚨 <b>Meta webhook: signature incorrecte!</b>\n\nVérifier META_APP_SECRET dans Vercel.`,
            parse_mode: 'HTML',
          }),
        }).catch(() => {})
      ));
    }
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (body.object === 'page') {
    for (const entry of body.entry ?? []) {
      // Handle leadgen events
      for (const change of entry.changes ?? []) {
        if (change.field === 'leadgen') {
          await handleLeadgen(change);
        }
      }

      // Handle Messenger messages + postbacks (quick reply clicks)
      for (const msgEvent of entry.messaging ?? []) {
        if (msgEvent.postback?.payload === 'GET_STARTED') {
          await handleGetStarted(msgEvent);
        } else if (msgEvent.message?.text) {
          await handleMessengerMessage(msgEvent);
        } else if (msgEvent.postback?.payload) {
          const synth = { ...msgEvent, message: { text: msgEvent.postback.payload } };
          await handleMessengerMessage(synth);
        }
      }
    }
  }

  return NextResponse.json({ received: true });
}

// Map Facebook form field values to our service types
const FB_SERVICE_MAP: Record<string, ServiceType> = {
  'flocon': 'flake', 'flake': 'flake', 'flocon (flake)': 'flake',
  'metallique': 'metallique', 'métallique': 'metallique', 'metallic': 'metallique',
  'quartz': 'quartz',
  'couleur unie': 'couleur_unie', 'uni': 'couleur_unie',
  'antiderapant': 'antiderapant', 'antidérapant': 'antiderapant',
  'commercial': 'commercial', 'industriel': 'commercial',
  'meulage': 'meulage', 'meulage au diamant': 'meulage',
  'vinyl': 'vinyl_click', 'vinyl click': 'vinyl_click', 'plancher vinyl': 'vinyl_click', 'flottant': 'vinyl_click',
};

const FB_ESPACE_MAP: Record<string, string> = {
  'garage': 'Garage', 'sous-sol': 'Sous-sol', 'sous sol': 'Sous-sol', 'basement': 'Sous-sol',
  'balcon': 'Balcon', 'commercial': 'Commercial', 'industriel': 'Industriel',
  'entrepot': 'Entrepôt', 'entrepôt': 'Entrepôt',
};

function matchMap<T>(value: string, map: Record<string, T>): T | null {
  const lower = value.toLowerCase().trim();
  if (map[lower]) return map[lower];
  for (const [key, val] of Object.entries(map)) {
    if (lower.includes(key)) return val;
  }
  return null;
}

// Send Telegram notification to all admin chat IDs
async function notifyTelegramFacebookLead(nom: string, email: string, telephone: string | null, extra?: { service?: string; espace?: string; superficie?: number; adresse?: string; quoteId?: number; total?: number }) {
  // Leads FB = toujours notifier, pas de quiet hours (premier qui rappelle gagne)
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const groupId = (process.env.TELEGRAM_GROUP_CHAT_ID ?? '').trim();
  const adminIds = getAdminChatIds();
  const chatIds = groupId ? [groupId] : adminIds; // groupe en priorité
  if (!botToken || chatIds.length === 0) return;

  const lines = [
    `🔥 <b>Nouveau lead Facebook!</b>`,
    ``,
    `👤 ${escapeHtml(nom)}`,
    `📧 ${escapeHtml(email)}`,
    telephone ? `📞 ${escapeHtml(telephone)}` : '',
    extra?.espace ? `🏗 ${escapeHtml(extra.espace)}` : '',
    extra?.service ? `🔧 ${escapeHtml(extra.service)}` : '',
    extra?.superficie ? `📐 ${extra.superficie} pi²` : '',
    extra?.adresse ? `🏠 ${escapeHtml(extra.adresse)}` : '',
  ].filter(Boolean);

  if (extra?.quoteId && extra?.total) {
    lines.push('', `📋 <b>Devis #${extra.quoteId} créé automatiquement!</b>`, `💰 Total: ${formatMoney(extra.total)}`);
  } else {
    lines.push('', `<i>⚡ Contacte-le ASAP — premier rendu gagne!</i>`);
  }

  const buttons: Record<string, unknown> = extra?.quoteId
    ? { inline_keyboard: [[
        { text: '✅ Approuver devis', callback_data: `approve_quote_${extra.quoteId}` },
        { text: '📋 Voir dashboard', url: 'https://novus-epoxy.vercel.app/dashboard/devis' },
      ]] }
    : { inline_keyboard: [[
        { text: '📋 Voir CRM', url: 'https://novus-epoxy.vercel.app/dashboard/crm' },
      ]] };

  await Promise.all(chatIds.map(chatId =>
    fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId.trim(), text: lines.join('\n'), parse_mode: 'HTML', reply_markup: buttons }),
    }).catch(() => {})
  ));
}

// Handle Facebook Lead Ads
async function handleLeadgen(change: Record<string, unknown>) {
  const leadgenId = (change.value as Record<string, unknown>)?.leadgen_id;
  if (!leadgenId) return;

  const accessToken = process.env.META_PAGE_TOKEN;
  if (!accessToken) return;

  try {
    const leadRes = await fetch(
      `https://graph.facebook.com/v25.0/${leadgenId}?access_token=${accessToken}`,
    );
    if (!leadRes.ok) {
      // Token expiré ou erreur Meta — alerte critique Telegram
      const errData = await leadRes.json().catch(() => ({}));
      const errMsg = (errData as Record<string, Record<string, string>>).error?.message ?? `HTTP ${leadRes.status}`;
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const chatIds = getAdminChatIds();
      if (botToken && chatIds.length) {
        const alert = [
          `🚨 <b>LEAD FACEBOOK PERDU!</b>`,
          ``,
          `Un lead FB est arrivé mais impossible de le récupérer.`,
          `Lead ID: <code>${leadgenId}</code>`,
          `Erreur: ${errMsg}`,
          ``,
          `⚠️ <b>Token META_PAGE_TOKEN probablement expiré.</b>`,
          `Va dans Meta Business Suite → renouveler le token.`,
        ].join('\n');
        await Promise.all(chatIds.map(id =>
          fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: id.trim(), text: alert, parse_mode: 'HTML' }),
          }).catch(() => {})
        ));
      }
      return;
    }

    const leadData = await leadRes.json();
    const fields: Record<string, string> = {};
    for (const f of leadData.field_data ?? []) {
      fields[f.name] = Array.isArray(f.values) ? f.values[0] : f.values;
    }

    const nom       = fields.full_name ?? fields.first_name ?? 'Lead Facebook';
    const email     = fields.email ?? '';
    const telephone = (fields.phone_number ?? fields.phone ?? '').replace(/\D/g, '').slice(-10) || null;

    // Extract ALL form fields (service, superficie, espace, adresse)
    const serviceRaw = fields['quel_type_de_plancher_époxy_vous_intéresse?'] ?? fields.service ?? '';
    const service = matchMap(serviceRaw, FB_SERVICE_MAP) ?? (serviceRaw ? serviceRaw.slice(0, 120) : null);
    const espaceRaw = fields["quel_type_d'espace?"] ?? fields.espace ?? '';
    const espace = matchMap(espaceRaw, FB_ESPACE_MAP) ?? (espaceRaw ? espaceRaw.slice(0, 120) : null);
    const superficieRaw = fields['superficie_approximative_(pi²)?'] ?? fields.superficie ?? '';
    let superficie: string | null = superficieRaw ? superficieRaw.replace(/\s*(sf|pi2?|pi²|pieds?\s*carr[eé]s?|sqft|p2|pc)\s*$/i, '').trim() : null;
    if (superficie && /^\d+\s*x\s*\d+$/i.test(superficie)) {
      const parts = superficie.split(/x/i).map(s => parseFloat(s.trim()));
      superficie = String(Math.round(parts[0] * parts[1]));
    }
    const adresse = (fields['quel_est_votre_adresse_complete_des_travaux?'] ?? fields.street_address ?? fields.address ?? '').toString().trim().slice(0, 255) || null;
    // Try to extract ville from address (last word before postal code, or after last comma)
    let ville: string | null = null;
    if (adresse) {
      const parts = adresse.split(',').map((s: string) => s.trim());
      if (parts.length > 1) ville = parts[parts.length - 1].replace(/[A-Z]\d[A-Z]\s?\d[A-Z]\d/i, '').trim() || null;
    }

    if (!email && !telephone) return;

    // Build rich notes
    const noteParts = [
      `Lead Facebook Ad #${leadgenId}`,
      leadData.ad_name ? `Ad: ${leadData.ad_name}` : null,
      leadData.form_name ? `Form: ${leadData.form_name}` : null,
      espace ? `Espace: ${espace}` : null,
      service ? `Service: ${service}` : null,
      superficie ? `Superficie: ${superficie} pi²` : null,
      adresse ? `Adresse: ${adresse}` : null,
    ].filter(Boolean).join(' — ');

    // 1. Keep submission insert (backwards compat + quote generation)
    await query(
      `INSERT INTO submissions (nom, email, telephone, service, message, statut)
       VALUES ($1, $2, $3, $4, $5, 'nouveau')`,
      [
        nom.slice(0, 120),
        email.slice(0, 255) || 'no-email@facebook.lead',
        telephone,
        'Facebook Lead Ad',
        noteParts,
      ],
    );

    // 2. Insert into crm_leads with ALL fields (service, superficie, adresse, ville, espace)
    const crmResult = await query(
      `INSERT INTO crm_leads (nom, email, telephone, service, superficie, ville, adresse, source, statut, temperature, notes, type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (email) WHERE email IS NOT NULL AND email != '' DO NOTHING
       RETURNING id`,
      [
        nom.slice(0, 120),
        email.slice(0, 255) || null,
        telephone,
        service,
        superficie,
        ville,
        adresse,
        'facebook-leadad',
        'nouveau',
        'chaud',
        noteParts,
        'residential',
      ],
    );

    // Only notify + trigger Aria if this is a NEW lead (not a duplicate)
    const newLeadId = crmResult?.[0]?.id;
    if (newLeadId) {
      // 3. Telegram notification with full details
      await notifyTelegramFacebookLead(nom, email, telephone, { service: service ?? undefined, espace: espace ?? undefined, superficie: superficie ? Number(superficie) : undefined, adresse: adresse ?? undefined });

      // 4. SMS notification to Luca + Jason
      const smsMsg = `🔥 LEAD FB - Contacte ASAP! ${nom} - ${telephone ?? 'N/A'} - ${email}`;
      const adminPhone = process.env.ADMIN_PHONE;
      const jasonPhone = process.env.JASON_PHONE;
      if (adminPhone) sendSMS(adminPhone, smsMsg, undefined, true).catch(() => {});
      if (jasonPhone) sendSMS(jasonPhone, smsMsg, undefined, true).catch(() => {});

      // NOTE: Aria auto-contact DISABLED — Luca/Jason contactent les leads eux-mêmes
    }
  } catch (err) {
    console.error('Error processing Meta lead:', err);
  }
}

// Send welcome message when user clicks "Démarrer" on Messenger
async function handleGetStarted(event: Record<string, unknown>) {
  const sender = event.sender as Record<string, string>;
  if (!sender?.id) return;

  const senderId = sender.id;
  const accessToken = process.env.META_PAGE_TOKEN;
  if (!accessToken) return;

  // Create conversation
  await getOrCreateConversation('messenger', `fb_${senderId}`);

  // Send welcome message with quick replies (same as website widget)
  try {
    await fetch(`https://graph.facebook.com/v25.0/me/messages?access_token=${accessToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: senderId },
        message: {
          text: 'Bonjour! 👋 Quel type de plancher epoxy t\'interesse?',
          quick_replies: [
            { content_type: 'text', title: 'Flocon', payload: 'Flocon' },
            { content_type: 'text', title: 'Quartz', payload: 'Quartz' },
            { content_type: 'text', title: 'Metallique', payload: 'Metallique' },
            { content_type: 'text', title: 'Couleur unie', payload: 'Couleur unie' },
            { content_type: 'text', title: 'Commercial', payload: 'Commercial' },
          ],
        },
      }),
    });
  } catch (err) {
    console.error('Error sending welcome message:', err);
  }
}

// Detect quick replies to attach based on agent response (same logic as chat widget)
function getQuickReplies(reply: string): { content_type: string; title: string; payload: string }[] {
  const lower = reply.toLowerCase();

  if (lower.includes('quel espace') || lower.includes('quelle piece') || lower.includes('quel endroit') ||
      (lower.includes('garage') && lower.includes('sous-sol') && lower.includes('?'))) {
    return ['Garage', 'Sous-sol', 'Balcon', 'Commercial', 'Industriel'].map(t => ({
      content_type: 'text', title: t, payload: t,
    }));
  }

  if (lower.includes('etat') && (lower.includes('plancher') || lower.includes('beton') || lower.includes('sol'))) {
    return ['Beton brut', 'Bois', 'Peinture existante', 'Epoxy a refaire'].map(t => ({
      content_type: 'text', title: t, payload: t,
    }));
  }

  if ((lower.includes('quel type') || lower.includes('quel style') || lower.includes('quel fini')) && !lower.includes('espace')) {
    return ['Flocon', 'Quartz', 'Metallique', 'Couleur unie', 'Commercial'].map(t => ({
      content_type: 'text', title: t, payload: t,
    }));
  }

  return [];
}

// Handle Messenger messages — respond via the agent
async function handleMessengerMessage(event: Record<string, unknown>) {
  const sender = event.sender as Record<string, string>;
  const message = event.message as Record<string, string>;
  if (!sender?.id || !message?.text) return;

  const senderId = sender.id;
  const text = message.text;
  const accessToken = process.env.META_PAGE_TOKEN;

  // Get or create conversation for this Messenger user
  const conversationId = await getOrCreateConversation('messenger', `fb_${senderId}`);

  // Get user profile name from Meta (best effort)
  if (accessToken) {
    try {
      const convRows = await query(
        `SELECT visitor_name FROM conversations WHERE id = $1`, [conversationId]
      );
      if (!convRows[0]?.visitor_name) {
        const profileRes = await fetch(
          `https://graph.facebook.com/v25.0/${senderId}?fields=first_name,last_name&access_token=${accessToken}`
        );
        if (profileRes.ok) {
          const profile = await profileRes.json();
          const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ');
          if (name) {
            await query(`UPDATE conversations SET visitor_name = $1 WHERE id = $2`, [name, conversationId]);
          }
        }
      }
    } catch (err) { console.error('Failed to fetch Messenger profile:', err); }
  }

  // Process message through agent
  const reply = await processMessage(
    { conversationId, channel: 'messenger', visitorId: `fb_${senderId}` },
    text,
  );

  // Send reply back via Messenger with quick replies
  if (accessToken) {
    try {
      const quickReplies = getQuickReplies(reply);
      const msgPayload: Record<string, unknown> = { text: reply.slice(0, 2000) };
      if (quickReplies.length > 0) {
        msgPayload.quick_replies = quickReplies;
      }

      await fetch(`https://graph.facebook.com/v25.0/me/messages?access_token=${accessToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: senderId },
          message: msgPayload,
        }),
      });
    } catch (err) {
      console.error('Error sending Messenger reply:', err);
    }
  }
}
