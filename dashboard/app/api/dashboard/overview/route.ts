import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  // 1. Revenue — actually collected money
  const invoices = await query(`
    SELECT
      COALESCE(SUM(CASE WHEN depot_paye THEN depot_montant ELSE 0 END), 0)::numeric AS depots_recus,
      COALESCE(SUM(CASE WHEN final_paye THEN final_montant ELSE 0 END), 0)::numeric AS soldes_recus,
      COALESCE(SUM(CASE WHEN statut = 'completee' THEN total ELSE 0 END), 0)::numeric AS total_facture,
      COUNT(CASE WHEN statut = 'completee' THEN 1 END)::int AS factures_completees,
      COUNT(CASE WHEN NOT final_paye AND depot_paye THEN 1 END)::int AS soldes_en_attente,
      COALESCE(SUM(CASE WHEN NOT final_paye AND depot_paye THEN final_montant ELSE 0 END), 0)::numeric AS soldes_a_recevoir
    FROM invoices
  `);
  const inv = invoices[0];
  const encaisse = Number(inv.depots_recus) + Number(inv.soldes_recus);
  const a_recevoir = Number(inv.soldes_a_recevoir);

  // 2. Pipeline — quotes sent but not signed/paid
  const pipeline = await query(`
    SELECT
      COUNT(CASE WHEN statut = 'envoye' THEN 1 END)::int AS devis_envoyes,
      COALESCE(SUM(CASE WHEN statut = 'envoye' THEN total ELSE 0 END), 0)::numeric AS montant_envoyes,
      COUNT(CASE WHEN statut IN ('approuve', 'contrat_signe') THEN 1 END)::int AS devis_signes,
      COALESCE(SUM(CASE WHEN statut IN ('approuve', 'contrat_signe') THEN total ELSE 0 END), 0)::numeric AS montant_signes,
      COUNT(CASE WHEN statut = 'depot_paye' THEN 1 END)::int AS depot_paye_count,
      COALESCE(SUM(CASE WHEN statut = 'depot_paye' THEN total ELSE 0 END), 0)::numeric AS montant_depot_paye,
      COUNT(CASE WHEN statut = 'complete' THEN 1 END)::int AS completes,
      COALESCE(SUM(CASE WHEN statut = 'complete' THEN total ELSE 0 END), 0)::numeric AS montant_completes
    FROM quotes
  `);
  const pipe = pipeline[0];

  // 3. Expenses + Labor costs
  const expenses = await query(`SELECT COALESCE(SUM(montant_ttc), 0)::numeric AS total FROM expenses`);
  const labor = await query(`
    SELECT COALESCE(SUM(t.heures * e.taux_horaire), 0)::numeric AS total,
           COALESCE(SUM(t.heures), 0)::numeric AS heures
    FROM time_entries t JOIN employees e ON e.id = t.employee_id
  `);
  const totalDepenses = Number(expenses[0].total);
  const totalSalaires = Number(labor[0].total);
  const totalHeures = Number(labor[0].heures);
  const profit = encaisse - totalDepenses - totalSalaires;

  // 4. Leads summary
  const leads = await query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(CASE WHEN temperature = 'chaud' THEN 1 END)::int AS chauds,
      COUNT(CASE WHEN temperature = 'tiede' THEN 1 END)::int AS tiedes,
      COUNT(CASE WHEN temperature = 'froid' THEN 1 END)::int AS froids,
      COUNT(CASE WHEN statut = 'nouveau' OR statut = 'contacte' THEN 1 END)::int AS actifs,
      COUNT(CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 1 END)::int AS nouveaux_7j
    FROM crm_leads
  `);

  // 5. Bookings / upcoming work
  const bookings = await query(`
    SELECT b.jour1_date, b.jour2_date, b.statut, q.client_nom, q.type_service, q.total
    FROM bookings b JOIN quotes q ON q.id = b.quote_id
    WHERE b.statut != 'annule' AND b.jour1_date >= CURRENT_DATE - INTERVAL '7 days'
    ORDER BY b.jour1_date ASC LIMIT 5
  `);

  // 6. Recent activity
  const recentQuotes = await query(`
    SELECT id, client_nom, total, statut, created_at FROM quotes ORDER BY created_at DESC LIMIT 3
  `);
  const recentLeads = await query(`
    SELECT id, nom, telephone, source, temperature, created_at FROM crm_leads ORDER BY created_at DESC LIMIT 3
  `);

  // 7. Expenses by category
  const expByCat = await query(`
    SELECT categorie, COALESCE(SUM(montant_ttc), 0)::numeric AS total
    FROM expenses GROUP BY categorie ORDER BY total DESC
  `);

  // 8. This month vs last month revenue
  const monthlyRev = await query(`
    SELECT
      COALESCE(SUM(CASE WHEN depot_paye_at >= date_trunc('month', CURRENT_DATE) THEN depot_montant ELSE 0 END), 0)::numeric +
      COALESCE(SUM(CASE WHEN final_paye_at >= date_trunc('month', CURRENT_DATE) THEN final_montant ELSE 0 END), 0)::numeric AS ce_mois,
      COALESCE(SUM(CASE WHEN depot_paye_at >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month') AND depot_paye_at < date_trunc('month', CURRENT_DATE) THEN depot_montant ELSE 0 END), 0)::numeric +
      COALESCE(SUM(CASE WHEN final_paye_at >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month') AND final_paye_at < date_trunc('month', CURRENT_DATE) THEN final_montant ELSE 0 END), 0)::numeric AS mois_dernier
    FROM invoices
  `);

  // 9. Submissions (website leads)
  const submissions = await query(`
    SELECT COUNT(*)::int AS total,
           COUNT(CASE WHEN statut = 'nouveau' THEN 1 END)::int AS nouveaux
    FROM submissions
  `);

  // 10. Lead sources breakdown
  const leadSources = await query(`
    SELECT source, COUNT(*)::int AS count
    FROM crm_leads
    GROUP BY source ORDER BY count DESC
  `);

  // 11. Chatbot conversations
  const chatbot = await query(`SELECT COUNT(*)::int AS count FROM conversations`);

  // 12. SMS stats
  const smsStats = await query(`
    SELECT
      COUNT(CASE WHEN direction = 'outbound' THEN 1 END)::int AS envoyes,
      COUNT(CASE WHEN direction = 'inbound' THEN 1 END)::int AS recus
    FROM sms_logs
  `).catch(() => [{ envoyes: 0, recus: 0 }]);

  return NextResponse.json({
    financier: {
      encaisse,
      a_recevoir,
      pipeline_envoye: { count: Number(pipe.devis_envoyes), montant: Number(pipe.montant_envoyes) },
      pipeline_signe: { count: Number(pipe.devis_signes), montant: Number(pipe.montant_signes) },
      projets_completes: { count: Number(pipe.completes), montant: Number(pipe.montant_completes) },
      depenses: totalDepenses,
      salaires: totalSalaires,
      heures: totalHeures,
      profit,
      ce_mois: Number(monthlyRev[0].ce_mois),
      mois_dernier: Number(monthlyRev[0].mois_dernier),
    },
    leads: leads[0],
    bookings: bookings.map(b => ({
      jour1_date: b.jour1_date ? (b.jour1_date as Date).toISOString().split('T')[0] : null,
      jour2_date: b.jour2_date ? (b.jour2_date as Date).toISOString().split('T')[0] : null,
      statut: b.statut,
      client_nom: b.client_nom,
      type_service: b.type_service,
      total: Number(b.total),
    })),
    recent: {
      quotes: recentQuotes.map(q => ({ ...q, total: Number(q.total) })),
      leads: recentLeads,
    },
    expenses_by_cat: expByCat.map(e => ({ categorie: e.categorie, total: Number(e.total) })),
    submissions: submissions[0],
    lead_sources: leadSources.map(s => ({ source: s.source as string || 'inconnu', count: Number(s.count) })),
    chatbot: { conversations: Number(chatbot[0].count) },
    sms: smsStats[0],
  });
}
