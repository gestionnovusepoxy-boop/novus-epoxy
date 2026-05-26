import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const maxDuration = 60;

/**
 * Daily 06:00 Quebec EDT (10:00 UTC) → pull Meta Ads spend for yesterday via
 * Graph API. Upsert into meta_ads_spend with cost-per-lead calc using FB lead
 * count of same day.
 *
 * Requires META_PAGE_TOKEN (system user permission ads_read or pages_read_engagement
 * with ad account access).
 *
 * Schedule via vercel.json:
 *   "/api/cron/meta-ads-spend" → "0 10 * * *"
 */
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  if (secret !== (process.env.CRON_SECRET ?? '') && secret !== (process.env.ADMIN_API_KEY ?? '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = process.env.META_PAGE_TOKEN;
  if (!token) return NextResponse.json({ error: 'META_PAGE_TOKEN missing' }, { status: 500 });

  // Date = yesterday (give Meta time to settle spend reporting)
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const dateStr = yesterday.toISOString().slice(0, 10);

  // 1) Find the ad account from the page token (Meta tokens are page-scoped, but
  //    System User tokens with ads_read can list ad accounts).
  let adAccountId = process.env.META_AD_ACCOUNT_ID ?? '';
  if (!adAccountId) {
    const adsRes = await fetch(`https://graph.facebook.com/v25.0/me/adaccounts?access_token=${token}&fields=id,name`);
    if (!adsRes.ok) {
      const err = await adsRes.json().catch(() => ({}));
      return NextResponse.json({ error: 'Cannot list ad accounts', detail: err }, { status: 502 });
    }
    const data = await adsRes.json();
    const first = data.data?.[0];
    if (!first?.id) return NextResponse.json({ error: 'No ad account found for token' }, { status: 404 });
    adAccountId = String(first.id);
  }

  // 2) Pull spend by campaign for yesterday
  // Meta Marketing API requires act_ prefix on ad account ID for insights endpoint.
  const accountWithPrefix = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  const insightsUrl = `https://graph.facebook.com/v25.0/${accountWithPrefix}/insights?level=campaign&fields=campaign_id,campaign_name,spend,impressions,clicks&time_range=${encodeURIComponent(JSON.stringify({ since: dateStr, until: dateStr }))}&access_token=${token}`;
  const insRes = await fetch(insightsUrl);
  if (!insRes.ok) {
    const err = await insRes.json().catch(() => ({}));
    return NextResponse.json({ error: 'Meta insights error', detail: err }, { status: 502 });
  }
  const ins = await insRes.json();
  type Insight = { campaign_id?: string; campaign_name?: string; spend?: string; impressions?: string; clicks?: string };
  const items = (ins.data ?? []) as Insight[];

  // 3) Lead count for yesterday from CRM
  const leadRows = await query(
    `SELECT COUNT(*)::int AS n FROM crm_leads WHERE source IN ('facebook-leadad', 'facebook-zapier') AND created_at::date = $1::date`,
    [dateStr]
  );
  const totalLeads = Number((leadRows[0] as Record<string, unknown>).n ?? 0);

  // 4) Upsert per-campaign spend.
  // Meta returns spend in the AD ACCOUNT'S currency. Quebec ad account 250180039560083
  // is in CAD → spend value IS already CAD. If account were USD, set USD_CAD_RATE env
  // to convert. Default is 1.0 (treat-as-CAD).
  let totalSpendNative = 0;
  for (const item of items) {
    const spendNative = Number(item.spend ?? 0);
    totalSpendNative += spendNative;
    const fxRate = Number(process.env.USD_CAD_RATE ?? '1.0');
    const spendCad = spendNative * fxRate;
    const spendUsd = spendNative; // kept in legacy column name; value is account currency (CAD here)
    await query(
      `INSERT INTO meta_ads_spend (date_day, ad_account_id, campaign_id, campaign_name, spend_usd, spend_cad, impressions, clicks, raw_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       ON CONFLICT (date_day, campaign_id) DO UPDATE SET
         spend_usd = EXCLUDED.spend_usd,
         spend_cad = EXCLUDED.spend_cad,
         impressions = EXCLUDED.impressions,
         clicks = EXCLUDED.clicks,
         raw_data = EXCLUDED.raw_data,
         synced_at = NOW()`,
      [dateStr, adAccountId, item.campaign_id ?? null, item.campaign_name ?? null,
       spendUsd, spendCad, Number(item.impressions ?? 0), Number(item.clicks ?? 0), JSON.stringify(item)]
    );

    // Back-fill matching meta_ads_drafts row so dashboard sees spend per draft.
    // Per ULTRAPLAN-V2 P0-2.
    if (item.campaign_id) {
      await query(
        `UPDATE meta_ads_drafts
            SET spend_usd = $1,
                impressions = $2,
                clicks = $3,
                updated_at = NOW()
          WHERE meta_campaign_id = $4`,
        [spendUsd, Number(item.impressions ?? 0), Number(item.clicks ?? 0), item.campaign_id]
      ).catch(() => {});
    }
  }

  // 5) Set leads_count + cpl_cad at account level (sum row) — write a synthetic 'TOTAL' row
  const fxRate = Number(process.env.USD_CAD_RATE ?? '1.0');
  const totalSpendCad = totalSpendNative * fxRate;
  const cplCad = totalLeads > 0 ? totalSpendCad / totalLeads : null;
  await query(
    `INSERT INTO meta_ads_spend (date_day, ad_account_id, campaign_id, campaign_name, spend_usd, spend_cad, leads_count, cpl_cad)
     VALUES ($1,$2,'TOTAL','Tous campagnes',$3,$4,$5,$6)
     ON CONFLICT (date_day, campaign_id) DO UPDATE SET
       spend_usd = EXCLUDED.spend_usd,
       spend_cad = EXCLUDED.spend_cad,
       leads_count = EXCLUDED.leads_count,
       cpl_cad = EXCLUDED.cpl_cad,
       synced_at = NOW()`,
    [dateStr, adAccountId, totalSpendNative, totalSpendCad, totalLeads, cplCad]
  );

  return NextResponse.json({
    ok: true,
    date: dateStr,
    ad_account: adAccountId,
    campaigns: items.length,
    spend_native: totalSpendNative,
    spend_cad: Number(totalSpendCad.toFixed(2)),
    leads: totalLeads,
    cpl_cad: cplCad ? Number(cplCad.toFixed(2)) : null,
  });
}
