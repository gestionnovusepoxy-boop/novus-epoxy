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

  const [chantierStats, coutMO, coutMat, workerStats] = await Promise.all([
    query(
      `SELECT
         COUNT(*) AS nb_chantiers,
         COUNT(*) FILTER (WHERE statut = 'a_planifier') AS nb_a_planifier,
         SUM(montant_main_oeuvre) FILTER (WHERE NOT paye) AS a_recevoir,
         SUM(montant_main_oeuvre) FILTER (WHERE paye)     AS recu
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
  ]);

  const s = chantierStats[0] ?? {};
  const totalMO = num(coutMO[0]?.total);
  const totalMat = num(coutMat[0]?.total);

  // profit = what we billed (MO invoiced to JJ) minus what we paid in labour
  const recu = num(s.recu);
  const aRecevoir = num(s.a_recevoir);
  const totalFacture = recu + aRecevoir;
  const profit = totalFacture - totalMO;

  const aPayer = workerStats.reduce((s2, w) => s2 + num(w.montant_du), 0);

  return NextResponse.json({
    a_recevoir: aRecevoir,
    recu,
    cout_main_oeuvre: totalMO,
    cout_materiel: totalMat,
    profit,
    a_payer_workers: aPayer,
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
