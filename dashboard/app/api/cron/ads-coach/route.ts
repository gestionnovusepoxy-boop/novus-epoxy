import { NextRequest, NextResponse } from 'next/server';
import { analyzeActiveCampaigns, recordSnapshot, type AdDiagnosis } from '@/lib/ad-coach';

export const maxDuration = 60;

/**
 * Coach Pub — tourne 1x/jour. Lit les vraies stats Meta, diagnostique, et envoie
 * des alertes Telegram avec boutons 1-clic. Apprend de ce qui marche.
 * Schedule (vercel.json): "/api/cron/ads-coach" → "0 13 * * *" (9h Québec)
 */
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  if (!secret || (secret !== (process.env.CRON_SECRET ?? '') && secret !== (process.env.ADMIN_API_KEY ?? ''))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = process.env.META_PAGE_TOKEN ?? '';
  if (!token) return NextResponse.json({ error: 'META_PAGE_TOKEN manquant' }, { status: 500 });

  let diags: AdDiagnosis[] = [];
  try {
    diags = await analyzeActiveCampaigns(token);
  } catch (e) {
    return NextResponse.json({ error: 'analyse échouée', detail: String(e) }, { status: 500 });
  }
  await recordSnapshot(diags);

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_GROUP_CHAT_ID;
  const send = async (text: string, buttons?: unknown) => {
    if (!botToken || !chatId) return;
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}) }),
    }).catch(() => {});
  };

  // Alertes individuelles (seulement les pubs avec un problème/opportunité)
  let alerts = 0;
  for (const d of diags) {
    if (d.action === 'none') continue;
    alerts++;
    const btns: Array<Array<{ text: string; callback_data: string }>> = [];
    if (d.action === 'relaunch') btns.push([{ text: '🔄 Relancer la pub', callback_data: `coach_relaunch_${d.campaignId}` }]);
    if (d.action === 'scale') btns.push([{ text: '💰 Monter budget +10$/j', callback_data: `coach_scale_${d.campaignId}` }]);
    if (d.action === 'newcreative') btns.push([{ text: '🎨 Nouvelle créative', callback_data: `coach_newcreative_flake` }]);
    await send(`🤖 <b>Coach Pub</b>\n\n${d.message}`, btns);
  }

  // Résumé matin
  const totalLeads = diags.reduce((n, d) => n + d.leads, 0);
  const totalSpend = diags.reduce((n, d) => n + d.spend3d, 0);
  const summary = [
    `📊 <b>Coach Pub — résumé</b>`,
    ``,
    ...diags.map(d => `${d.issue === 'WINNING' ? '🔥' : d.issue === 'OK' ? '✅' : '⚠️'} ${d.name}: ${d.leads} leads · CPL ${d.cpl ? d.cpl.toFixed(0) + '$' : '—'} · ${d.spend3d.toFixed(0)}$ (3j)`),
    ``,
    `Total: ${totalLeads} leads · ${totalSpend.toFixed(0)}$ dépensés (3j)`,
    alerts === 0 ? `\nTout roule bien — rien à faire. 👍` : `\n${alerts} action(s) proposée(s) ci-dessus.`,
  ].join('\n');
  await send(summary);

  return NextResponse.json({ ok: true, campaigns: diags.length, alerts, diags });
}

export async function POST(req: NextRequest) { return GET(req); }
