import { getAdminChatIds } from '@/lib/telegram-utils';
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getOrCreateConversation, processMessage } from '@/lib/agent';
import { isQuietHours } from '@/lib/telegram-utils';

// Twilio incoming SMS webhook — handles STOP/START opt-out + AI replies via Nova
// Configure in Twilio console: Messaging > Phone Number > Webhook URL
// POST https://novus-epoxy.vercel.app/api/sms/webhook

const STOP_WORDS = ['stop', 'arret', 'arrêt', 'unsubscribe', 'desabonner', 'désabonner'];
const START_WORDS = ['start', 'debut', 'début', 'subscribe', 'reabonner', 'réabonner'];

// Anti-loop: never auto-reply to these patterns (carrier auto-replies, bounces, spam traps)
const IGNORE_PATTERNS = [
  'sorry', 'not able to receive', 'cannot receive', 'unable to receive',
  'this number is not in service', 'no longer in service', 'wrong number',
  'do not reply', 'ne pas repondre', 'ne pas répondre',
  'message automatique', 'auto-reply', 'autoreply', 'out of office',
  'delivery failure', 'undeliverable', 'invalid number',
];

// Our own numbers — NEVER respond to ourselves
const OWN_NUMBERS = [
  process.env.TWILIO_PHONE_NUMBER ?? '+15817014055',
  '+15817014055',
  '+15813075983', // Luca
  '+15813072678', // Jason
];

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

    // --- ANTI-LOOP: never reply to our own numbers ---
    if (OWN_NUMBERS.some(n => phone === n || cleaned.endsWith(n.replace(/\D/g, '').slice(-10)))) {
      console.log(`[SMS Webhook] Anti-loop: ignoring message from our own number ${phone}`);
      return emptyTwiml();
    }

    // --- ANTI-LOOP: ignore carrier auto-replies, bounce messages, "sorry" etc ---
    if (IGNORE_PATTERNS.some(p => msgLower.includes(p))) {
      console.log(`[SMS Webhook] Anti-loop: ignoring auto-reply/bounce from ${phone}: "${body.slice(0, 50)}"`);
      return emptyTwiml();
    }

    // --- ANTI-LOOP: rate limit — don't reply if we already replied to this number in last 30 min ---
    const recentReply = await query(
      `SELECT id FROM sms_logs WHERE to_number = $1 AND direction IN ('outbound_webhook', 'outbound') AND created_at > NOW() - INTERVAL '30 minutes' LIMIT 1`,
      [phone]
    ).catch(() => []);
    if (recentReply.length > 0) {
      console.log(`[SMS Webhook] Anti-loop: already replied to ${phone} in last 30min, skipping auto-reply`);
      // Still forward to Telegram, just don't auto-reply
      await forwardToTelegram(from, body, cleaned);
      return emptyTwiml();
    }

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

    // --- Save inbound SMS to DB so Luca can see client replies ---
    await query(
      `INSERT INTO sms_logs (direction, from_number, to_number, message, statut)
       VALUES ('inbound', $1, $2, $3, 'received')`,
      [phone, process.env.TWILIO_PHONE_NUMBER ?? '+15817014055', body.slice(0, 1000)]
    ).catch(() => {});

    // --- Forward to Telegram admins ---
    await forwardToTelegram(from, body, cleaned);

    // --- AI Reply via Nova agent ---
    let aiReply = "Merci pour votre message! L'equipe Novus Epoxy vous repondra sous peu. Luca: 581-307-5983";
    try {
      const conversationId = await getOrCreateConversation('sms', `sms_${phone}`);
      const novaReply = await processMessage(
        { conversationId, channel: 'sms', visitorId: `sms_${phone}` },
        body,
      );
      if (novaReply && novaReply.length > 5) {
        // Truncate to 320 chars for SMS (2 segments max)
        aiReply = novaReply.slice(0, 320);
      }
    } catch (err) {
      console.error('[SMS Webhook] Nova AI failed, using fallback:', err);
    }

    // Log the auto-reply so rate limiting works
    await query(
      `INSERT INTO sms_logs (direction, from_number, to_number, message, statut) VALUES ('outbound_webhook', $1, $2, $3, 'sent')`,
      [process.env.TWILIO_PHONE_NUMBER ?? '+15817014055', phone, aiReply]
    ).catch(() => {});

    return twiml(aiReply);
  } catch (err) {
    console.error('[SMS Webhook] Error:', err);
    return emptyTwiml();
  }
}

async function forwardToTelegram(from: string, body: string, cleaned: string) {
  if (isQuietHours()) return;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const groupId = (process.env.TELEGRAM_GROUP_CHAT_ID ?? '').trim();
  const adminIds = getAdminChatIds();
  const chatIds = groupId ? [groupId] : adminIds;

  if (!botToken || chatIds.length === 0) return;

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
