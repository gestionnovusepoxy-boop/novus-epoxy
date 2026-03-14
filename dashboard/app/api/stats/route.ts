import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query as db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const periode = req.nextUrl.searchParams.get('periode') ?? '30d';
  const jours   = periode === '7d' ? 7 : periode === '90d' ? 90 : 30;

  

  const [visitesRow, visitesPrevRow, leadsRow, leadsPrevRow, emailsRow, topPagesRow, serieVisitesRow, serieLeadsRow] =
    await Promise.all([
      // Visites période courante
      db(`SELECT COUNT(*)::int AS visites, COUNT(DISTINCT visitor_hash)::int AS visiteurs_uniques
          FROM page_views WHERE created_at >= NOW() - INTERVAL '${jours} days'`),

      // Visites période précédente
      db(`SELECT COUNT(*)::int AS visites, COUNT(DISTINCT visitor_hash)::int AS visiteurs_uniques
          FROM page_views
          WHERE created_at >= NOW() - INTERVAL '${jours * 2} days'
            AND created_at  < NOW() - INTERVAL '${jours} days'`),

      // Leads courants
      db(`SELECT COUNT(*)::int AS total FROM submissions WHERE created_at >= NOW() - INTERVAL '${jours} days'`),

      // Leads précédents
      db(`SELECT COUNT(*)::int AS total FROM submissions
          WHERE created_at >= NOW() - INTERVAL '${jours * 2} days'
            AND created_at  < NOW() - INTERVAL '${jours} days'`),

      // Emails ouverts
      db(`SELECT COUNT(*)::int AS total FROM email_logs
          WHERE statut IN ('opened','clicked') AND created_at >= NOW() - INTERVAL '${jours} days'`),

      // Top pages
      db(`SELECT url_path, COUNT(*)::int AS vues FROM page_views
          WHERE created_at >= NOW() - INTERVAL '${jours} days'
          GROUP BY url_path ORDER BY vues DESC LIMIT 10`),

      // Série visites par jour
      db(`SELECT DATE(created_at) AS date, COUNT(*)::int AS visites, COUNT(DISTINCT visitor_hash)::int AS visiteurs
          FROM page_views WHERE created_at >= NOW() - INTERVAL '${jours} days'
          GROUP BY DATE(created_at) ORDER BY date ASC`),

      // Série leads par semaine
      db(`SELECT TO_CHAR(DATE_TRUNC('week', created_at), 'YYYY-"W"IW') AS semaine, COUNT(*)::int AS leads
          FROM submissions WHERE created_at >= NOW() - INTERVAL '${jours} days'
          GROUP BY DATE_TRUNC('week', created_at) ORDER BY DATE_TRUNC('week', created_at) ASC`),
    ]);

  const v  = (visitesRow[0]     as { visites: number; visiteurs_uniques: number });
  const vp = (visitesPrevRow[0] as { visites: number; visiteurs_uniques: number });
  const l  = (leadsRow[0]       as { total: number }).total;
  const lp = (leadsPrevRow[0]   as { total: number }).total;

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
    },
    top_pages:      topPagesRow,
    serie_visites:  serieVisitesRow,
    serie_leads:    serieLeadsRow,
  });
}
