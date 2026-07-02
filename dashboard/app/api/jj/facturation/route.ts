import { NextRequest, NextResponse } from 'next/server';
import { requireJJ } from '@/lib/auth';
import { query } from '@/lib/db';

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// GET — jobs terminés (statut='complete') mais pas encore payés (paye=FALSE),
// avec le détail de ce que JJ doit: part Novus (contrat × split %) + remboursements
// matériel non remboursés. C'est la facture que Luca produit à JJ le samedi.
export async function GET(req: NextRequest) {
  const gate = await requireJJ(req);
  if (gate instanceof NextResponse) return gate;

  const rows = await query(
    `SELECT
       c.id, c.client_nom, c.ville,
       c.montant_contrat * COALESCE(c.split_pct, 50) / 100 AS part_novus,
       COALESCE(d.remboursements, 0) AS remboursements
     FROM jj_chantiers c
     LEFT JOIN LATERAL (
       SELECT SUM(sous_total) AS remboursements
       FROM jj_depenses
       WHERE chantier_id = c.id AND NOT rembourse
     ) d ON TRUE
     WHERE c.statut = 'complete' AND c.paye = FALSE
     ORDER BY c.created_at ASC`,
    [],
  );

  let total = 0;
  const jobs = rows.map(r => {
    const partNovus = round2(num(r.part_novus));
    const remboursements = round2(num(r.remboursements));
    const du = round2(partNovus + remboursements);
    total += du;
    return {
      id: r.id,
      client_nom: r.client_nom,
      ville: r.ville,
      part_novus: partNovus,
      remboursements,
      du,
    };
  });

  return NextResponse.json({ jobs, total: round2(total) });
}
