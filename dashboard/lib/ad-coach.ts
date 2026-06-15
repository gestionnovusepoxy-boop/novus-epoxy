/**
 * lib/ad-coach.ts — "Coach Pub" : surveille les pubs Meta, diagnostique, apprend.
 *
 * Boucle d'apprentissage SEMI-AUTO : le coach lit les vraies stats, détecte ce qui
 * cloche, propose des actions sur Telegram (boutons 1-clic), et enregistre ce qui
 * marche pour que la prochaine pub soit meilleure. Rien ne bouge sans l'OK de Luca.
 */
import { query } from '@/lib/db';

const META_API = 'v25.0';
const NOVUS_PAGE_ID = '636757822863288';
const AD_ACCOUNT = () => (process.env.META_AD_ACCOUNT_ID ?? '250180039560083').replace(/^act_/, '');
const CPL_TARGET = 40; // $ CAD cible (benchmark Québec épand)

export interface AdDiagnosis {
  campaignId: string;
  name: string;
  dailyBudget: number;
  spend3d: number;
  impressions: number;
  clicks: number;
  leads: number;
  cpl: number | null;
  ctr: number;
  topPlacement: string | null;
  topAge: string | null;
  issue: 'STALLED' | 'NO_DELIVERY' | 'HIGH_CPL' | 'NO_LEADS' | 'WINNING' | 'OK';
  message: string;
  action: 'relaunch' | 'scale' | 'newcreative' | 'none';
}

const num = (actions: Array<{ action_type: string; value: string }> | undefined, t: string) =>
  Number((actions ?? []).find(a => a.action_type === t)?.value ?? 0);
const leadsOf = (a?: Array<{ action_type: string; value: string }>) =>
  num(a, 'lead') || num(a, 'onsite_conversion.lead_grouped') || num(a, 'offsite_complete_registration_add_meta_leads');

/** Analyse toutes les campagnes actives + diagnostic. */
export async function analyzeActiveCampaigns(token: string): Promise<AdDiagnosis[]> {
  const acct = AD_ACCOUNT();
  const status = encodeURIComponent(JSON.stringify(['ACTIVE']));
  const campRes = await fetch(`https://graph.facebook.com/${META_API}/act_${acct}/campaigns?fields=name,effective_status&effective_status=${status}&limit=50&access_token=${token}`);
  const campData = await campRes.json();
  const out: AdDiagnosis[] = [];

  for (const c of (campData.data ?? [])) {
    // budget (au niveau adset)
    const asRes = await fetch(`https://graph.facebook.com/${META_API}/${c.id}/adsets?fields=daily_budget&access_token=${token}`);
    const asData = await asRes.json();
    const dailyBudget = Number((asData.data ?? [])[0]?.daily_budget ?? 0) / 100;

    // insights 3 derniers jours
    const insRes = await fetch(`https://graph.facebook.com/${META_API}/${c.id}/insights?fields=spend,impressions,clicks,ctr,actions&date_preset=last_3d&access_token=${token}`);
    const ins = (await insRes.json()).data?.[0];
    const spend3d = Number(ins?.spend ?? 0);
    const impressions = Number(ins?.impressions ?? 0);
    const clicks = Number(ins?.clicks ?? 0);
    const ctr = Number(ins?.ctr ?? 0);
    const leads = leadsOf(ins?.actions);
    const cpl = leads > 0 ? spend3d / leads : null;

    // meilleur placement + âge (pour apprendre)
    let topPlacement: string | null = null, topAge: string | null = null;
    try {
      const pRes = await fetch(`https://graph.facebook.com/${META_API}/${c.id}/insights?fields=impressions,actions&breakdowns=publisher_platform,platform_position&date_preset=maximum&access_token=${token}`);
      const p = (await pRes.json()).data ?? [];
      const best = p.map((x: Record<string, unknown>) => ({ k: `${x.publisher_platform}/${x.platform_position}`, l: leadsOf(x.actions as never) })).sort((a: { l: number }, b: { l: number }) => b.l - a.l)[0];
      if (best?.l > 0) topPlacement = best.k;
      const aRes = await fetch(`https://graph.facebook.com/${META_API}/${c.id}/insights?fields=actions&breakdowns=age&date_preset=maximum&access_token=${token}`);
      const a = (await aRes.json()).data ?? [];
      const bestA = a.map((x: Record<string, unknown>) => ({ k: x.age as string, l: leadsOf(x.actions as never) })).sort((x: { l: number }, y: { l: number }) => y.l - x.l)[0];
      if (bestA?.l > 0) topAge = bestA.k;
    } catch { /* breakdowns optionnels */ }

    // ── DIAGNOSTIC ──
    const budget3d = dailyBudget * 3;
    let issue: AdDiagnosis['issue'] = 'OK';
    let message = '';
    let action: AdDiagnosis['action'] = 'none';
    if (budget3d > 0 && spend3d < budget3d * 0.3) {
      issue = impressions === 0 ? 'NO_DELIVERY' : 'STALLED';
      message = `🛑 <b>${c.name}</b> stalle — seulement ${spend3d.toFixed(2)}$ dépensés sur ${budget3d.toFixed(0)}$ possibles (3j). Meta étouffe la livraison.`;
      action = 'relaunch';
    } else if (cpl !== null && cpl > CPL_TARGET + 15 && leads >= 1) {
      issue = 'HIGH_CPL';
      message = `📉 <b>${c.name}</b> — CPL trop haut: ${cpl.toFixed(0)}$/lead (cible ${CPL_TARGET}$). La créative convertit mal.`;
      action = 'newcreative';
    } else if (impressions > 500 && leads === 0) {
      issue = 'NO_LEADS';
      message = `⚠️ <b>${c.name}</b> — ${impressions} impressions, 0 lead en 3j. Créative à revoir.`;
      action = 'newcreative';
    } else if (cpl !== null && cpl < 25 && leads >= 2) {
      issue = 'WINNING';
      message = `🔥 <b>${c.name}</b> performe! CPL ${cpl.toFixed(0)}$ · ${leads} leads. Monte le budget pour scaler.`;
      action = 'scale';
    } else {
      message = `✅ <b>${c.name}</b> OK — ${leads} leads, CPL ${cpl ? cpl.toFixed(0)+'$' : '—'}, ${spend3d.toFixed(0)}$ dépensés (3j).`;
    }
    out.push({ campaignId: c.id, name: c.name, dailyBudget, spend3d, impressions, clicks, leads, cpl, ctr, topPlacement, topAge, issue, message, action });
  }
  return out;
}

/** Enregistre un instantané de perf pour l'apprentissage (kv_store, pas de migration). */
export async function recordSnapshot(diags: AdDiagnosis[]): Promise<void> {
  const date = new Date().toISOString().slice(0, 10);
  const winners = diags.filter(d => d.cpl !== null && d.cpl < 30 && d.leads >= 1)
    .map(d => ({ name: d.name, cpl: d.cpl, leads: d.leads, topPlacement: d.topPlacement, topAge: d.topAge }));
  await query(
    `INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`,
    [`ad_perf_${date}`, JSON.stringify(diags.map(d => ({ id: d.campaignId, name: d.name, cpl: d.cpl, leads: d.leads, ctr: d.ctr, issue: d.issue })))]
  ).catch(() => {});
  if (winners.length) {
    await query(
      `INSERT INTO kv_store (key, value) VALUES ('ad_learnings', $1) ON CONFLICT (key) DO UPDATE SET value = $1`,
      [JSON.stringify({ updated: date, winners })]
    ).catch(() => {});
  }
}

/** Résumé des apprentissages — injecté dans la génération de la prochaine pub. */
export async function getLearnings(): Promise<string> {
  const rows = await query(`SELECT value FROM kv_store WHERE key = 'ad_learnings'`).catch(() => []);
  if (!rows.length) return '';
  try {
    const o = JSON.parse(String(rows[0].value));
    const w = o.winners?.[0];
    if (!w) return '';
    const placement = w.topPlacement ? ` Meilleur placement: ${w.topPlacement}.` : '';
    const age = w.topAge ? ` Audience qui convertit: ${w.topAge} ans.` : '';
    return `APPRENTISSAGE (pubs passées qui ont marché — CPL ${w.cpl?.toFixed?.(0)}$, ${w.leads} leads):${placement}${age} Garde ce qui marche.`;
  } catch { return ''; }
}
