import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireJJ } from '@/lib/auth';
import { query } from '@/lib/db';

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const gate = await requireJJ(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const chantierId = parseInt(id, 10);
  if (!Number.isFinite(chantierId)) {
    return NextResponse.json({ error: 'id invalide' }, { status: 400 });
  }

  const rows = await query(`SELECT * FROM jj_chantiers WHERE id = $1`, [chantierId]);
  if (rows.length === 0) return NextResponse.json({ error: 'Chantier introuvable' }, { status: 404 });
  const c = rows[0];

  const [planning, produits, heures] = await Promise.all([
    query(`SELECT * FROM jj_planning WHERE chantier_id = $1 ORDER BY date ASC`, [chantierId]),
    query(`SELECT * FROM jj_produits WHERE chantier_id = $1`, [chantierId]),
    query(
      `SELECT SUM(heures * taux_horaire) AS cout FROM jj_heures WHERE chantier_id = $1`,
      [chantierId],
    ),
  ]);

  const coutMO = num(heures[0]?.cout);
  const coutMat = (produits as Array<Record<string, unknown>>).reduce(
    (s, p) => s + num(p.quantite) * num(p.cout_unitaire),
    0,
  );

  return NextResponse.json({
    data: {
      ...c,
      montant_contrat: num(c.montant_contrat),
      montant_main_oeuvre: num(c.montant_main_oeuvre),
      montant_materiel: num(c.montant_materiel),
      depot_montant: num(c.depot_montant),
      planning,
      produits,
      cout_main_oeuvre: coutMO,
      cout_materiel: coutMat,
      profit: num(c.montant_main_oeuvre) - coutMO,
    },
  });
}

const ALLOWED_PATCH = [
  'client_nom', 'client_tel', 'adresse', 'ville', 'service', 'superficie',
  'montant_contrat', 'montant_main_oeuvre', 'montant_materiel',
  'depot_recu', 'depot_montant', 'statut', 'paye', 'date_paye', 'notes',
] as const;

export async function PATCH(req: NextRequest, { params }: Params) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const chantierId = parseInt(id, 10);
  if (!Number.isFinite(chantierId)) {
    return NextResponse.json({ error: 'id invalide' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Corps invalide' }, { status: 400 });

  const setClauses: string[] = ['updated_at = NOW()'];
  const vals: unknown[] = [];

  for (const key of ALLOWED_PATCH) {
    if (body[key] !== undefined) {
      vals.push(body[key]);
      setClauses.push(`${key} = $${vals.length}`);
    }
  }

  if (setClauses.length === 1) {
    return NextResponse.json({ error: 'Aucun champ valide fourni' }, { status: 400 });
  }

  vals.push(chantierId);
  const rows = await query(
    `UPDATE jj_chantiers SET ${setClauses.join(', ')} WHERE id = $${vals.length} RETURNING *`,
    vals,
  );

  if (rows.length === 0) return NextResponse.json({ error: 'Chantier introuvable' }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const chantierId = parseInt(id, 10);
  if (!Number.isFinite(chantierId)) {
    return NextResponse.json({ error: 'id invalide' }, { status: 400 });
  }

  const rows = await query(
    `DELETE FROM jj_chantiers WHERE id = $1 RETURNING id`,
    [chantierId],
  );

  if (rows.length === 0) return NextResponse.json({ error: 'Chantier introuvable' }, { status: 404 });
  return NextResponse.json({ success: true });
}
