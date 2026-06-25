import { query } from '@/lib/db';

/**
 * Source unique du token de page Meta (META_PAGE_TOKEN).
 *
 * Même pattern que les credentials Gmail (voir lib/send-email.ts) :
 *   1. kv_store clé 'meta_page_token' = source de vérité (rotation à chaud, sans redéploiement)
 *   2. fallback process.env.META_PAGE_TOKEN
 *
 * Permet de faire tourner le token (quand le mot de passe Meta change / le token
 * long-lived expire) via POST /api/meta/token sans toucher Vercel ni redéployer.
 *
 * Ne throw jamais : en cas d'erreur DB on retombe sur l'env var. Les appelants
 * existants qui lisent encore process.env.META_PAGE_TOKEN restent fonctionnels —
 * cette fonction est l'infra de migration, pas un breaking change.
 */
const KV_KEY = 'meta_page_token';

export async function getMetaToken(): Promise<string> {
  try {
    const rows = (await query(
      `SELECT value FROM kv_store WHERE key = $1`,
      [KV_KEY],
    )) as Array<{ value: string | null }>;
    const kvToken = (rows?.[0]?.value ?? '').trim();
    if (kvToken) return kvToken;
  } catch {
    /* ignore — fallback env */
  }
  return (process.env.META_PAGE_TOKEN ?? '').trim();
}

/**
 * Stocke un nouveau token de page dans kv_store (rotation à chaud).
 * Admin-gated en amont (route /api/meta/token). Ne throw pas si DB indispo —
 * remonte l'erreur à l'appelant qui décide.
 */
export async function setMetaToken(token: string): Promise<void> {
  await query(
    `INSERT INTO kv_store (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [KV_KEY, token.trim()],
  );
}

/**
 * Indique si un token override est présent en kv_store (sans révéler la valeur).
 * Retourne aussi le moment de la dernière rotation.
 */
export async function metaTokenStatus(): Promise<{
  hasKvToken: boolean;
  hasEnvToken: boolean;
  updatedAt: string | null;
}> {
  let hasKvToken = false;
  let updatedAt: string | null = null;
  try {
    const rows = (await query(
      `SELECT value, updated_at FROM kv_store WHERE key = $1`,
      [KV_KEY],
    )) as Array<{ value: string | null; updated_at: string | Date | null }>;
    const v = (rows?.[0]?.value ?? '').trim();
    hasKvToken = v.length > 0;
    const ua = rows?.[0]?.updated_at ?? null;
    updatedAt = ua ? new Date(ua).toISOString() : null;
  } catch {
    /* ignore */
  }
  return {
    hasKvToken,
    hasEnvToken: (process.env.META_PAGE_TOKEN ?? '').trim().length > 0,
    updatedAt,
  };
}
