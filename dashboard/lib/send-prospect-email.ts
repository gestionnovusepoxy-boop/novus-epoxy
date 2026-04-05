import { sendEmail } from './send-email';

/**
 * Sends prospect/outreach emails via Gmail API (gestionnovusepoxy@gmail.com).
 * Gmail = real account, perfect deliverability, lands in inbox.
 * Reply-To: gestionnovusepoxy@gmail.com (Aria catches replies)
 */
export async function sendProspectEmail({
  to,
  subject,
  html,
  text,
  replyTo,
}: {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  idempotencyKey?: string;
  scheduledAt?: string;
}): Promise<{ id: string }> {
  return sendEmail({
    to,
    subject,
    html: html ?? text ?? '',
    replyTo: replyTo ?? 'gestionnovusepoxy@gmail.com',
    via: 'gmail',
  });
}
