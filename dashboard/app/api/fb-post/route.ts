import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getPostDraft } from '@/lib/fb-autopost';

export const maxDuration = 120;

const META_API_VERSION = 'v25.0';
const NOVUS_PAGE_ID = '636757822863288';

/**
 * POST /api/fb-post
 * Body: { draftId: string, action: 'publish' | 'reject' }
 *
 * Appelé par le bouton Telegram (✅ Publier / ❌ Rejeter). Auth via session
 * admin OU header x-api-key=ADMIN_API_KEY (comme le fait le handler Telegram).
 *
 * action='publish' → publie le brouillon (photo + message) sur la PAGE Facebook
 * Novus via Graph API /{PAGE_ID}/photos avec un page access token dérivé du
 * META_PAGE_TOKEN. JAMAIS de publication sans ce clic.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  const apiKey = req.headers.get('x-api-key');
  if (!session && apiKey !== process.env.ADMIN_API_KEY) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const draftId = String(body.draftId ?? '');
  const action = String(body.action ?? '');

  if (!draftId.startsWith('fb_post_draft_')) {
    return NextResponse.json({ error: 'draftId invalide' }, { status: 400 });
  }

  const draft = await getPostDraft(draftId);
  if (!draft) {
    return NextResponse.json({ error: 'Brouillon introuvable ou expiré' }, { status: 404 });
  }

  if (action === 'reject') {
    return NextResponse.json({ ok: true, rejected: true, draftId });
  }

  if (action !== 'publish') {
    return NextResponse.json({ error: "action doit être 'publish' ou 'reject'" }, { status: 400 });
  }

  const baseToken = (process.env.META_PAGE_TOKEN ?? '').trim();
  if (!baseToken) {
    return NextResponse.json({ error: 'META_PAGE_TOKEN manquant' }, { status: 500 });
  }

  // Dérive un page access token depuis le token (System User) via /PAGE_ID?fields=access_token.
  // Si le token est déjà un page token, ça retourne le même; sinon on garde baseToken en fallback.
  let pageToken = baseToken;
  try {
    const ptRes = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${NOVUS_PAGE_ID}?fields=access_token&access_token=${encodeURIComponent(baseToken)}`
    );
    const ptData = await ptRes.json();
    if (ptData.access_token) pageToken = String(ptData.access_token).trim();
  } catch {
    /* fallback sur baseToken */
  }

  // Publie la photo + message sur la page.
  try {
    const pubRes = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${NOVUS_PAGE_ID}/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: draft.imageUrl,
        message: draft.message,
        published: true,
        access_token: pageToken,
      }),
    });
    const pubData = await pubRes.json().catch(() => ({}));
    if (!pubRes.ok || pubData.error) {
      const detail = pubData.error?.message ?? JSON.stringify(pubData).slice(0, 300);
      return NextResponse.json({ error: 'Graph API photos error', detail }, { status: 502 });
    }

    return NextResponse.json({
      ok: true,
      published: true,
      draftId,
      photo_id: pubData.id ?? null,
      post_id: pubData.post_id ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
