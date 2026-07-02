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
    const montantContrat = num(c.montant_contrat);
    const splitPct = num(c.split_pct, 50);
    const partNovus = montantContrat * (splitPct / 100);
    const partJj = montantContrat * (1 - splitPct / 100);
    return {
      ...c,
      montant_contrat: montantContrat,
      montant_main_oeuvre: num(c.montant_main_oeuvre),
      montant_materiel: num(c.montant_materiel),
      depot_montant: num(c.depot_montant),
      equipe: c.equipe != null ? Number(c.equipe) : null,
      split_pct: splitPct,
      planning: planningByChantier.get(id) ?? [],
      produits: prods,
      cout_main_oeuvre: round2(coutMO),
      cout_materiel: round2(coutMat),
      part_novus: round2(partNovus),
      part_jj: round2(partJj),
      marge_novus: round2(partNovus - coutMO),
      marge_jj: round2(partJj - coutMat),
      profit: num(c.montant_main_oeuvre) - coutMO,
    };
  });

  return NextResponse.json({ data });
}

const ALLOWED_CREATE = [
  'client_nom', 'client_tel', 'adresse', 'ville', 'service',
  'superficie', 'montant_contrat', 'montant_main_oeuvre', 'montant_materiel',
  'depot_recu', 'depot_montant', 'equipe', 'couleur', 'split_pct', 'notes',
] as const;

export async function POST(req: NextRequest) {
  const gate = await requireJJ(req);
  if (gate instanceof NextResponse) return gate;

  const body = await req.json().catch(() => null);
  if (!body || !body.client_nom) {
    return NextResponse.json({ error: 'client_nom requis' }, { status: 400 });
  }

  // Colonnes NUMERIC NOT NULL — toujours coercées en nombre (vide/null → défaut),
  // sinon Postgres rejette "" ou null (bug création 27 juin).
  const NUMERIC_DEFAULTS: Record<string, number> = {
    superficie: 0, montant_contrat: 0, montant_main_oeuvre: 0,
    montant_materiel: 0, depot_montant: 0, split_pct: 50, equipe: 0,
  };
  const BOOL_KEYS = new Set(['depot_recu']);

  const cols: string[] = [];
  const vals: unknown[] = [];

  for (const key of ALLOWED_CREATE) {
    if (body[key] === undefined) continue;
    cols.push(key);
    if (key === 'equipe') {
      // equipe est nullable (1, 2 ou aucune) — vide → null
      const e = num(body[key], 0);
      vals.push(e === 1 || e === 2 ? e : null);
    } else if (key in NUMERIC_DEFAULTS) {
      vals.push(num(body[key], NUMERIC_DEFAULTS[key]));
    } else if (BOOL_KEYS.has(key)) {
      vals.push(Boolean(body[key]));
    } else {
      // champs texte — chaîne vide → null pour rester propre
      const v = body[key];
      vals.push(v === '' ? null : v);
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
