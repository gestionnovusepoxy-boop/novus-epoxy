import { google } from 'googleapis';

/**
 * Sends system emails (devis, contrats, replies Aria, etc.)
 * Primary: Gmail API (gestionnovusepoxy@gmail.com)
 * Fallback: Resend (info@novusepoxy.shop) if Gmail is blocked/rate-limited
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
  // Try Gmail first
  try {
    const result = await sendViaGmail({ to, subject, html, replyTo });
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // If Gmail rate limited or blocked, fallback to Resend
    if (msg.includes('limit') || msg.includes('429') || msg.includes('quota') || msg.includes('suspended') || msg.includes('PERMISSION_DENIED')) {
      console.log(`[sendEmail] Gmail blocked (${msg.slice(0, 80)}), falling back to Resend`);
      return sendViaResend({ to, subject, html, replyTo });
    }
    throw err;
  }
}

async function sendViaGmail({
  to, subject, html, replyTo,
}: {
  to: string; subject: string; html: string; replyTo?: string;
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

  const fromHeader = 'Novus Epoxy <gestionnovusepoxy@gmail.com>';
  const headerLines = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    replyTo ? `Reply-To: ${replyTo}` : null,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
  ].filter(Boolean).join('\r\n');

  const raw = `${headerLines}\r\n\r\n${html}`;
  const encoded = Buffer.from(raw).toString('base64url');

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encoded },
  });

  return { id: res.data.id ?? `gmail-${Date.now()}` };
}

async function sendViaResend({
  to, subject, html, replyTo,
}: {
  to: string; subject: string; html: string; replyTo?: string;
}): Promise<{ id: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY missing');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Novus Epoxy <info@novusepoxy.shop>',
      to,
      subject,
      html,
      reply_to: replyTo ?? 'gestionnovusepoxy@gmail.com',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return { id: data.id ?? `resend-${Date.now()}` };
}
