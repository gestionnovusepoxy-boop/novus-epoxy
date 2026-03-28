import { google } from 'googleapis';

/**
 * Sends prospect/outreach emails via Gmail API.
 * Display name: "Jason — Novus Epoxy"
 * From: gestionnovusepoxy@gmail.com (Gmail API — reliable delivery)
 * Reply-To: gestionnovusepoxy@gmail.com (so Aria catches replies)
 *
 * Previously used Hostinger SMTP (jason@novusepoxy.shop) but domain DNS
 * was not configured (SPF/DKIM missing), so emails never arrived.
 */
export async function sendProspectEmail({
  to,
  subject,
  html,
  replyTo,
}: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
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

  const fromHeader = 'Jason — Novus Epoxy <gestionnovusepoxy@gmail.com>';

  const headerLines = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Reply-To: ${replyTo ?? 'gestionnovusepoxy@gmail.com'}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
  ].join('\r\n');

  const raw = `${headerLines}\r\n\r\n${html}`;
  const encoded = Buffer.from(raw).toString('base64url');

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encoded },
  });

  return { id: res.data.id ?? `gmail-${Date.now()}` };
}
