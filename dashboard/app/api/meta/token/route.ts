import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { setMetaToken, metaTokenStatus, getMetaToken } from '@/lib/meta-token';

export const dynamic = 'force-dynamic';

const META_API_VERSION = 'v25.0';

/**
 * Rotation à chaud du token de page Meta (META_PAGE_TOKEN) — sans redéploiement.
 *
 * Même idée que le flow OAuth Gmail : on stocke le token dans kv_store
 * (clé 'meta_page_token'), qui prime sur l'env var. Quand le mot de passe Meta
 * change ou que le token long-lived expire, on colle le nouveau token ici et
 * tout repart, sans toucher Vercel.
 *
 * POST  { token }  → admin-gated. Valide via debug_token avant de stocker.
 * GET             → admin-gated. Indique si un token est présent + sa validité
 *                   (ne révèle JAMAIS la valeur du token).
 */

interface DebugTokenData {
  is_valid?: boolean;
  app_id?: string;
  type?: string;
  expires_at?: number; // 0 = jamais (long-lived page token)
  scopes?: string[];
  error?: { message?: string };
}

async function debugToken(token: string): Promise<DebugTokenData | null> {
  // input_token = le token à inspecter ; access_token = un token valide pour
  // l'appel. On utilise le token lui-même (page token peut s'auto-inspecter).
  const url = `https://graph.facebook.com/${META_API_VERSION}/debug_token?input_token=${encodeURIComponent(
    token,
  )}&access_token=${encodeURIComponent(token)}`;
  try {
    const res = await fetch(url, { method: 'GET' });
    const json = (await res.json()) as { data?: DebugTokenData } | null;
    return json?.data ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  let body: { token?: unknown };
  try {
    body = (await req.json()) as { token?: unknown };
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 });
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token || token.length < 20) {
    return NextResponse.json({ error: 'Token manquant ou invalide' }, { status: 400 });
  }

  // Valide le token via debug_token avant de le stocker (évite de casser la prod
  // avec un token mort). Si Meta dit explicitement invalide → refuse.
  const data = await debugToken(token);
  if (data && data.is_valid === false) {
    return NextResponse.json(
      { error: 'Token rejeté par Meta (is_valid=false)', detail: data.error?.message ?? null },
      { status: 400 },
    );
  }

  try {
    await setMetaToken(token);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Stockage échoué: ${msg.slice(0, 120)}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    stored: true,
    validity: {
      checked: data !== null,
      is_valid: data?.is_valid ?? null,
      type: data?.type ?? null,
      expires_at: data?.expires_at ?? null,
      never_expires: data?.expires_at === 0,
    },
  });
}

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const status = await metaTokenStatus();
  const active = await getMetaToken();

  let validity: {
    checked: boolean;
    is_valid: boolean | null;
    type: string | null;
    expires_at: number | null;
    never_expires: boolean;
  } = { checked: false, is_valid: null, type: null, expires_at: null, never_expires: false };

  if (active) {
    const data = await debugToken(active);
    validity = {
      checked: data !== null,
      is_valid: data?.is_valid ?? null,
      type: data?.type ?? null,
      expires_at: data?.expires_at ?? null,
      never_expires: data?.expires_at === 0,
    };
  }

  return NextResponse.json({
    ok: true,
    present: status.hasKvToken || status.hasEnvToken,
    source: status.hasKvToken ? 'kv_store' : status.hasEnvToken ? 'env' : 'none',
    hasKvOverride: status.hasKvToken,
    updatedAt: status.updatedAt,
    validity,
  });
}
