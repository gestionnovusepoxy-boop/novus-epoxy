import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

/**
 * GET /api/agents/cost?period=24h|7d|30d
 * Returns LLM cost breakdown by agent and tier.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  const apiKey = req.headers.get('x-api-key');
  if (!session && apiKey !== process.env.ADMIN_API_KEY) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const period = (new URL(req.url).searchParams.get('period') ?? '24h').toLowerCase();
  const interval = period === '7d' ? "7 days" : period === '30d' ? "30 days" : "24 hours";

  const [byAgent, byTier, hourly, totals] = await Promise.all([
    query(
      `SELECT agent,
              COUNT(*)::int AS calls,
              COALESCE(SUM(total_tokens),0)::int AS tokens,
              COALESCE(SUM(cost_usd),0)::numeric(10,4) AS cost_usd,
              AVG(latency_ms)::int AS avg_latency_ms
         FROM llm_calls
        WHERE created_at >= NOW() - $1::interval
        GROUP BY agent
        ORDER BY cost_usd DESC`,
      [interval]
    ).catch(() => []),
    query(
      `SELECT tier, model,
              COUNT(*)::int AS calls,
              COALESCE(SUM(total_tokens),0)::int AS tokens,
              COALESCE(SUM(cost_usd),0)::numeric(10,4) AS cost_usd
         FROM llm_calls
        WHERE created_at >= NOW() - $1::interval
        GROUP BY tier, model
        ORDER BY cost_usd DESC`,
      [interval]
    ).catch(() => []),
    query(
      `SELECT date_trunc('hour', created_at) AS hour,
              COUNT(*)::int AS calls,
              COALESCE(SUM(cost_usd),0)::numeric(10,4) AS cost_usd
         FROM llm_calls
        WHERE created_at >= NOW() - $1::interval
        GROUP BY 1 ORDER BY 1 DESC LIMIT 168`,
      [interval]
    ).catch(() => []),
    query(
      `SELECT COUNT(*)::int AS calls,
              COALESCE(SUM(total_tokens),0)::int AS tokens,
              COALESCE(SUM(cost_usd),0)::numeric(10,4) AS cost_usd,
              AVG(latency_ms)::int AS avg_latency_ms,
              COUNT(*) FILTER (WHERE error IS NOT NULL)::int AS errors
         FROM llm_calls
        WHERE created_at >= NOW() - $1::interval`,
      [interval]
    ).catch(() => [{ calls: 0, tokens: 0, cost_usd: 0, avg_latency_ms: 0, errors: 0 }]),
  ]);

  return NextResponse.json({
    period,
    totals: totals[0] ?? { calls: 0, tokens: 0, cost_usd: 0, avg_latency_ms: 0, errors: 0 },
    by_agent: byAgent,
    by_tier: byTier,
    hourly,
  });
}
