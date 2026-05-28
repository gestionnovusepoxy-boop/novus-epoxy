import { google } from 'googleapis';
import { query } from '@/lib/db';

/**
 * Detects Gmail OAuth `invalid_grant` errors (revoked / expired refresh token).
 * On detection:
 *   1. Persists `gmail_oauth_broken=true` in kv_store (idempotent — so other paths short-circuit).
 *   2. Sends ONE Telegram alert per day (deduped via `gmail_alert_YYYY-MM-DD`).
 * Never throws — observability only.
 */
export async function handleGmailAuthError(err: unknown): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (!lower.includes('invalid_grant') && !lower.includes('invalid grant')) return;

  try {
    await query(
      `INSERT INTO kv_store (key, value, updated_at) VALUES ('gmail_oauth_broken', 'true', NOW())
       ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = NOW()`
    );
  } catch { /* ignore */ }

  // Dedup alert per day
  const today = new Date().toISOString().slice(0, 10);
  const alertKey = `gmail_alert_${today}`;
  try {
    const rows = await query(`SELECT 1 FROM kv_store WHERE key = $1`, [alertKey]) as unknown[];
    if (rows.length > 0) return;
    await query(
      `INSERT INTO kv_store (key, value, updated_at) VALUES ($1, 'sent', NOW()) ON CONFLICT (key) DO NOTHING`,
      [alertKey]
    );
  } catch { /* ignore */ }

  const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
  const chat = (process.env.TELEGRAM_GROUP_CHAT_ID ?? '').trim();
  if (!token || !chat) return;
  try {
    // Tap-to-fix: button opens the OAuth consent flow directly. ~10s to restore.
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chat,
        text: '🚨 <b>Gmail OAuth expiré</b> — emails + scans en pause.\n\nClique le bouton, choisis le compte gestionnovusepoxy, puis "Avancé → Continuer". Ça repart tout seul.\n\n⚠️ Pour que ça ne casse plus jamais: Google Cloud Console → OAuth consent screen → <b>PUBLISH APP</b> (sinon ça expire ~7j).',
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[
          { text: '🔑 Reconnecter Gmail (1 clic)', url: 'https://novus-epoxy.vercel.app/api/auth/google' },
        ]]},
      }),
    });
  } catch { /* never block on alert */ }
}

/**
 * Sends system emails (devis, contrats, replies Aria, etc.)
 * Primary: Gmail (gestionnovusepoxy@gmail.com) — visible dans Messages envoyés
 * Fallback: Resend si Gmail fail
 * Resend uniquement pour prospection Aria (via: 'resend')
 */
export async function sendEmail({
  to,
  subject,
  html,
  replyTo,
  cc,
  bcc,
  via,
}: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  cc?: string;
  bcc?: string;
  via?: 'gmail' | 'resend';
}): Promise<{ id: string }> {
  // Resend seulement si explicitement demandé (prospection Aria)
  if (via === 'resend') {
    try {
      return await sendViaResend({ to, subject, html, replyTo, cc });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[sendEmail] Resend failed (${msg.slice(0, 100)}), fallback Gmail`);
      return sendViaGmail({ to, subject, html, replyTo, cc, bcc });
    }
  }
  // Default: Gmail (gestionnovusepoxy@gmail.com)
  try {
    return await sendViaGmail({ to, subject, html, replyTo, cc, bcc });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Fire-and-forget detection: if invalid_grant, persist flag + alert (deduped per day)
    void handleGmailAuthError(err);
    console.log(`[sendEmail] Gmail failed (${msg.slice(0, 100)}), fallback Resend`);
    return sendViaResend({ to, subject, html, replyTo, cc });
  }
}

async function sendViaGmail({
  to, subject, html, replyTo, cc, bcc,
}: {
  to: string; subject: string; html: string; replyTo?: string; cc?: string; bcc?: string;
}): Promise<{ id: string }> {
  let clientId = process.env.GOOGLE_CLIENT_ID ?? '';
  let clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';
  let refreshToken = process.env.GOOGLE_REFRESH_TOKEN ?? '';

  // kv_store overrides env vars (source de vérité après le flow OAuth Web)
  try {
    const rows = await query(
      `SELECT key, value FROM kv_store WHERE key IN ('google_client_id','google_client_secret','google_refresh_token')`
    );
    for (const row of (rows ?? [])) {
      if (row.key === 'google_client_id' && row.value) clientId = row.value as string;
      if (row.key === 'google_client_secret' && row.value) clientSecret = row.value as string;
      if (row.key === 'google_refresh_token' && row.value) refreshToken = row.value as string;
    }
  } catch { /* ignore — use env vars */ }

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
    cc ? `Cc: ${cc}` : null,
    bcc ? `Bcc: ${bcc}` : null,
    `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`,
    replyTo ? `Reply-To: ${replyTo}` : null,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
  ].filter(Boolean).join('\r\n');

  const raw = `${headerLines}\r\n\r\n${html}`;
  const encoded = Buffer.from(raw).toString('base64url');

  try {
    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encoded },
    });
    return { id: res.data.id ?? `gmail-${Date.now()}` };
  } catch (err) {
    // Detect invalid_grant (revoked refresh token) — alert once/day + persist flag
    void handleGmailAuthError(err);
    throw err;
  }
}

async function sendViaResend({
  to, subject, html, replyTo, cc,
}: {
  to: string; subject: string; html: string; replyTo?: string; cc?: string;
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
      cc: cc ? [cc] : undefined,
      subject,
      html,
      reply_to: replyTo ?? 'gestionnovusepoxy@gmail.com',
      bcc: ['gestionnovusepoxy@gmail.com'],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return { id: data.id ?? `resend-${Date.now()}` };
}
