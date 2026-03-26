import { google } from 'googleapis';

/**
 * Sends an email FROM gestionnovusepoxy@gmail.com via Gmail API.
 * Returns { id } for compatibility with email_logs inserts.
 */
export async function sendEmail({
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
    throw new Error('Gmail credentials missing (GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN)');
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  const fromHeader = 'Novus Epoxy <gestionnovusepoxy@gmail.com>';

  const headerLines = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    replyTo ? `Reply-To: ${replyTo}` : null,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
  ]
    .filter(Boolean)
    .join('\r\n');

  const raw = `${headerLines}\r\n\r\n${html}`;
  const encoded = Buffer.from(raw).toString('base64url');

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encoded },
  });

  return { id: res.data.id ?? `gmail-${Date.now()}` };
}
