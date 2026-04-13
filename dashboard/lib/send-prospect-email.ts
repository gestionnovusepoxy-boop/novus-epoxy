/**
 * Sends prospect/outreach emails via Gmail API (gestionnovusepoxy@gmail.com).
 * Gmail delivers to inbox, not spam — unlike Resend for cold email.
 * Limit: 75 emails/day to stay safe with Gmail quotas.
 */
import { google } from 'googleapis';

export async function sendProspectEmail({
  to,
  subject,
  html,
  text,
}: {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  idempotencyKey?: string;
  scheduledAt?: string;
}): Promise<{ id: string }> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Gmail credentials missing');
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  const content = html || (text ? text.split('\n').map(l => l.trim() ? `<p style="margin:0 0 8px;">${l}</p>` : '').join('') : '');

  const headerLines = [
    'From: Novus Epoxy <gestionnovusepoxy@gmail.com>',
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
  ].join('\r\n');

  const raw = `${headerLines}\r\n\r\n${content}`;
  const encoded = Buffer.from(raw).toString('base64url');

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encoded },
  });

  return { id: res.data.id ?? `gmail-${Date.now()}` };
}
