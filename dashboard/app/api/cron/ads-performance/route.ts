/**
 * ads-performance cron — détecte les ad sets qui sous-performent et alerte
 * Telegram avec diagnostic + suggestion de pause (ne pause PAS auto-magiquement,
 * Luca confirme manuellement).
 *
 * Règles basées sur recherche benchmarks 2026 (epoxy/flooring/QC niche):
 *   - Target CPL = $40 CAD (typical $30-45 pour epoxy/flooring au QC)
 *   - Min form completion attendu = 8% (industry: 8-15% Instant Form prefill ON)
 *   - Min CTR attendu = 0.9-1.2% (Meta home services)
 *
 * Triggers de pause (au moins UN doit s'allumer):
 *   - spend >= $200 ET 0 leads (mort complet)
 *   - spend >= $250 ET CPL > $80 ET days_active >= 5 (CPL 2× la cible)
 *   - impressions >= 3000 ET CTR < 0.5% ET days_active >= 3 (creative ne resonne pas)
 *   - clicks >= 100 ET form_completion < 3% ET days_active >= 4 (form drop-off)
 *
 * Grace period: pas d'alerte sur les 72 premières heures (learning phase Meta).
 * Dedup: alerte 1×/jour/campagne (clé kv_store `ads_perf_alert_<campId>_<date>`).
 *
 * Schedule recommandé: `0 12 * * *` (chaque jour 12h UTC = 8h Québec).
 */
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const maxDuration = 120;

const TARGET_CPL_CAD = 40;
const MIN_FORM_COMPLETION_PCT = 3;
const MIN_CTR_PCT = 0.5;

type AdSetEvalution = {
  ad_set_id: string;
  ad_set_name: string;
  campaign_name: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  form_fills: number;
  cpl: number | null;
  form_completion: number | null;
  days_active: number;
  status: string;
  triggers: string[];
  verdict: 'pause' | 'optimize' | 'ok';
};

interface MetaAction { action_type: string; value: string }
interface MetaInsight {
  adset_id: string;
  adset_name: string;
  campaign_name: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  ctr?: string;
  actions?: MetaAction[];
  date_start: string;
  date_stop: string;
}

const LEAD_ACTION_TYPES = ['lead', 'leadgen_grouped', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead'];

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  if (secret !== (process.env.CRON_SECRET ?? '') && secret !== (process.env.ADMIN_API_KEY ?? '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = (process.env.META_PAGE_TOKEN ?? '').trim();
  const adAccountId = (process.env.META_AD_ACCOUNT_ID ?? '250180039560083').replace(/^act_/, '');
  if (!token) return NextResponse.json({ error: 'META_PAGE_TOKEN missing' }, { status: 500 });

  // Pull last 7d insights per ad set (with actions for form-fills)
  const url = `https://graph.facebook.com/v25.0/act_${adAccountId}/insights?level=adset&fields=adset_id,adset_name,campaign_name,spend,impressions,clicks,ctr,actions&date_preset=last_7d&access_token=${token}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return NextResponse.json({ error: 'Meta insights error', detail: err }, { status: 502 });
  }
  const data = (await res.json()) as { data?: MetaInsight[] };
  const items = data.data ?? [];

  // Get active ad set statuses (so we don't alert on already-paused ones)
  const statusUrl = `https://graph.facebook.com/v25.0/act_${adAccountId}/adsets?fields=id,name,status,effective_status,created_time&effective_status=['ACTIVE','PAUSED']&limit=200&access_token=${token}`;
  const stRes = await fetch(statusUrl);
  type AdSetMeta = { id: string; status: string; effective_status: string; created_time: string };
  const stData = stRes.ok ? (await stRes.json()) as { data?: AdSetMeta[] } : { data: [] };
  const statusMap = new Map<string, AdSetMeta>();
  for (const s of stData.data ?? []) statusMap.set(s.id, s);

  const evaluations: AdSetEvalution[] = [];
  for (const it of items) {
    const meta = statusMap.get(it.adset_id);
    const isActive = (meta?.effective_status ?? meta?.status ?? '') === 'ACTIVE';
    if (!isActive) continue; // ne pas alerter sur les paused

    const spend = Number(it.spend ?? 0);
    const impressions = Number(it.impressions ?? 0);
    const clicks = Number(it.clicks ?? 0);
    const ctr = Number(it.ctr ?? 0);
    const formFills = (it.actions ?? [])
      .filter(a => LEAD_ACTION_TYPES.includes(a.action_type))
      .reduce((s, a) => s + Number(a.value ?? 0), 0);
    const cpl = formFills > 0 ? spend / formFills : null;
    const formCompletion = clicks > 0 ? (formFills / clicks) * 100 : null;
    const daysActive = meta?.created_time
      ? Math.max(1, Math.floor((Date.now() - new Date(meta.created_time).getTime()) / 86400000))
      : 7;

    // 72h grace period (learning phase)
    if (daysActive < 3) continue;

    const triggers: string[] = [];
    if (spend >= 200 && formFills === 0) triggers.push(`MORT — $${spend.toFixed(0)} dépensé, 0 lead`);
    if (spend >= 250 && cpl !== null && cpl > 80 && daysActive >= 5) {
      triggers.push(`CPL $${cpl.toFixed(0)} > $80 (2× cible $40)`);
    }
    if (impressions >= 3000 && ctr < MIN_CTR_PCT && daysActive >= 3) {
      triggers.push(`CTR ${ctr.toFixed(2)}% < ${MIN_CTR_PCT}% — creative ne résonne pas`);
    }
    if (clicks >= 100 && formCompletion !== null && formCompletion < MIN_FORM_COMPLETION_PCT && daysActive >= 4) {
      triggers.push(`Form completion ${formCompletion.toFixed(1)}% < ${MIN_FORM_COMPLETION_PCT}% — drop-off (audit le form)`);
    }

    const verdict: AdSetEvalution['verdict'] = triggers.length > 0 ? 'pause' : (cpl !== null && cpl > TARGET_CPL_CAD * 1.5) ? 'optimize' : 'ok';

    evaluations.push({
      ad_set_id: it.adset_id,
      ad_set_name: it.adset_name,
      campaign_name: it.campaign_name,
      spend,
      impressions,
      clicks,
      ctr,
      form_fills: formFills,
      cpl,
      form_completion: formCompletion,
      days_active: daysActive,
      status: meta?.effective_status ?? '?',
      triggers,
      verdict,
    });
  }

  // Alert Telegram pour chaque ad set en verdict 'pause' — dedup 1×/jour
  const toAlert = evaluations.filter(e => e.verdict === 'pause');
  const today = new Date().toISOString().slice(0, 10);
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = (process.env.TELEGRAM_GROUP_CHAT_ID ?? '').trim();
  let alerts_sent = 0;

  for (const ev of toAlert) {
    const dedupKey = `ads_perf_alert_${ev.ad_set_id}_${today}`;
    const seen = await query(`SELECT 1 FROM kv_store WHERE key = $1`, [dedupKey]) as unknown[];
    if (seen.length > 0) continue;
    await query(`INSERT INTO kv_store (key, value) VALUES ($1, 'sent') ON CONFLICT (key) DO NOTHING`, [dedupKey]).catch(() => {});

    if (botToken && chatId) {
      const lines = [
        `🚨 <b>Ad Set sous-performant — pause suggérée</b>`,
        ``,
        `📢 <b>${ev.campaign_name}</b> → ${ev.ad_set_name}`,
        ``,
        `💵 Spend 7j: $${ev.spend.toFixed(2)} CAD`,
        `👁 Impressions: ${ev.impressions.toLocaleString()}`,
        `🖱 Clicks: ${ev.clicks} (CTR ${ev.ctr.toFixed(2)}%)`,
        `📋 Form fills: ${ev.form_fills}`,
        ev.cpl !== null ? `💰 CPL: $${ev.cpl.toFixed(2)} (cible $${TARGET_CPL_CAD})` : `💰 CPL: ∞ (0 lead)`,
        ev.form_completion !== null ? `📊 Form completion: ${ev.form_completion.toFixed(1)}% (cible ≥8%)` : '',
        `📅 Actif depuis: ${ev.days_active}j`,
        ``,
        `⚠️ <b>Triggers:</b>`,
        ...ev.triggers.map(t => `  • ${t}`),
        ``,
        `💡 Audite ton Instant Form (prefill ON, ≤2 questions custom, intro screen).`,
        `Pour pause: Meta Ads Manager → ad set ${ev.ad_set_id} → OFF`,
      ].filter(Boolean).join('\n');

      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: lines,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[
            { text: '🔴 Pauser sur Meta', url: `https://business.facebook.com/adsmanager/manage/adsets?act=${adAccountId}&selected_adset_ids=${ev.ad_set_id}` },
          ]]},
        }),
      }).catch(() => {});
      alerts_sent++;
    }
  }

  return NextResponse.json({
    ok: true,
    evaluated: evaluations.length,
    to_pause: toAlert.length,
    alerts_sent,
    evaluations: evaluations.map(e => ({
      ad_set: e.ad_set_name,
      campaign: e.campaign_name,
      verdict: e.verdict,
      spend: e.spend,
      cpl: e.cpl,
      form_fills: e.form_fills,
      ctr: e.ctr,
      form_completion: e.form_completion,
      triggers: e.triggers,
    })),
  });
}
