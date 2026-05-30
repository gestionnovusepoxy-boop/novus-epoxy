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
export interface EmailAttachment {
  filename: string;
  content: Uint8Array | Buffer;
  contentType?: string;
}

export async function sendEmail({
  to,
  subject,
  html,
  replyTo,
  cc,
  bcc,
  via,
  attachments,
}: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  cc?: string;
  bcc?: string;
  via?: 'gmail' | 'resend';
  attachments?: EmailAttachment[];
}): Promise<{ id: string }> {
  // Resend seulement si explicitement demandé (prospection Aria)
  if (via === 'resend') {
    try {
      return await sendViaResend({ to, subject, html, replyTo, cc, attachments });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[sendEmail] Resend failed (${msg.slice(0, 100)}), fallback Gmail`);
      return sendViaGmail({ to, subject, html, replyTo, cc, bcc, attachments });
    }
  }
  // Default: Gmail (gestionnovusepoxy@gmail.com)
  try {
    return await sendViaGmail({ to, subject, html, replyTo, cc, bcc, attachments });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Fire-and-forget detection: if invalid_grant, persist flag + alert (deduped per day)
    void handleGmailAuthError(err);
    console.log(`[sendEmail] Gmail failed (${msg.slice(0, 100)}), fallback Resend`);
    return sendViaResend({ to, subject, html, replyTo, cc, attachments });
  }
}

async function sendViaGmail({
  to, subject, html, replyTo, cc, bcc, attachments,
}: {
  to: string; subject: string; html: string; replyTo?: string; cc?: string; bcc?: string; attachments?: EmailAttachment[];
}): Promise<{ id: string }> {
  let clientId = (process.env.GOOGLE_WEB_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '');
  let clientSecret = (process.env.GOOGLE_WEB_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '');
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
  const baseHeaders = [
    `From: ${fromHeader}`,
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    bcc ? `Bcc: ${bcc}` : null,
    `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`,
    replyTo ? `Reply-To: ${replyTo}` : null,
    'MIME-Version: 1.0',
  ].filter(Boolean);

  let raw: string;
  if (attachments && attachments.length > 0) {
    // multipart/mixed: html part + each attachment as base64
    const boundary = `=_NovusBoundary_${Date.now().toString(36)}`;
    const headers = [...baseHeaders, `Content-Type: multipart/mixed; boundary="${boundary}"`].join('\r\n');
    const parts: string[] = [
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: 7bit',
      '',
      html,
    ];
    for (const att of attachments) {
      const ctype = att.contentType ?? 'application/octet-stream';
      const buf = att.content instanceof Buffer ? att.content : Buffer.from(att.content);
      // base64 wrapped at 76 chars per RFC 2045
      const b64 = buf.toString('base64').replace(/(.{76})/g, '$1\r\n');
      parts.push(
        `--${boundary}`,
        `Content-Type: ${ctype}; name="${att.filename}"`,
        `Content-Disposition: attachment; filename="${att.filename}"`,
        'Content-Transfer-Encoding: base64',
        '',
        b64,
      );
    }
    parts.push(`--${boundary}--`);
    raw = `${headers}\r\n\r\n${parts.join('\r\n')}`;
  } else {
    const headers = [...baseHeaders, 'Content-Type: text/html; charset=utf-8'].join('\r\n');
    raw = `${headers}\r\n\r\n${html}`;
  }
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
  to, subject, html, replyTo, cc, attachments,
}: {
  to: string; subject: string; html: string; replyTo?: string; cc?: string; attachments?: EmailAttachment[];
}): Promise<{ id: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY missing');

  const resendAttachments = attachments?.map(a => ({
    filename: a.filename,
    content: (a.content instanceof Buffer ? a.content : Buffer.from(a.content)).toString('base64'),
  }));

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
      ...(resendAttachments && resendAttachments.length > 0 ? { attachments: resendAttachments } : {}),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return { id: data.id ?? `resend-${Date.now()}` };
}
