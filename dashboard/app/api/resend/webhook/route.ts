import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Resend webhook — tracks delivery, bounces, failures
// Configure at resend.com/webhooks → URL: https://novus-epoxy.vercel.app/api/resend/webhook

const BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN ?? '';
const ADMIN_CHAT_IDS = () =>
  (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

async function sendTelegram(chatId: string, text: string) {
  const token = BOT_TOKEN();
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  }).catch(() => {});
}

async function retryEmail(emailId: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;

  // Get the original email details from email_logs
  const logs = await query(
    `SELECT destinataire, sujet FROM email_logs WHERE resend_id = $1 LIMIT 1`,
    [emailId]
  );

  if (logs.length === 0) return false;

  // Resend doesn't have a native retry — we'd need to re-send
  // For now, just log and alert. The original email content isn't stored.
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const eventType = body.type as string;
    const data = body.data ?? {};

    const emailId = data.email_id as string ?? '';
    const to = (data.to as string[])?.join(', ') ?? data.to ?? '';
    const subject = data.subject as string ?? '';
    const from = data.from as string ?? '';
    const reason = data.bounce?.message ?? data.reason ?? '';

    console.log(`[Resend Webhook] ${eventType} — to: ${to}, subject: ${subject?.slice(0, 50)}`);

    // Update email_logs status
    if (emailId) {
      const statusMap: Record<string, string> = {
        'email.sent': 'sent',
        'email.delivered': 'delivered',
        'email.bounced': 'bounced',
        'email.complained': 'complained',
        'email.delivery_delayed': 'delayed',
        'email.opened': 'opened',
        'email.clicked': 'clicked',
      };

      const newStatus = statusMap[eventType];
      if (newStatus) {
        await query(
          `UPDATE email_logs SET statut = $1 WHERE resend_id = $2`,
          [newStatus, emailId]
        ).catch(() => {});
      }
    }

    // Handle failures — alert + retry logic
    if (eventType === 'email.bounced' || eventType === 'email.complained') {
      // Alert admins
      for (const chatId of ADMIN_CHAT_IDS()) {
        await sendTelegram(chatId,
          `🔴 <b>Email ${eventType === 'email.bounced' ? 'BOUNCE' : 'PLAINTE'}</b>\n\n` +
          `📧 To: ${to}\n` +
          `📝 Sujet: ${subject}\n` +
          `📤 From: ${from}\n` +
          (reason ? `❌ Raison: ${reason}\n` : '') +
          `\n⚠️ Ce destinataire ne recevra plus d'emails automatiquement.`
        );
      }

      // Mark lead as bad email if exists in CRM
      if (to) {
        const toEmail = Array.isArray(data.to) ? data.to[0] : to;
        await query(
          `UPDATE crm_leads SET notes = COALESCE(notes, '') || $1, updated_at = NOW() WHERE LOWER(email) = LOWER($2)`,
          [`\n[BOUNCE ${new Date().toISOString().slice(0, 10)}] ${reason}`, toEmail]
        ).catch(() => {});
      }
    }

    if (eventType === 'email.delivery_delayed') {
      // Alert on delay — might need retry
      for (const chatId of ADMIN_CHAT_IDS()) {
        await sendTelegram(chatId,
          `⚠️ <b>Email retarde</b>\n\n` +
          `📧 To: ${to}\n` +
          `📝 Sujet: ${subject}\n` +
          `Resend va reessayer automatiquement.`
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[Resend Webhook] Error:', err);
    return NextResponse.json({ ok: true }); // Always return 200 to avoid Resend retrying
  }
}
