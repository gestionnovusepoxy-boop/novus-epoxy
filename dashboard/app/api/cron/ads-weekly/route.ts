import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { buildAdDraft, sendDraftToTelegram } from '@/lib/meta-ads';

export const maxDuration = 300;

/**
 * Cron lundi 10h Quebec (14:00 UTC) → propose 1 nouvelle pub par semaine
 * basée sur le service avec meilleur ROI (CPL bas, plus de leads).
 *
 * Schedule:
 *   "/api/cron/ads-weekly" → "0 14 * * 1"
 *
 * Si pas d'historique, prend le service le plus demandé dans les leads chauds
 * du dernier mois.
 */
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  if (!secret || (secret !== (process.env.CRON_SECRET ?? '') && secret !== (process.env.ADMIN_API_KEY ?? ''))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Pick the service with most converting leads in last 30d (chaud + has quote)
  let pickedService = 'flake'; // default
  try {
    const rows = await query(
      `SELECT service, COUNT(*)::int AS n
         FROM crm_leads
        WHERE temperature = 'chaud'
          AND service IS NOT NULL
          AND created_at >= NOW() - INTERVAL '30 days'
        GROUP BY service
        ORDER BY n DESC LIMIT 1`
    );
    if (rows[0]?.service) pickedService = String(rows[0].service);
  } catch { /* fallback to default */ }

  // crm_leads.service est du texte libre — on valide contre la liste permise sinon buildAdDraft
  // reçoit un service bidon (ex: "Facebook Lead Ad") et casse les labels/heros.
  const ALLOWED_AD_SERVICES = ['flake', 'metallique', 'quartz', 'couleur_unie', 'antiderapant', 'commercial', 'meulage', 'vinyl_click'] as const;
  const safeService = (ALLOWED_AD_SERVICES as readonly string[]).includes(pickedService)
    ? (pickedService as (typeof ALLOWED_AD_SERVICES)[number])
    : 'flake';

  try {
    const draft = await buildAdDraft({ service: safeService, dailyBudgetUsd: 50, durationDays: 7 });
    const chatId = process.env.TELEGRAM_GROUP_CHAT_ID;
    if (chatId) await sendDraftToTelegram(draft, chatId);
    return NextResponse.json({ ok: true, picked: pickedService, draft_id: draft.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
