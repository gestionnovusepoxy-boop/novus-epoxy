import { NextRequest, NextResponse } from 'next/server';
import { requireJJ } from '@/lib/auth';
import { query } from '@/lib/db';

type Params = { params: Promise<{ id: string }> };

const ALLOWED_PATCH = ['nom', 'cout_unitaire', 'unite', 'actif'] as const;

export async function PATCH(req: NextRequest, { params }: Params) {
  const gate = await requireJJ(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const produitId = parseInt(id, 10);
  if (!Number.isFinite(produitId)) {
    return NextResponse.json({ error: 'id invalide' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Corps invalide' }, { status: 400 });

  const setClauses: string[] = [];
  const vals: unknown[] = [];

  for (const key of ALLOWED_PATCH) {
    if (body[key] !== undefined) {
      vals.push(body[key]);
      setClauses.push(`${key} = $${vals.length}`);
    }
  }

  if (setClauses.length === 0) {
    return NextResponse.json({ error: 'Aucun champ valide fourni' }, { status: 400 });
  }

  vals.push(produitId);
  const rows = await query(
    `UPDATE jj_produits_catalogue SET ${setClauses.join(', ')} WHERE id = $${vals.length} RETURNING *`,
    vals,
  );

  if (rows.length === 0) return NextResponse.json({ error: 'Produit introuvable' }, { status: 404 });
  return NextResponse.json({ ...rows[0], cout_unitaire: Number(rows[0].cout_unitaire ?? 0) });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const gate = await requireJJ(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const produitId = parseInt(id, 10);
  if (!Number.isFinite(produitId)) {
    return NextResponse.json({ error: 'id invalide' }, { status: 400 });
  }

  const rows = await query(
    `DELETE FROM jj_produits_catalogue WHERE id = $1 RETURNING id`,
    [produitId],
  );

  if (rows.length === 0) return NextResponse.json({ error: 'Produit introuvable' }, { status: 404 });
  return NextResponse.json({ success: true });
}
