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
  // Use WEB client first (matches the OAuth re-consent flow at /api/auth/google).
  // Fall back to legacy GOOGLE/GMAIL clients for older tokens.
  let clientId = process.env.GOOGLE_WEB_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  let clientSecret = process.env.GOOGLE_WEB_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  let refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  // kv_store overrides (source de vérité après re-auth via /api/auth/google/callback)
  try {
    const { query } = await import('@/lib/db');
    const rows = await query(
      `SELECT key, value FROM kv_store WHERE key IN ('google_client_id','google_client_secret','google_refresh_token')`
    );
    for (const row of (rows ?? [])) {
      if (row.key === 'google_client_id' && row.value) clientId = row.value as string;
      if (row.key === 'google_client_secret' && row.value) clientSecret = row.value as string;
      if (row.key === 'google_refresh_token' && row.value) refreshToken = row.value as string;
    }
  } catch { /* fallback to env */ }

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Gmail credentials missing');
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });

  const body = html || (text ? text.split('\n').map(l => l.trim() ? `<p style="margin:0 0 8px;">${l}</p>` : '').join('') : '');

  // CASL/LCAP: tout courriel commercial doit inclure identification de l'expéditeur
  // + un mécanisme de désabonnement clair. Injecté ici pour que TOUS les emails de
  // prospection soient conformes, peu importe l'appelant.
  // NOTE: ajouter une adresse postale civique complète pour conformité CASL stricte.
  const caslFooter = `<hr style="margin:24px 0 12px;border:none;border-top:1px solid #ddd;">
<p style="font-size:12px;color:#888;line-height:1.5;margin:0;">
Novus Epoxy — Planchers époxy haut de gamme, région de Québec (QC).<br>
Téléphone: 581-307-5983 · gestionnovusepoxy@gmail.com<br>
Vous recevez ce courriel car vous avez manifesté de l'intérêt pour nos services.<br>
Pour ne plus jamais recevoir nos courriels, répondez «&nbsp;DESABONNEMENT&nbsp;» à ce message.
</p>`;
  const content = body + caslFooter;

  const headerLines = [
    'From: Novus Epoxy <gestionnovusepoxy@gmail.com>',
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'List-Unsubscribe: <mailto:gestionnovusepoxy@gmail.com?subject=DESABONNEMENT>',
    'Content-Type: text/html; charset=utf-8',
  ].join('\r\n');

  const raw = `${headerLines}\r\n\r\n${content}`;
  const encoded = Buffer.from(raw).toString('base64url');

  try {
    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encoded },
    });
    return { id: res.data.id ?? `gmail-${Date.now()}` };
  } catch (err) {
    // Même gestion d'erreur OAuth que sendEmail: persiste gmail_oauth_broken + alerte Telegram.
    const { handleGmailAuthError } = await import('@/lib/send-email');
    void handleGmailAuthError(err);
    throw err;
  }
}
