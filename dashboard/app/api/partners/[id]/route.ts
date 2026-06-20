import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { query } from '@/lib/db';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const body = await req.json();
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (body.nom !== undefined) { sets.push(`nom = $${i++}`); values.push(body.nom); }
  if (body.telephone !== undefined) { sets.push(`telephone = $${i++}`); values.push(body.telephone); }
  if (body.email !== undefined) { sets.push(`email = $${i++}`); values.push(body.email); }
  if (body.split_defaut_pct !== undefined) { sets.push(`split_defaut_pct = $${i++}`); values.push(body.split_defaut_pct); }
  if (body.actif !== undefined) { sets.push(`actif = $${i++}`); values.push(body.actif); }
  if (body.notes !== undefined) { sets.push(`notes = $${i++}`); values.push(body.notes); }

  if (sets.length === 0) {
    return NextResponse.json({ error: 'Aucun champ à modifier' }, { status: 400 });
  }

  values.push(parseInt(id));
  const rows = await query(
    `UPDATE partners SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    values,
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Partenaire introuvable' }, { status: 404 });
  }

  return NextResponse.json(rows[0]);
}
