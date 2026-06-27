import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireJJ } from '@/lib/auth';
import { query } from '@/lib/db';

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(req: NextRequest) {
  const gate = await requireJJ(req);
  if (gate instanceof NextResponse) return gate;

  const chantiers = await query(
    `SELECT * FROM jj_chantiers ORDER BY created_at DESC`,
    [],
  );

  if (chantiers.length === 0) return NextResponse.json({ data: [] });

  const ids = chantiers.map(c => c.id as number);
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');

  const [planning, produits, heures] = await Promise.all([
    query(
      `SELECT * FROM jj_planning WHERE chantier_id IN (${placeholders}) ORDER BY date ASC`,
      ids,
    ),
    query(
      `SELECT * FROM jj_produits WHERE chantier_id IN (${placeholders})`,
      ids,
    ),
    query(
      `SELECT chantier_id, SUM(heures * taux_horaire) AS cout
       FROM jj_heures WHERE chantier_id IN (${placeholders})
       GROUP BY chantier_id`,
      ids,
    ),
  ]);

  const coutByChantier = new Map<number, number>(
    heures.map(h => [h.chantier_id as number, num(h.cout)]),
  );
  const planningByChantier = new Map<number, typeof planning>();
  const produitsByChantier = new Map<number, typeof produits>();

  for (const id of ids) {
    planningByChantier.set(id, []);
    produitsByChantier.set(id, []);
  }
  for (const p of planning) planningByChantier.get(p.chantier_id as number)?.push(p);
  for (const p of produits) produitsByChantier.get(p.chantier_id as number)?.push(p);

  const data = chantiers.map(c => {
    const id = c.id as number;
    const coutMO = coutByChantier.get(id) ?? 0;
    const prods = produitsByChantier.get(id) ?? [];
    const coutMat = prods.reduce((s, p) => s + num(p.quantite) * num(p.cout_unitaire), 0);
    return {
      ...c,
      montant_contrat: num(c.montant_contrat),
      montant_main_oeuvre: num(c.montant_main_oeuvre),
      montant_materiel: num(c.montant_materiel),
      depot_montant: num(c.depot_montant),
      planning: planningByChantier.get(id) ?? [],
      produits: prods,
      cout_main_oeuvre: coutMO,
      cout_materiel: coutMat,
      profit: num(c.montant_main_oeuvre) - coutMO,
    };
  });

  return NextResponse.json({ data });
}

const ALLOWED_CREATE = [
  'client_nom', 'client_tel', 'adresse', 'ville', 'service',
  'superficie', 'montant_contrat', 'montant_main_oeuvre', 'montant_materiel',
  'depot_recu', 'depot_montant', 'notes',
] as const;

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const body = await req.json().catch(() => null);
  if (!body || !body.client_nom) {
    return NextResponse.json({ error: 'client_nom requis' }, { status: 400 });
  }

  const cols: string[] = [];
  const vals: unknown[] = [];

  for (const key of ALLOWED_CREATE) {
    if (body[key] !== undefined) {
      cols.push(key);
      vals.push(body[key]);
    }
  }

  const set = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
  const colList = cols.join(', ');
  const valPlaceholders = cols.map((_, i) => `$${i + 1}`).join(', ');

  void set; // unused — using INSERT syntax below
  const rows = await query(
    `INSERT INTO jj_chantiers (${colList}) VALUES (${valPlaceholders}) RETURNING *`,
    vals,
  );

  return NextResponse.json(rows[0], { status: 201 });
}
