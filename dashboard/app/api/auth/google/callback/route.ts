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

    // SÉCURITÉ: vérifie que le compte autorisé est bien le nôtre AVANT d'écrire le token.
    // Empêche quelqu'un d'écraser notre refresh_token avec son propre compte Google.
    const ALLOWED_GOOGLE_ACCOUNT = 'gestionnovusepoxy@gmail.com';
    try {
      oauth2.setCredentials(tokens);
      const gmailCheck = google.gmail({ version: 'v1', auth: oauth2 });
      const profile = await gmailCheck.users.getProfile({ userId: 'me' });
      const grantedEmail = (profile.data.emailAddress ?? '').toLowerCase();
      if (grantedEmail !== ALLOWED_GOOGLE_ACCOUNT) {
        return new NextResponse(
          `<h1>Compte refusé</h1><p>Ce flow doit être autorisé avec <b>${ALLOWED_GOOGLE_ACCOUNT}</b>, pas <b>${grantedEmail || 'inconnu'}</b>. Aucun token n'a été enregistré.</p>`,
          { status: 403, headers: { 'Content-Type': 'text/html' } }
        );
      }
    } catch (e) {
      return new NextResponse(
        `<h1>Erreur de vérification du compte</h1><pre>${e instanceof Error ? e.message : String(e)}</pre><p>Aucun token enregistré.</p>`,
        { status: 500, headers: { 'Content-Type': 'text/html' } }
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

    // Auto-update Vercel env var if VERCEL_TOKEN is available.
    // The project lives under a TEAM, so every call MUST include ?teamId= or it 404s.
    // (This is why the auto-update silently failed before.)
    // NOTE: kv_store above is already the source of truth — this Vercel sync is just a backup.
    let vercelUpdated = false;
    const vercelToken = process.env.VERCEL_TOKEN;
    const projectId = process.env.VERCEL_PROJECT_ID || 'prj_Oz0holNug5EwsoVeY2GEyiz5S4k9';
    const teamId = process.env.VERCEL_TEAM_ID || 'team_RPscWPrEHudwLzxC8zSzO2x2';
    if (vercelToken) {
      try {
        const tq = `?teamId=${teamId}`;
        const authH = { Authorization: `Bearer ${vercelToken}`, 'Content-Type': 'application/json' };
        // Find existing env var id (DELETE/PATCH need the id, not the name)
        const listRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env${tq}`, { headers: authH });
        const list = await listRes.json().catch(() => ({ envs: [] }));
        const existing = (list.envs ?? []).find((e: { key: string; id: string }) => e.key === 'GOOGLE_REFRESH_TOKEN');
        if (existing) {
          const patchRes = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env/${existing.id}${tq}`, {
            method: 'PATCH', headers: authH,
            body: JSON.stringify({ value: refreshToken }),
          });
          vercelUpdated = patchRes.ok;
        } else {
          const createRes = await fetch(`https://api.vercel.com/v10/projects/${projectId}/env${tq}`, {
            method: 'POST', headers: authH,
            body: JSON.stringify({ key: 'GOOGLE_REFRESH_TOKEN', value: refreshToken, type: 'encrypted', target: ['production', 'preview'] }),
          });
          vercelUpdated = createRes.ok;
        }
      } catch { /* non-fatal — kv_store already has it */ }
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
      `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;max-width:600px;margin:50px auto;padding:20px;">
        <h1 style="color:green;">✅ Google reconnecté — accès complet!</h1>
        <p style="color:green;font-weight:bold;">Le token est sauvegardé dans la base de données. Rien à copier — tout fonctionne déjà.${vercelUpdated ? ' (Vercel aussi mis à jour 🔄)' : ''}</p>
        <p>Gmail (envoi + scan + ménage) et les relances repartent automatiquement.</p>
        <hr style="margin:24px 0;border:none;border-top:1px solid #e2e8f0;">
        <p style="font-weight:bold;">⚠️ Pour que ça ne casse plus jamais (sinon ça expire ~7 jours):</p>
        <ol style="color:#334155;line-height:1.6;">
          <li>Va sur <a href="https://console.cloud.google.com/auth/overview" target="_blank">Google Cloud Console → OAuth consent screen</a></li>
          <li>Si le statut est <b>"Testing"</b>, clique <b>"PUBLISH APP" / "Passer en production"</b> et confirme.</li>
          <li>Le token ne sera plus jamais expiré (sauf révocation manuelle).</li>
        </ol>
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
