import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const year = parseInt(searchParams.get('year') ?? String(new Date().getFullYear()));

  const start = `${year}-01-01`;
  const end = `${year}-12-31`;

  // Revenue from completed invoices
  const revenueRows = await query(
    `SELECT
       COALESCE(SUM(total), 0) AS revenue_total,
       COALESCE(SUM(tps), 0) AS tps_total,
       COALESCE(SUM(tvq), 0) AS tvq_total,
       COUNT(*)::int AS nb_completees
     FROM invoices WHERE statut = 'completee' AND date_emission BETWEEN $1 AND $2`,
    [start, end],
  );

  // Deposits received
  const depotRows = await query(
    `SELECT COALESCE(SUM(depot_montant), 0) AS depots_recus, COUNT(*)::int AS nb
     FROM invoices WHERE depot_paye = true AND depot_paye_at BETWEEN $1 AND $2`,
    [start, end + ' 23:59:59'],
  );

  // Outstanding amounts
  const outstandingRows = await query(
    `SELECT
       COALESCE(SUM(CASE WHEN NOT depot_paye THEN depot_montant ELSE 0 END), 0) AS depots_en_attente,
       COALESCE(SUM(CASE WHEN NOT final_paye THEN final_montant ELSE 0 END), 0) AS soldes_en_attente
     FROM invoices WHERE statut NOT IN ('annulee','completee') AND date_emission BETWEEN $1 AND $2`,
    [start, end],
  );

  // By status
  const statusRows = await query(
    `SELECT statut, COUNT(*)::int AS count FROM invoices WHERE date_emission BETWEEN $1 AND $2 GROUP BY statut`,
    [start, end],
  );

  // Monthly revenue AND expenses
  const monthlyRevRows = await query(
    `SELECT
       TO_CHAR(date_emission, 'YYYY-MM') AS mois,
       COALESCE(SUM(total), 0) AS revenue
     FROM invoices WHERE statut = 'completee' AND date_emission BETWEEN $1 AND $2
     GROUP BY mois ORDER BY mois`,
    [start, end],
  );

  const monthlyExpRows = await query(
    `SELECT
       TO_CHAR(date_depense, 'YYYY-MM') AS mois,
       COALESCE(SUM(montant_ttc), 0) AS depenses
     FROM expenses WHERE date_depense BETWEEN $1 AND $2
     GROUP BY mois ORDER BY mois`,
    [start, end],
  );

  // Merge monthly revenue + expenses
  const monthlyMap = new Map<string, { revenue: number; depenses: number }>();
  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
    monthlyMap.set(key, { revenue: 0, depenses: 0 });
  }
  for (const r of monthlyRevRows) {
    const existing = monthlyMap.get(r.mois as string);
    if (existing) existing.revenue = Number(r.revenue);
  }
  for (const e of monthlyExpRows) {
    const existing = monthlyMap.get(e.mois as string);
    if (existing) existing.depenses = Number(e.depenses);
  }
  const revenus_mensuels = Array.from(monthlyMap.entries()).map(([mois, data]) => ({
    mois, revenue: data.revenue, depenses: data.depenses, profit: Math.round((data.revenue - data.depenses) * 100) / 100,
  }));

  // All payments this year
  const paymentsRows = await query(
    `SELECT
       COALESCE(SUM(montant), 0) AS total_paiements,
       COUNT(*)::int AS nb_paiements
     FROM payments WHERE paid_at BETWEEN $1 AND $2`,
    [start, end + ' 23:59:59'],
  );

  // Total invoices this year
  const totalInvRows = await query(
    `SELECT COUNT(*)::int AS total FROM invoices WHERE date_emission BETWEEN $1 AND $2`,
    [start, end],
  );

  // Expenses
  const expenseRows = await query(
    `SELECT
       COALESCE(SUM(montant_ttc), 0) AS depenses_total,
       COALESCE(SUM(montant_ht), 0) AS depenses_ht,
       COALESCE(SUM(tps), 0) AS tps_depenses,
       COALESCE(SUM(tvq), 0) AS tvq_depenses,
       COUNT(*)::int AS nb_depenses
     FROM expenses WHERE date_depense BETWEEN $1 AND $2`,
    [start, end],
  );

  // Expenses by category
  const expByCatRows = await query(
    `SELECT categorie, COALESCE(SUM(montant_ttc), 0) AS total, COUNT(*)::int AS count
     FROM expenses WHERE date_depense BETWEEN $1 AND $2 GROUP BY categorie ORDER BY total DESC`,
    [start, end],
  );

  // Bank reconciliation stats
  const bankRows = await query(
    `SELECT
       COUNT(*)::int AS nb_transactions,
       COUNT(*) FILTER (WHERE reconciled) ::int AS nb_reconciled
     FROM bank_transactions WHERE date_tx BETWEEN $1 AND $2`,
    [start, end],
  );

  // === QUARTERLY TPS/TVQ BREAKDOWN ===
  const quarters = [
    { q: 'T1', start: `${year}-01-01`, end: `${year}-03-31`, deadline: `${year}-04-30` },
    { q: 'T2', start: `${year}-04-01`, end: `${year}-06-30`, deadline: `${year}-07-31` },
    { q: 'T3', start: `${year}-07-01`, end: `${year}-09-30`, deadline: `${year}-10-31` },
    { q: 'T4', start: `${year}-10-01`, end: `${year}-12-31`, deadline: `${year + 1}-01-31` },
  ];

  const quarterlyData = [];
  for (const qt of quarters) {
    const qRev = await query(
      `SELECT COALESCE(SUM(tps), 0) AS tps_percu, COALESCE(SUM(tvq), 0) AS tvq_percu, COALESCE(SUM(total), 0) AS revenue
       FROM invoices WHERE statut = 'completee' AND date_emission BETWEEN $1 AND $2`,
      [qt.start, qt.end],
    );
    const qExp = await query(
      `SELECT COALESCE(SUM(tps), 0) AS tps_paye, COALESCE(SUM(tvq), 0) AS tvq_paye, COALESCE(SUM(montant_ttc), 0) AS depenses
       FROM expenses WHERE date_depense BETWEEN $1 AND $2`,
      [qt.start, qt.end],
    );
    const tpsPercu = Number(qRev[0]?.tps_percu ?? 0);
    const tvqPercu = Number(qRev[0]?.tvq_percu ?? 0);
    const tpsPaye = Number(qExp[0]?.tps_paye ?? 0);
    const tvqPaye = Number(qExp[0]?.tvq_paye ?? 0);
    quarterlyData.push({
      trimestre: qt.q,
      periode: `${qt.start} au ${qt.end}`,
      deadline: qt.deadline,
      revenue: Number(qRev[0]?.revenue ?? 0),
      depenses: Number(qExp[0]?.depenses ?? 0),
      tps_percu: tpsPercu,
      tps_paye: tpsPaye,
      tps_net: Math.round((tpsPercu - tpsPaye) * 100) / 100,
      tvq_percu: tvqPercu,
      tvq_paye: tvqPaye,
      tvq_net: Math.round((tvqPercu - tvqPaye) * 100) / 100,
    });
  }

  // === OUTSTANDING INVOICES (who owes money) ===
  const outstandingInvoices = await query(
    `SELECT i.id, i.numero, COALESCE(c.nom, 'Client #' || i.client_id) AS client_nom,
       i.total, i.depot_montant, i.depot_paye, i.final_montant, i.final_paye,
       i.date_emission, i.statut,
       CURRENT_DATE - i.date_emission::date AS jours_depuis
     FROM invoices i LEFT JOIN clients c ON i.client_id = c.id
     WHERE i.statut NOT IN ('annulee', 'completee') AND i.date_emission BETWEEN $1 AND $2
     ORDER BY i.date_emission ASC`,
    [start, end],
  );

  // === TOP EXPENSES (biggest single expenses) ===
  const topExpenses = await query(
    `SELECT fournisseur, description, montant_ttc, date_depense, categorie
     FROM expenses WHERE date_depense BETWEEN $1 AND $2
     ORDER BY montant_ttc DESC LIMIT 10`,
    [start, end],
  );

  const revTotal = Number(revenueRows[0]?.revenue_total ?? 0);
  const depTotal = Number(expenseRows[0]?.depenses_total ?? 0);

  return NextResponse.json({
    year,
    revenue_total: revTotal,
    tps_total: Number(revenueRows[0]?.tps_total ?? 0),
    tvq_total: Number(revenueRows[0]?.tvq_total ?? 0),
    nb_completees: revenueRows[0]?.nb_completees ?? 0,
    depots_recus: Number(depotRows[0]?.depots_recus ?? 0),
    nb_depots: depotRows[0]?.nb ?? 0,
    depots_en_attente: Number(outstandingRows[0]?.depots_en_attente ?? 0),
    soldes_en_attente: Number(outstandingRows[0]?.soldes_en_attente ?? 0),
    par_statut: statusRows,
    revenus_mensuels,
    total_paiements: Number(paymentsRows[0]?.total_paiements ?? 0),
    nb_paiements: paymentsRows[0]?.nb_paiements ?? 0,
    nb_factures: totalInvRows[0]?.total ?? 0,
    // Expenses
    depenses_total: depTotal,
    depenses_ht: Number(expenseRows[0]?.depenses_ht ?? 0),
    tps_depenses: Number(expenseRows[0]?.tps_depenses ?? 0),
    tvq_depenses: Number(expenseRows[0]?.tvq_depenses ?? 0),
    nb_depenses: expenseRows[0]?.nb_depenses ?? 0,
    depenses_par_categorie: expByCatRows,
    // Profit
    profit_net: Math.round((revTotal - depTotal) * 100) / 100,
    // Bank
    nb_transactions_bank: bankRows[0]?.nb_transactions ?? 0,
    nb_reconciled_bank: bankRows[0]?.nb_reconciled ?? 0,
    // NEW: Quarterly TPS/TVQ
    trimestriel: quarterlyData,
    // NEW: Outstanding invoices
    factures_impayees: outstandingInvoices,
    // NEW: Top expenses
    top_depenses: topExpenses,
  });
}
