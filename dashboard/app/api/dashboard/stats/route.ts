import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  // 1. Revenue by month (last 12 months)
  const revenueByMonth = await query(`
    SELECT to_char(date_trunc('month', COALESCE(depot_paye_at, final_paye_at, created_at)), 'YYYY-MM') AS mois,
           COALESCE(SUM(CASE WHEN depot_paye THEN depot_montant ELSE 0 END), 0)::numeric AS depots,
           COALESCE(SUM(CASE WHEN final_paye THEN final_montant ELSE 0 END), 0)::numeric AS soldes
    FROM invoices
    WHERE COALESCE(depot_paye_at, final_paye_at, created_at) >= NOW() - INTERVAL '12 months'
    GROUP BY mois ORDER BY mois
  `);

  // 2. Quotes by month
  const quotesByMonth = await query(`
    SELECT to_char(created_at, 'YYYY-MM') AS mois,
           COUNT(*)::int AS count,
           COALESCE(SUM(total), 0)::numeric AS total
    FROM quotes
    WHERE created_at >= NOW() - INTERVAL '12 months' AND is_subcontract IS NOT TRUE
    GROUP BY mois ORDER BY mois
  `);

  // 3. Leads by week (last 8 weeks) — clear date format
  const leadsByWeek = await query(`
    SELECT to_char(date_trunc('week', created_at), 'DD Mon') AS semaine,
           to_char(date_trunc('week', created_at), 'YYYY-MM-DD') AS semaine_iso,
           COUNT(*)::int AS count
    FROM crm_leads
    WHERE created_at >= NOW() - INTERVAL '8 weeks'
    GROUP BY semaine, semaine_iso ORDER BY semaine_iso
  `);

  // 4. Leads by source with revenue attribution — group CSV sources together
  const sourcePerf = await query(`
    SELECT
      CASE
        WHEN l.source ILIKE 'csv:%' OR l.source ILIKE 'csv-%' THEN 'Import CSV (Jason)'
        WHEN l.source ILIKE 'Import Jason%' THEN 'Import CSV (Jason)'
        WHEN l.source ILIKE 'facebook%' OR l.source = 'Facebook Ads' OR l.source = 'fb' THEN 'Facebook Ads'
        WHEN l.source IN ('site_web', 'Site web', 'site web') THEN 'Site web'
        WHEN l.source = 'ghl' THEN 'GoHighLevel'
        WHEN l.source = 'prospection' THEN 'Prospection (Denis)'
        ELSE COALESCE(l.source, 'Inconnu')
      END AS source,
      COUNT(DISTINCT l.id)::int AS leads,
      COUNT(DISTINCT q.id)::int AS devis,
      COALESCE(SUM(DISTINCT q.total), 0)::numeric AS revenu_potentiel,
      COUNT(DISTINCT CASE WHEN q.statut IN ('depot_paye','complete') THEN q.id END)::int AS signes
    FROM crm_leads l
    LEFT JOIN quotes q ON REPLACE(REPLACE(REPLACE(q.client_tel, '-', ''), ' ', ''), '+', '') LIKE '%' || RIGHT(REPLACE(REPLACE(l.telephone, '-', ''), ' ', ''), 10)
    GROUP BY 1
    ORDER BY leads DESC
  `);

  // 5. Conversion funnel
  const funnel = await query(`
    SELECT
      (SELECT COUNT(*)::int FROM crm_leads) AS total_leads,
      (SELECT COUNT(*)::int FROM crm_leads WHERE statut IN ('contacte','interesse','devis_envoye','rdv_pris','gagne')) AS contactes,
      (SELECT COUNT(*)::int FROM crm_leads WHERE statut IN ('devis_envoye','rdv_pris','gagne')) AS devis_envoyes,
      (SELECT COUNT(*)::int FROM quotes WHERE statut IN ('contrat_signe','depot_paye','planifie','complete') AND is_subcontract IS NOT TRUE) AS signes,
      (SELECT COUNT(*)::int FROM quotes WHERE statut = 'complete' AND is_subcontract IS NOT TRUE) AS completes,
      (SELECT COUNT(*)::int FROM invoices WHERE statut = 'completee') AS payes
  `);

  // 6. Website stats
  const siteStats = await query(`
    SELECT
      COUNT(*)::int AS visites,
      COUNT(DISTINCT visitor_hash)::int AS visiteurs_uniques,
      COUNT(DISTINCT session_hash)::int AS sessions
    FROM page_views
    WHERE created_at >= NOW() - INTERVAL '30 days'
  `);

  // Top pages
  const topPages = await query(`
    SELECT url_path AS page, COUNT(*)::int AS vues
    FROM page_views
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY url_path ORDER BY vues DESC LIMIT 10
  `);

  // Referrers
  const referrers = await query(`
    SELECT
      CASE
        WHEN referrer IS NULL OR referrer = '' THEN 'Direct'
        WHEN referrer ILIKE '%google%' THEN 'Google'
        WHEN referrer ILIKE '%facebook%' OR referrer ILIKE '%fb.%' THEN 'Facebook'
        WHEN referrer ILIKE '%instagram%' THEN 'Instagram'
        WHEN referrer ILIKE '%homestars%' THEN 'HomeStars'
        WHEN referrer ILIKE '%houzz%' THEN 'Houzz'
        ELSE 'Autre'
      END AS source,
      COUNT(*)::int AS vues
    FROM page_views
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY source ORDER BY vues DESC
  `);

  // 7. Email stats
  const emailStats = await query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(CASE WHEN statut = 'sent' THEN 1 END)::int AS envoyes,
      COUNT(CASE WHEN statut = 'error' THEN 1 END)::int AS erreurs,
      COUNT(CASE WHEN statut = 'skipped' THEN 1 END)::int AS ignores
    FROM email_logs
  `);

  const emailsByDay = await query(`
    SELECT to_char(created_at, 'YYYY-MM-DD') AS jour,
           COUNT(CASE WHEN statut = 'sent' THEN 1 END)::int AS envoyes,
           COUNT(CASE WHEN statut = 'error' THEN 1 END)::int AS erreurs
    FROM email_logs
    WHERE created_at >= NOW() - INTERVAL '14 days'
    GROUP BY jour ORDER BY jour
  `);

  // 8. SMS stats
  const smsStats = await query(`
    SELECT
      COUNT(CASE WHEN direction = 'outbound' THEN 1 END)::int AS envoyes,
      COUNT(CASE WHEN direction = 'inbound' THEN 1 END)::int AS recus
    FROM sms_logs
  `).catch(() => [{ envoyes: 0, recus: 0 }]);

  // 9. Employee productivity
  const productivity = await query(`
    SELECT e.nom,
           e.taux_horaire,
           COALESCE(SUM(t.heures), 0)::numeric AS heures,
           COALESCE(SUM(t.heures * e.taux_horaire), 0)::numeric AS cout,
           COUNT(DISTINCT t.quote_id)::int AS projets,
           COUNT(DISTINCT t.date_travail)::int AS jours
    FROM employees e
    LEFT JOIN time_entries t ON t.employee_id = e.id
    GROUP BY e.id, e.nom, e.taux_horaire
    ORDER BY heures DESC
  `);

  // 10. Average deal size
  const dealStats = await query(`
    SELECT
      COALESCE(AVG(total), 0)::numeric AS deal_moyen,
      COALESCE(MIN(total), 0)::numeric AS deal_min,
      COALESCE(MAX(total), 0)::numeric AS deal_max,
      COUNT(*)::int AS total_devis
    FROM quotes
  `);

  // 11. Expenses by month
  const expensesByMonth = await query(`
    SELECT to_char(date_depense, 'YYYY-MM') AS mois,
           COALESCE(SUM(montant_ttc), 0)::numeric AS total
    FROM expenses
    GROUP BY mois ORDER BY mois
  `);

  return NextResponse.json({
    revenue_by_month: revenueByMonth.map(r => ({ mois: r.mois, depots: Number(r.depots), soldes: Number(r.soldes), total: Number(r.depots) + Number(r.soldes) })),
    quotes_by_month: quotesByMonth.map(q => ({ mois: q.mois, count: q.count, total: Number(q.total) })),
    leads_by_week: leadsByWeek.map(l => ({ semaine: l.semaine, count: l.count })),
    source_performance: sourcePerf.map(s => ({ source: s.source as string, leads: s.leads, devis: s.devis, revenu_potentiel: Number(s.revenu_potentiel), signes: s.signes })),
    funnel: funnel[0],
    site: { ...siteStats[0], top_pages: topPages, referrers },
    emails: { ...emailStats[0], by_day: emailsByDay },
    sms: smsStats[0],
    productivity: productivity.map(p => ({ nom: p.nom, taux: Number(p.taux_horaire), heures: Number(p.heures), cout: Number(p.cout), projets: p.projets, jours: p.jours })),
    deals: { moyen: Number(dealStats[0].deal_moyen), min: Number(dealStats[0].deal_min), max: Number(dealStats[0].deal_max), total: dealStats[0].total_devis },
    expenses_by_month: expensesByMonth.map(e => ({ mois: e.mois, total: Number(e.total) })),
  });
}
