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
  const formData = await req.formData();
  const from = formData.get('From') as string | null;
  const body = formData.get('Body') as string | null;

  if (!from || !body) {
    // Return valid TwiML even on error so Twilio doesn't retry
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { headers: { 'Content-Type': 'text/xml' } }
    );
  }

  // Normalize phone for DB lookup
  const cleaned = from.replace(/[^0-9]/g, '');
  const last10 = cleaned.slice(-10);

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

  // --- 4. Auto-acknowledge with personalized context ---
  const contactPerson = quoteId ? 'Luca' : 'Luca ou Jason';
  const greeting = prenom ? `Merci ${prenom}!` : 'Merci!';
  const autoReply = `${greeting} On a bien recu ton message. ${contactPerson} te rappelle dans les prochaines minutes. — Novus Epoxy`;

  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${autoReply}</Message></Response>`,
    { headers: { 'Content-Type': 'text/xml' } }
  );
}
