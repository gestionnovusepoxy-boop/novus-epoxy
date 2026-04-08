import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Twilio incoming SMS webhook — handles STOP/START opt-out + forwards to admins
// Configure in Twilio console: Messaging > Phone Number > Webhook URL
// POST https://novus-epoxy.vercel.app/api/sms/webhook

const STOP_WORDS = ['stop', 'arret', 'arrêt', 'unsubscribe', 'desabonner', 'désabonner'];
const START_WORDS = ['start', 'debut', 'début', 'subscribe', 'reabonner', 'réabonner'];

function twiml(message: string): NextResponse {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`;
  return new NextResponse(xml, { headers: { 'Content-Type': 'text/xml' } });
}

function emptyTwiml(): NextResponse {
  return new NextResponse(
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    { headers: { 'Content-Type': 'text/xml' } }
  );
}

export async function POST(req: NextRequest) {
  try {
    // EMERGENCY: return empty TwiML to stop all auto-replies and loops
    return emptyTwiml();

    const formData = await req.formData();
    const from = formData.get('From') as string | null;
    const body = formData.get('Body') as string | null;

    if (!from || !body) {
      return emptyTwiml();
    }

    // Normalize phone
    const cleaned = from.replace(/[^0-9+]/g, '');
    const phone = cleaned.startsWith('+') ? cleaned : cleaned.startsWith('1') ? `+${cleaned}` : `+1${cleaned}`;
    const msgLower = body.trim().toLowerCase();

    // --- STOP / Opt-out ---
    if (STOP_WORDS.some(w => msgLower === w || msgLower.startsWith(w + ' '))) {
      await query(
        `INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
        ['sms_optout_' + phone, 'true']
      );
      console.log(`[SMS Webhook] Opt-out enregistre pour ${phone}`);
      return twiml('Vous avez ete desabonne des messages de Novus Epoxy. Pour vous reabonner, ecrivez START.');
    }

    // --- START / Re-subscribe ---
    if (START_WORDS.some(w => msgLower === w || msgLower.startsWith(w + ' '))) {
      await query(
        `DELETE FROM kv_store WHERE key = $1`,
        ['sms_optout_' + phone]
      );
      console.log(`[SMS Webhook] Re-abonnement pour ${phone}`);
      return twiml('Vous etes reabonne aux messages de Novus Epoxy.');
    }

    // --- Forward all other messages to Telegram admins ---
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatIds = (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

    if (botToken && chatIds.length > 0) {
      // Try to identify the client
      const leads = await query(
        `SELECT id, nom FROM crm_leads
         WHERE REPLACE(REPLACE(REPLACE(telephone, '-', ''), ' ', ''), '+', '') LIKE '%' || $1
         LIMIT 1`,
        [cleaned.slice(-10)]
      ).catch(() => [] as Record<string, unknown>[]);

      const clientName = (leads[0]?.nom as string) ?? 'Inconnu';

      const msg = [
        `\u{1F4F1} <b>SMS entrant</b>`,
        ``,
        `\u{1F464} ${clientName}`,
        `\u{1F4DE} ${from}`,
        ``,
        `\u{1F4AC} ${body}`,
      ].join('\n');

      await Promise.all(chatIds.map(chatId =>
        fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML' }),
        }).catch(() => {})
      ));
    }

    return twiml("Merci pour votre message! L'equipe Novus Epoxy vous repondra sous peu. Luca: 581-307-5983");
  } catch (err) {
    console.error('[SMS Webhook] Error:', err);
    return emptyTwiml();
  }
}
