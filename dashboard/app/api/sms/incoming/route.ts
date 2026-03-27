import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

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
  const phoneVariants = [from, `+${cleaned}`, `+1${cleaned.slice(-10)}`, cleaned.slice(-10)];

  // Try to find which client this is
  const leads = await query(
    `SELECT id, nom, telephone, email FROM crm_leads
     WHERE REPLACE(REPLACE(REPLACE(telephone, '-', ''), ' ', ''), '+', '') LIKE '%' || $1
     LIMIT 1`,
    [cleaned.slice(-10)]
  );

  const quotes = await query(
    `SELECT id, client_nom, client_tel, client_email FROM quotes
     WHERE REPLACE(REPLACE(REPLACE(client_tel, '-', ''), ' ', ''), '+', '') LIKE '%' || $1
     ORDER BY created_at DESC LIMIT 1`,
    [cleaned.slice(-10)]
  );

  const clientName = (leads[0]?.nom ?? quotes[0]?.client_nom ?? 'Inconnu') as string;
  const clientEmail = (leads[0]?.email ?? quotes[0]?.client_email ?? '') as string;
  const leadId = leads[0]?.id as number | undefined;
  const quoteId = quotes[0]?.id as number | undefined;

  // Notify via Telegram
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').filter(Boolean);

  if (botToken && chatIds.length > 0) {
    const msg = [
      `📱 *Réponse SMS reçue!*`,
      ``,
      `*De:* ${clientName}`,
      `*Tél:* ${from}`,
      clientEmail ? `*Email:* ${clientEmail}` : '',
      leadId ? `*Lead CRM:* #${leadId}` : '',
      quoteId ? `*Devis:* #${quoteId}` : '',
      ``,
      `*Message:*`,
      body,
      ``,
      quoteId ? `[Voir le devis](https://novus-epoxy.vercel.app/dashboard/devis/${quoteId})` : '',
    ].filter(Boolean).join('\n');

    await Promise.all(chatIds.map(chatId =>
      fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId.trim(), text: msg, parse_mode: 'Markdown' }),
      }).catch(() => {})
    ));
  }

  // Log in DB if we have a lead
  if (leadId) {
    await query(
      `UPDATE crm_leads SET notes = COALESCE(notes, '') || $1, updated_at = NOW() WHERE id = $2`,
      [`\n[SMS ${new Date().toLocaleDateString('fr-CA')}] ${body}`, leadId]
    ).catch(() => {});
  }

  // Auto-reply + notify Luca & Jason
  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Merci pour ton message! Luca ou Jason te revient tres bientot. A+! — Novus Epoxy</Message></Response>`,
    { headers: { 'Content-Type': 'text/xml' } }
  );
}
