import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

// GET /api/ads/list — all FB ad drafts with their spend/impressions/leads
export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const drafts = await query(
    `SELECT id, service, headline, primary_text, cta, image_url, image_source,
            daily_budget_usd, duration_days, target_audience,
            statut, approved_at, approved_by, launched_at,
            meta_campaign_id, meta_adset_id, meta_ad_id, error,
            spend_usd, impressions, clicks, leads_generated,
            created_at, updated_at
       FROM meta_ads_drafts
      ORDER BY id DESC`
  ).catch(() => []);

  // Aggregate per service
  const summary = {
    total_drafts: drafts.length,
    by_statut: drafts.reduce((acc: Record<string, number>, d) => {
      const k = String(d.statut ?? 'unknown');
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {}),
    by_service: drafts.reduce((acc: Record<string, number>, d) => {
      const k = String(d.service ?? 'unknown');
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {}),
    total_spend_usd: drafts.reduce((s: number, d) => s + Number(d.spend_usd ?? 0), 0),
    total_impressions: drafts.reduce((s: number, d) => s + Number(d.impressions ?? 0), 0),
    total_clicks: drafts.reduce((s: number, d) => s + Number(d.clicks ?? 0), 0),
    total_leads: drafts.reduce((s: number, d) => s + Number(d.leads_generated ?? 0), 0),
  };

  // Also pull daily spend for last 7 days from meta_ads_spend
  const recentSpend = await query(
    `SELECT date_day, SUM(spend_cad)::numeric(10,2) as spend_cad, SUM(impressions)::int as impressions, SUM(clicks)::int as clicks, MAX(leads_count)::int as leads
       FROM meta_ads_spend WHERE date_day >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY date_day ORDER BY date_day DESC`
  ).catch(() => []);

  return NextResponse.json({ drafts, summary, recent_spend: recentSpend });
}
