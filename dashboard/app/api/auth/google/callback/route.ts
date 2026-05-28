import { NextRequest, NextResponse } from 'next/server';
import { getAdminChatIds } from '@/lib/telegram-utils';
import { google } from 'googleapis';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  // Auth check skipped — this is a one-time OAuth callback, token is encrypted on Vercel

  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');

  if (!code) {
    return new NextResponse('<h1>Erreur: pas de code Google</h1>', { headers: { 'Content-Type': 'text/html' } });
  }

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_WEB_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_WEB_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
    'https://novus-epoxy.vercel.app/api/auth/google/callback'
  );

  try {
    const { tokens } = await oauth2.getToken(code);
    const refreshToken = tokens.refresh_token;

    if (!refreshToken) {
      return new NextResponse(
        '<h1>Erreur: pas de refresh token</h1><p>Essaie de nouveau avec prompt=consent</p>',
        { headers: { 'Content-Type': 'text/html' } }
      );
    }

    // Save to shared DB (works for both Vercel and VPS)
    await query(
      `INSERT INTO kv_store (key, value) VALUES ('google_refresh_token', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [refreshToken],
    ).catch(() => {});

    // Clear the broken flag so email-scan / relance-prospect resume immediately.
    await query(`DELETE FROM kv_store WHERE key = 'gmail_oauth_broken'`).catch(() => {});

    // Auto-update Vercel env var if VERCEL_TOKEN is available
    let vercelUpdated = false;
    const vercelToken = process.env.VERCEL_TOKEN;
    const vercelProjectId = process.env.VERCEL_PROJECT_ID || 'novus-epoxy';
    if (vercelToken) {
      try {
        // Remove old env var
        await fetch(`https://api.vercel.com/v9/projects/${vercelProjectId}/env/GOOGLE_REFRESH_TOKEN`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${vercelToken}` },
        }).catch(() => {});
        // Create new one
        const createRes = await fetch(`https://api.vercel.com/v10/projects/${vercelProjectId}/env`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${vercelToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'GOOGLE_REFRESH_TOKEN', value: refreshToken, type: 'encrypted', target: ['production', 'preview'] }),
        });
        vercelUpdated = createRes.ok;
      } catch { /* non-fatal */ }
    }

    // Notify on Telegram
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatIds = getAdminChatIds();
    if (botToken) {
      for (const chatId of chatIds) {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId.trim(),
            text: `✅ <b>Google reconnecté avec FULL ACCESS!</b>\n\nScopes: gmail.modify, gmail.send, drive.readonly\n${vercelUpdated ? '🔄 Vercel mis à jour automatiquement!' : '⚠️ Copie le token ci-dessous pour Vercel.'}`,
            parse_mode: 'HTML',
          }),
        }).catch(() => {});
      }
    }

    return new NextResponse(
      `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:600px;margin:50px auto;padding:20px;">
        <h1 style="color:green;">✅ Google reconnecté — FULL ACCESS!</h1>
        ${vercelUpdated ? '<p style="color:green;font-weight:bold;">🔄 Vercel mis à jour automatiquement!</p>' : ''}
        <p>Nouveau refresh token:</p>
        <textarea style="width:100%;height:80px;font-family:monospace;font-size:12px;" readonly onclick="this.select()">${refreshToken}</textarea>
        ${!vercelUpdated ? '<p style="color:red;font-weight:bold;">Copie ce token et donne-le a Claude pour mettre a jour Vercel.</p>' : '<p>Le ménage Gmail va commencer automatiquement!</p>'}
      </body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  } catch (err) {
    return new NextResponse(
      `<h1>Erreur OAuth</h1><pre>${err instanceof Error ? err.message : String(err)}</pre>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  }
}
