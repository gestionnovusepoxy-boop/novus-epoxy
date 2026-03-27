import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const rows = await query('SELECT * FROM quotes WHERE id = $1', [parseInt(id)]);
  if (!rows[0]) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });

  return NextResponse.json(rows[0]);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const allowed = ['statut', 'client_nom', 'client_email', 'client_tel', 'client_adresse', 'type_service', 'superficie', 'etat_plancher', 'notes', 'contrat_signature_nom'];

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  for (const key of allowed) {
    if (key in body) {
      sets.push(`${key} = $${i++}`);
      values.push(body[key]);
    }
  }

  if (body.statut === 'approuve') {
    sets.push(`approved_at = NOW()`);
  }
  if (body.statut === 'envoye') {
    sets.push(`sent_at = NOW()`);
  }
  if (body.statut === 'contrat_signe') {
    sets.push(`contrat_signe_at = NOW()`);
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: 'Rien à mettre à jour' }, { status: 400 });
  }

  values.push(parseInt(id));
  const rows = await query(
    `UPDATE quotes SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    values,
  );

  if (!rows[0]) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const quoteId = parseInt(id);

  const rows = await query('SELECT statut FROM quotes WHERE id = $1', [quoteId]);
  if (!rows[0]) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });

  const protectedStatuts = ['depot_paye', 'planifie', 'complete'];
  if (protectedStatuts.includes(rows[0].statut as string)) {
    return NextResponse.json({ error: 'Impossible de supprimer un devis avec depot paye ou complete' }, { status: 400 });
  }

  // Delete related bookings first
  await query('DELETE FROM bookings WHERE quote_id = $1', [quoteId]);
  await query('DELETE FROM quotes WHERE id = $1', [quoteId]);

  return NextResponse.json({ success: true });
}
