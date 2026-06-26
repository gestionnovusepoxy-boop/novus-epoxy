import { NextRequest, NextResponse } from 'next/server';
import { getAdminChatIds } from '@/lib/telegram-utils';
import { gatherAdBrainData, buildDailyRecommendation } from '@/lib/ad-brain';

export const maxDuration = 90;

// Cerveau pub — tourne 1×/jour. Analyse PROFONDE: relie les pubs au revenu SIGNÉ réel
// (pas juste le CPL), trouve ce qui VEND, et écrit une recommandation actionnable sur Telegram.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if (!authHeader || (authHeader !== cronSecret && authHeader !== adminKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const metaToken = process.env.META_PAGE_TOKEN;
  const adAccount = process.env.META_AD_ACCOUNT_ID || '250180039560083';

  const data = await gatherAdBrainData(metaToken, adAccount);
  const reco = await buildDailyRecommendation(data);

  // Rapport Telegram
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = getAdminChatIds();
  if (botToken && chatIds.length) {
    const topService = data.byService[0];
    const lines = [
      `🧠 <b>Cerveau Pub — Analyse du jour</b>`,
      ``,
      topService ? `🥇 Meilleur vendeur: <b>${topService.service}</b> — ${Math.round(topService.revenu)}$ (${topService.contrats} contrats)` : '',
      `💵 Deal moyen: ${Math.round(data.dealMoyen)}$ · Signature: ${data.tauxSignature}%`,
      data.metaSpend30d != null ? `📊 Meta 30j: ${data.metaSpend30d}$ → ${data.metaLeads30d} leads` : '',
      ``,
      `<b>📋 Reco du jour:</b>`,
      reco,
    ].filter(Boolean).join('\n');
    for (const chatId of chatIds) {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId.trim(), text: lines.slice(0, 4000), parse_mode: 'HTML' }),
      }).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, data, reco });
}

export const POST = GET;
