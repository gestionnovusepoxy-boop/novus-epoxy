import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getMetaToken } from '@/lib/meta-token';

export const maxDuration = 30;

const META_API_VERSION = 'v25.0';

/**
 * Vercel Cron — santé du token de page Meta.
 *
 * Vérifie le token actif (kv_store 'meta_page_token' → fallback env) via
 * debug_token. Si invalide / expiré → alerte Telegram UNE fois par jour
 * (dédupée via kv_store 'meta_token_alert_YYYY-MM-DD'), avec un bouton pour
 * ouvrir la page de rotation du token. Même pattern que l'alerte Gmail OAuth.
 *
 * No-op propre si aucun token n'est configuré (feature pas activée).
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if (!authHeader || (authHeader !== cronSecret && authHeader !== adminKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = await getMetaToken();
  if (!token) {
    return NextResponse.json({ ok: true, skipped: 'no token configured' });
  }

  // debug_token: source de vérité côté Meta pour la validité.
  let isValid = true;
  let reason: string | null = null;
  let expiresAt: number | null = null;
  try {
    const url = `https://graph.facebook.com/${META_API_VERSION}/debug_token?input_token=${encodeURIComponent(
      token,
    )}&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { method: 'GET' });
    const json = (await res.json()) as
      | { data?: { is_valid?: boolean; expires_at?: number; error?: { message?: string } }; error?: { message?: string } }
      | null;
    if (json?.error) {
      isValid = false;
      reason = json.error.message ?? 'erreur Graph API';
    } else {
      const data = json?.data;
      expiresAt = typeof data?.expires_at === 'number' ? data.expires_at : null;
      if (data?.is_valid === false) {
        isValid = false;
        reason = data.error?.message ?? 'is_valid=false';
      }
    }
  } catch (err) {
    // Erreur réseau transitoire — on ne crie pas au loup. On log et on sort OK.
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[meta-token-health] check failed (transient): ${msg.slice(0, 120)}`);
    return NextResponse.json({ ok: true, checked: false, transient: true });
  }

  if (isValid) {
    return NextResponse.json({ ok: true, valid: true, expires_at: expiresAt });
  }

  // Token mort → alerte Telegram dédupée 1x/jour.
  const today = new Date().toISOString().slice(0, 10);
  const alertKey = `meta_token_alert_${today}`;
  let alreadyAlerted = false;
  try {
    const rows = (await query(`SELECT 1 FROM kv_store WHERE key = $1`, [alertKey])) as unknown[];
    if (rows.length > 0) {
      alreadyAlerted = true;
    } else {
      await query(
        `INSERT INTO kv_store (key, value, updated_at) VALUES ($1, 'sent', NOW()) ON CONFLICT (key) DO NOTHING`,
        [alertKey],
      );
    }
  } catch {
    /* ignore — on tente quand même l'alerte */
  }

  if (!alreadyAlerted) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN ?? '';
    const chat = (process.env.TELEGRAM_GROUP_CHAT_ID ?? '').trim();
    if (botToken && chat) {
      try {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chat,
            text:
              '🚨 <b>Token Meta expiré</b> — leads Facebook + pubs en pause.\n\n' +
              `Raison: ${reason ?? 'inconnu'}\n\n` +
              'Génère un nouveau token de page (Graph API Explorer ou Business Settings), ' +
              'puis colle-le dans la page de rotation. Ça repart sans redéploiement.',
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[
                { text: '🔑 Mettre à jour le token Meta', url: 'https://novus-epoxy.vercel.app/dashboard/settings' },
              ]],
            },
          }),
        });
      } catch {
        /* never block on alert */
      }
    }
  }

  return NextResponse.json({ ok: true, valid: false, reason, alerted: !alreadyAlerted });
}
