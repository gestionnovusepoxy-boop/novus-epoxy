import { NextRequest, NextResponse } from 'next/server';
import { requireJJ } from '@/lib/auth';
import { query } from '@/lib/db';

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(req: NextRequest) {
  const gate = await requireJJ(req);
  if (gate instanceof NextResponse) return gate;

  const [chantierStats, coutMO, coutMat, workerStats, projetsStats, depensesStats] = await Promise.all([
    query(
      `SELECT
         COUNT(*) AS nb_chantiers,
         COUNT(*) FILTER (WHERE statut = 'a_planifier') AS nb_a_planifier,
         SUM(montant_contrat * COALESCE(split_pct,50)/100) FILTER (WHERE NOT paye) AS a_recevoir,
         SUM(montant_contrat * COALESCE(split_pct,50)/100) FILTER (WHERE paye)     AS recu
       FROM jj_chantiers`,
      [],
    ),
    query(
      `SELECT SUM(heures * taux_horaire) AS total FROM jj_heures`,
      [],
    ),
    query(
      `SELECT SUM(quantite * cout_unitaire) AS total FROM jj_produits`,
      [],
    ),
    query(
      `SELECT h.worker_id, w.nom,
              SUM(h.heures) AS heures_non_payees,
              SUM(h.heures * h.taux_horaire) AS montant_du
       FROM jj_heures h
       JOIN jj_workers w ON w.id = h.worker_id
       WHERE h.paye = FALSE
       GROUP BY h.worker_id, w.nom
       ORDER BY w.nom ASC`,
      [],
    ),
    query(
      `SELECT COALESCE(SUM(montant_contrat),0) AS sous_total_projets FROM jj_chantiers`,
      [],
    ),
    query(
      `SELECT
         COALESCE(SUM(sous_total) FILTER (WHERE NOT rembourse),0) AS jj_a_rembourser,
         COALESCE(SUM(sous_total) FILTER (WHERE rembourse),0)     AS jj_deja_rembourse
       FROM jj_depenses`,
      [],
    ),
  ]);

  const s = chantierStats[0] ?? {};
  const totalMO = num(coutMO[0]?.total);
  const totalMat = num(coutMat[0]?.total);

  // Marge Novus = part Novus totale (contrat × split %) − ce qu'on paye en main d'œuvre.
  const recu = num(s.recu);
  const aRecevoir = num(s.a_recevoir);
  const totalPartNovus = recu + aRecevoir;
  const margeNovus = totalPartNovus - totalMO;
  const profit = margeNovus; // alias rétro-compat

  const aPayer = workerStats.reduce((s2, w) => s2 + num(w.montant_du), 0);

  const sousTotalProjets = num(projetsStats[0]?.sous_total_projets);
  const jjARembourser = num(depensesStats[0]?.jj_a_rembourser);
  const jjDejaRembourse = num(depensesStats[0]?.jj_deja_rembourse);
  // Ce que JJ doit à Novus = la part Novus non payée (50%) + les dépenses matériel à rembourser.
  const totalDuParJj = aRecevoir + jjARembourser;

  return NextResponse.json({
    role: gate.role,
    a_recevoir: aRecevoir,
    recu,
    cout_main_oeuvre: totalMO,
    cout_materiel: totalMat,
    profit,
    marge_novus: margeNovus,
    a_payer_workers: aPayer,
    sous_total_projets: sousTotalProjets,
    jj_a_rembourser: jjARembourser,
    jj_deja_rembourse: jjDejaRembourse,
    total_du_par_jj: totalDuParJj,
    nb_chantiers: Number(s.nb_chantiers ?? 0),
    nb_a_planifier: Number(s.nb_a_planifier ?? 0),
    par_worker: workerStats.map(w => ({
      worker_id: w.worker_id,
      nom: w.nom,
      heures_non_payees: num(w.heures_non_payees),
      montant_du: num(w.montant_du),
    })),
  });
}
