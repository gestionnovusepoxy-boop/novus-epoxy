import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { query } from '@/lib/db';

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const chantierId = parseInt(id, 10);
  if (!Number.isFinite(chantierId)) {
    return NextResponse.json({ error: 'id invalide' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body || !body.nom) {
    return NextResponse.json({ error: 'nom requis' }, { status: 400 });
  }

  const exists = await query(`SELECT id FROM jj_chantiers WHERE id = $1`, [chantierId]);
  if (exists.length === 0) return NextResponse.json({ error: 'Chantier introuvable' }, { status: 404 });

  const quantite = body.quantite != null ? Number(body.quantite) : 1;
  const coutUnitaire = body.cout_unitaire != null ? Number(body.cout_unitaire) : 0;
  const notes = typeof body.notes === 'string' ? body.notes : null;

  const rows = await query(
    `INSERT INTO jj_produits (chantier_id, nom, quantite, cout_unitaire, notes)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [chantierId, body.nom, quantite, coutUnitaire, notes],
  );

  return NextResponse.json(rows[0], { status: 201 });
}
