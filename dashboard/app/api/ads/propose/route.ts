import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { buildAdDraft, sendDraftToTelegram } from '@/lib/meta-ads';

export const maxDuration = 120;

/**
 * POST /api/ads/propose
 * Body: { service: 'flake'|'metallique'|..., dailyBudgetUsd?: 50, durationDays?: 7, customImageUrl?: string }
 * Or auth via x-api-key=ADMIN_API_KEY for cron triggers.
 *
 * Creates a draft (image + copy + targeting) and sends Telegram preview
 * with Approve/Reject/Regen buttons. Nothing reaches Meta until approved.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  const apiKey = req.headers.get('x-api-key');
  if (!session && apiKey !== process.env.ADMIN_API_KEY) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const service = String(body.service ?? '');
  const allowed = ['flake', 'metallique', 'quartz', 'couleur_unie', 'antiderapant', 'commercial', 'meulage', 'vinyl_click'];
  if (!allowed.includes(service)) {
    return NextResponse.json({ error: `service requis (${allowed.join('|')})` }, { status: 400 });
  }

  const dailyBudgetUsd = Math.min(Number(body.dailyBudgetUsd ?? 50), 50); // hard cap $50/day
  const durationDays = Math.min(Number(body.durationDays ?? 7), 14);     // hard cap 14 days
  const customImageUrl = typeof body.customImageUrl === 'string' ? body.customImageUrl : undefined;

  try {
    const draft = await buildAdDraft({
      service: service as 'flake' | 'metallique' | 'quartz' | 'couleur_unie' | 'antiderapant' | 'commercial' | 'meulage' | 'vinyl_click',
      dailyBudgetUsd,
      durationDays,
      customImageUrl,
    });

    const chatId = process.env.TELEGRAM_GROUP_CHAT_ID;
    if (chatId) {
      await sendDraftToTelegram(draft, chatId);
    }

    return NextResponse.json({ ok: true, draft });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
