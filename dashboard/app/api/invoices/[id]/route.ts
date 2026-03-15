import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const rows = await query(
    `SELECT inv.*, c.nom AS client_nom, c.email AS client_email, c.telephone AS client_tel, c.adresse AS client_adresse
     FROM invoices inv JOIN clients c ON c.id = inv.client_id
     WHERE inv.id = $1`,
    [parseInt(id)],
  );
  if (!rows[0]) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 });

  const payments = await query(
    'SELECT * FROM payments WHERE invoice_id = $1 ORDER BY paid_at DESC',
    [parseInt(id)],
  );

  return NextResponse.json({ ...rows[0], payments });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const allowed = ['statut', 'notes', 'date_echeance'];

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  for (const key of allowed) {
    if (key in body) {
      sets.push(`${key} = $${i++}`);
      values.push(body[key]);
    }
  }

  if (sets.length === 0) return NextResponse.json({ error: 'Rien à mettre à jour' }, { status: 400 });

  values.push(parseInt(id));
  const rows = await query(
    `UPDATE invoices SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    values,
  );

  if (!rows[0]) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 });
  return NextResponse.json(rows[0]);
}
