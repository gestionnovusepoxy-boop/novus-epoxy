import { NextRequest, NextResponse } from 'next/server';
import { buildPostDraft, sendDraftToTelegram } from '@/lib/fb-autopost';

export const maxDuration = 120;

/**
 * Cron auto-post page Facebook — PROPOSE seulement.
 *
 * Choisit une vraie photo du portfolio + génère un texte québécois, puis envoie
 * le brouillon au groupe Telegram avec boutons "✅ Publier" / "❌ Rejeter".
 * La publication réelle se fait UNIQUEMENT quand Luca clique (→ /api/fb-post).
 * JAMAIS de publication automatique sur la page.
 *
 * Désactivé par défaut. Réactiver via FB_AUTOPOST_ENABLED=true.
 * Pas ajouté à vercel.json — déclenché manuellement par Luca.
 */
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  if (!secret || (secret !== (process.env.CRON_SECRET ?? '') && secret !== (process.env.ADMIN_API_KEY ?? ''))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Kill-switch: proposition de posts FB OFF par défaut.
  if (process.env.FB_AUTOPOST_ENABLED !== 'true') {
    return NextResponse.json({ ok: true, skipped: 'fb autopost disabled' });
  }

  try {
    const draft = await buildPostDraft();
    const sent = await sendDraftToTelegram(draft);
    return NextResponse.json({ ok: true, proposed: true, sent, draft_id: draft.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
