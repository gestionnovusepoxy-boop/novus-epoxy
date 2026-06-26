import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  // Run ALL independent queries in parallel for speed
  const [invoices, pipeline, expenses, labor] = await Promise.all([
    query(`SELECT
      COALESCE(SUM(CASE WHEN depot_paye THEN depot_montant ELSE 0 END), 0)::numeric AS depots_recus,
      COALESCE(SUM(CASE WHEN final_paye THEN final_montant ELSE 0 END), 0)::numeric AS soldes_recus,
      COALESCE(SUM(CASE WHEN statut = 'completee' THEN total ELSE 0 END), 0)::numeric AS total_facture,
      COUNT(CASE WHEN statut = 'completee' THEN 1 END)::int AS factures_completees,
      COUNT(CASE WHEN NOT final_paye AND depot_paye THEN 1 END)::int AS soldes_en_attente,
      COALESCE(SUM(CASE WHEN NOT final_paye AND depot_paye THEN final_montant ELSE 0 END), 0)::numeric AS soldes_a_recevoir
    FROM invoices`),
    query(`SELECT
      COUNT(CASE WHEN statut = 'envoye' THEN 1 END)::int AS devis_envoyes,
      COALESCE(SUM(CASE WHEN statut = 'envoye' THEN total ELSE 0 END), 0)::numeric AS montant_envoyes,
      COUNT(CASE WHEN statut IN ('approuve', 'contrat_signe') THEN 1 END)::int AS devis_signes,
      COALESCE(SUM(CASE WHEN statut IN ('approuve', 'contrat_signe') THEN total ELSE 0 END), 0)::numeric AS montant_signes,
      COUNT(CASE WHEN statut = 'depot_paye' THEN 1 END)::int AS depot_paye_count,
      COALESCE(SUM(CASE WHEN statut = 'depot_paye' THEN total ELSE 0 END), 0)::numeric AS montant_depot_paye,
      COUNT(CASE WHEN statut = 'complete' THEN 1 END)::int AS completes,
      COALESCE(SUM(CASE WHEN statut = 'complete' THEN total ELSE 0 END), 0)::numeric AS montant_completes
    FROM quotes WHERE is_subcontract IS NOT TRUE`),
    query(`SELECT COALESCE(SUM(montant_ttc), 0)::numeric AS total FROM expenses`),
    query(`SELECT COALESCE(SUM(t.heures * e.taux_horaire), 0)::numeric AS total,
           COALESCE(SUM(t.heures), 0)::numeric AS heures
    FROM time_entries t JOIN employees e ON e.id = t.employee_id`),
  ]);
  const inv = invoices[0];
  const encaisse = Number(inv.depots_recus) + Number(inv.soldes_recus);
  const a_recevoir = Number(inv.soldes_a_recevoir);
  const pipe = pipeline[0];
  const totalDepenses = Number(expenses[0].total);
  const totalSalaires = Number(labor[0].total);
  const totalHeures = Number(labor[0].heures);
  const profit = encaisse - totalDepenses - totalSalaires;

  // 4-11: All independent queries in parallel
  const [leads, bookings, recentQuotes, recentLeads, expByCat, monthlyRev, submissions, leadSources, chatbot] = await Promise.all([
    query(`SELECT COUNT(*)::int AS total,
      COUNT(CASE WHEN temperature = 'chaud' THEN 1 END)::int AS chauds,
      COUNT(CASE WHEN temperature = 'tiede' THEN 1 END)::int AS tiedes,
      COUNT(CASE WHEN temperature = 'froid' THEN 1 END)::int AS froids,
      COUNT(CASE WHEN statut = 'nouveau' OR statut = 'contacte' THEN 1 END)::int AS actifs,
      COUNT(CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 1 END)::int AS nouveaux_7j
    FROM crm_leads`),
    query(`SELECT b.jour1_date, b.jour2_date, b.statut, q.client_nom, q.type_service, q.total
    FROM bookings b JOIN quotes q ON q.id = b.quote_id
    WHERE b.statut != 'annule' AND b.jour1_date >= CURRENT_DATE - INTERVAL '7 days'
    ORDER BY b.jour1_date ASC LIMIT 5`),
    query(`SELECT id, client_nom, total, statut, created_at FROM quotes WHERE is_subcontract IS NOT TRUE ORDER BY created_at DESC LIMIT 3`),
    query(`SELECT id, nom, telephone, source, temperature, created_at FROM crm_leads ORDER BY created_at DESC LIMIT 3`),
    query(`SELECT categorie, COALESCE(SUM(montant_ttc), 0)::numeric AS total FROM expenses GROUP BY categorie ORDER BY total DESC`),
    query(`SELECT
      COALESCE(SUM(CASE WHEN depot_paye_at >= date_trunc('month', CURRENT_DATE) THEN depot_montant ELSE 0 END), 0)::numeric +
      COALESCE(SUM(CASE WHEN final_paye_at >= date_trunc('month', CURRENT_DATE) THEN final_montant ELSE 0 END), 0)::numeric AS ce_mois,
      COALESCE(SUM(CASE WHEN depot_paye_at >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month') AND depot_paye_at < date_trunc('month', CURRENT_DATE) THEN depot_montant ELSE 0 END), 0)::numeric +
      COALESCE(SUM(CASE WHEN final_paye_at >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month') AND final_paye_at < date_trunc('month', CURRENT_DATE) THEN final_montant ELSE 0 END), 0)::numeric AS mois_dernier
    FROM invoices`),
    query(`SELECT COUNT(*)::int AS total, COUNT(CASE WHEN statut = 'nouveau' THEN 1 END)::int AS nouveaux FROM submissions`),
    query(`SELECT source, COUNT(*)::int AS count FROM crm_leads GROUP BY source ORDER BY count DESC`),
    query(`SELECT COUNT(*)::int AS count FROM conversations`),
  ]);

  // 12. SMS stats
  const smsStats = await query(`
    SELECT
      COUNT(CASE WHEN direction = 'outbound' THEN 1 END)::int AS envoyes,
      COUNT(CASE WHEN direction = 'inbound' THEN 1 END)::int AS recus
    FROM sms_logs
  `).catch(() => [{ envoyes: 0, recus: 0 }]);

  // 13-14. Actions urgentes (compteurs + détails) — toutes indépendantes → en parallèle.
  const [
    leadsChaudsNonContactes,
    devisSansReponse48h,
    depotsEnAttente,
    facturesImpayees,
    soumissionsNonTraitees,
    reservationsDemain,
    prochainsLeadsChauds,
    prochainsDevisRelance,
  ] = await Promise.all([
    query(`SELECT COUNT(*)::int AS count FROM crm_leads WHERE temperature = 'chaud' AND prospect_sent_at IS NULL`).catch(() => [{ count: 0 }]),
    query(`SELECT COUNT(*)::int AS count FROM quotes WHERE statut = 'envoye' AND sent_at <= NOW() - INTERVAL '48 hours' AND relance_1_at IS NULL`).catch(() => [{ count: 0 }]),
    query(`SELECT COUNT(*)::int AS count FROM quotes WHERE statut = 'contrat_signe' AND deposit_paid_at IS NULL`).catch(() => [{ count: 0 }]),
    query(`SELECT COUNT(*)::int AS count,
        COALESCE(SUM((CASE WHEN NOT depot_paye THEN depot_montant ELSE 0 END) + (CASE WHEN NOT final_paye THEN final_montant ELSE 0 END)), 0)::numeric AS montant
      FROM invoices WHERE statut NOT IN ('completee', 'payee', 'annulee') AND (NOT depot_paye OR NOT final_paye)`).catch(() => [{ count: 0, montant: 0 }]),
    query(`SELECT COUNT(*)::int AS count FROM submissions WHERE statut = 'nouveau'`).catch(() => [{ count: 0 }]),
    query(`SELECT COUNT(*)::int AS count FROM bookings WHERE jour1_date = CURRENT_DATE + INTERVAL '1 day' AND statut IN ('en_attente', 'confirme')`).catch(() => [{ count: 0 }]),
    query(`SELECT id, nom, telephone, created_at FROM crm_leads WHERE temperature = 'chaud' AND prospect_sent_at IS NULL ORDER BY created_at DESC LIMIT 3`).catch(() => []),
    query(`SELECT id, client_nom, client_tel, total, sent_at FROM quotes WHERE statut = 'envoye' AND sent_at <= NOW() - INTERVAL '48 hours' AND relance_1_at IS NULL ORDER BY sent_at ASC LIMIT 3`).catch(() => []),
  ]);

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
    actions_urgentes: {
      leads_chauds_non_contactes: Number(leadsChaudsNonContactes[0]?.count || 0),
      devis_sans_reponse_48h: Number(devisSansReponse48h[0]?.count || 0),
      depots_en_attente: Number(depotsEnAttente[0]?.count || 0),
      factures_impayees: Number(facturesImpayees[0]?.count || 0),
      factures_impayees_montant: Number(facturesImpayees[0]?.montant || 0),
      soumissions_non_traitees: Number(soumissionsNonTraitees[0]?.count || 0),
      reservations_demain: Number(reservationsDemain[0]?.count || 0),
    },
    prochains_leads_chauds: prochainsLeadsChauds.map(l => ({
      id: l.id,
      nom: l.nom,
      telephone: l.telephone,
      created_at: l.created_at,
    })),
    prochains_devis_relance: prochainsDevisRelance.map(q => ({
      id: q.id,
      client_nom: q.client_nom,
      client_tel: q.client_tel,
      total: Number(q.total),
      sent_at: q.sent_at,
    })),
  }, {
    // Cache privé court — la page poll aux 30s; on évite de re-frapper Neon à chaque onglet.
    headers: { 'Cache-Control': 'private, max-age=10' },
  });
}
