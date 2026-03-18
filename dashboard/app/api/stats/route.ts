import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query as db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const periode = req.nextUrl.searchParams.get('periode') ?? '30d';
  const jours   = periode === '7d' ? 7 : periode === '90d' ? 90 : 30;

  // Paramétrisé : $1 = intervalle courant (ex: '30 days'), $2 = intervalle double (ex: '60 days')
  const intervalCur  = `${jours} days`;
  const intervalPrev = `${jours * 2} days`;

  const [
    visitesRow, visitesPrevRow, leadsRow, leadsPrevRow, emailsRow,
    topPagesRow, serieVisitesRow, serieLeadsRow,
    revenusRow, revenusPrevRow, pipelineRow, prochainRdvRow, serieRevenusRow,
  ] = await Promise.all([
      db(`SELECT COUNT(*)::int AS visites, COUNT(DISTINCT visitor_hash)::int AS visiteurs_uniques
          FROM page_views WHERE created_at >= NOW() - $1::interval`, [intervalCur]),

      db(`SELECT COUNT(*)::int AS visites, COUNT(DISTINCT visitor_hash)::int AS visiteurs_uniques
          FROM page_views
          WHERE created_at >= NOW() - $1::interval AND created_at < NOW() - $2::interval`,
        [intervalPrev, intervalCur]),

      db(`SELECT COUNT(*)::int AS total FROM submissions WHERE created_at >= NOW() - $1::interval`,
        [intervalCur]),

      db(`SELECT COUNT(*)::int AS total FROM submissions
          WHERE created_at >= NOW() - $1::interval AND created_at < NOW() - $2::interval`,
        [intervalPrev, intervalCur]),

      db(`SELECT COUNT(*)::int AS total FROM email_logs
          WHERE statut IN ('opened','clicked') AND created_at >= NOW() - $1::interval`,
        [intervalCur]),

      db(`SELECT url_path, COUNT(*)::int AS vues FROM page_views
          WHERE created_at >= NOW() - $1::interval
          GROUP BY url_path ORDER BY vues DESC LIMIT 10`,
        [intervalCur]),

      db(`SELECT DATE(created_at)::text AS date, COUNT(*)::int AS visites, COUNT(DISTINCT visitor_hash)::int AS visiteurs
          FROM page_views WHERE created_at >= NOW() - $1::interval
          GROUP BY DATE(created_at) ORDER BY date ASC`,
        [intervalCur]),

      db(`SELECT TO_CHAR(DATE_TRUNC('week', created_at), 'YYYY-"W"IW') AS semaine, COUNT(*)::int AS leads
          FROM submissions WHERE created_at >= NOW() - $1::interval
          GROUP BY DATE_TRUNC('week', created_at) ORDER BY DATE_TRUNC('week', created_at) ASC`,
        [intervalCur]),

      // Revenue current period
      db(`SELECT COALESCE(SUM(total), 0)::numeric AS revenus
          FROM quotes
          WHERE statut NOT IN ('brouillon','refuse') AND created_at >= NOW() - $1::interval`,
        [intervalCur]),

      // Revenue previous period
      db(`SELECT COALESCE(SUM(total), 0)::numeric AS revenus
          FROM quotes
          WHERE statut NOT IN ('brouillon','refuse')
            AND created_at >= NOW() - $1::interval AND created_at < NOW() - $2::interval`,
        [intervalPrev, intervalCur]),

      // Pipeline — count of quotes by statut
      db(`SELECT statut, COUNT(*)::int AS count
          FROM quotes
          GROUP BY statut
          ORDER BY count DESC`),

      // Upcoming bookings
      db(`SELECT *
          FROM bookings
          WHERE jour1_date >= CURRENT_DATE
          ORDER BY jour1_date ASC
          LIMIT 5`),

      // Revenue series (daily)
      db(`SELECT DATE(created_at)::text AS date, COALESCE(SUM(total), 0)::numeric AS revenus
          FROM quotes
          WHERE statut NOT IN ('brouillon','refuse') AND created_at >= NOW() - $1::interval
          GROUP BY DATE(created_at)
          ORDER BY date ASC`,
        [intervalCur]),
    ]);

  const v  = visitesRow[0]     as { visites: number; visiteurs_uniques: number };
  const vp = visitesPrevRow[0] as { visites: number; visiteurs_uniques: number };
  const l  = (leadsRow[0]       as { total: number }).total;
  const lp = (leadsPrevRow[0]   as { total: number }).total;
  const r  = Number((revenusRow[0]     as { revenus: string }).revenus);
  const rp = Number((revenusPrevRow[0] as { revenus: string }).revenus);

  function variation(a: number, b: number) {
    if (b === 0) return a > 0 ? 100 : 0;
    return Math.round((a - b) / b * 1000) / 10;
  }

  const taux     = v.visiteurs_uniques > 0 ? Math.round(l / v.visiteurs_uniques * 1000) / 10 : 0;
  const tauxPrev = vp.visiteurs_uniques > 0 ? Math.round(lp / vp.visiteurs_uniques * 1000) / 10 : 0;

  return NextResponse.json({
    periode,
    metriques: {
      visites:              v.visites,
      visites_variation:    variation(v.visites, vp.visites),
      visiteurs_uniques:    v.visiteurs_uniques,
      visiteurs_variation:  variation(v.visiteurs_uniques, vp.visiteurs_uniques),
      leads:                l,
      leads_variation:      variation(l, lp),
      taux_conversion:      taux,
      taux_variation:       Math.round((taux - tauxPrev) * 10) / 10,
      emails_ouverts:       (emailsRow[0] as { total: number }).total,
      revenus:              r,
      revenus_variation:    variation(r, rp),
    },
    top_pages:      topPagesRow,
    serie_visites:  serieVisitesRow,
    serie_leads:    serieLeadsRow,
    pipeline:       pipelineRow,
    prochains_rdv:  prochainRdvRow,
    serie_revenus:  serieRevenusRow,
  });
}
