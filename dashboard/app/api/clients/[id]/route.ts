import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const rows = await query('SELECT * FROM clients WHERE id = $1', [parseInt(id)]);
  if (!rows[0]) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 });

  const quotes = await query(
    'SELECT * FROM quotes WHERE client_email = $1 ORDER BY created_at DESC',
    [rows[0].email]
  );
  const invoices = await query(
    'SELECT * FROM invoices WHERE client_id = $1 ORDER BY created_at DESC',
    [parseInt(id)]
  );

  return NextResponse.json({ client: rows[0], quotes, invoices });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const allowed = ['nom', 'email', 'telephone', 'adresse', 'notes'];

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
    `UPDATE clients SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    values,
  );

  if (!rows[0]) return NextResponse.json({ error: 'Client introuvable' }, { status: 404 });
  return NextResponse.json(rows[0]);
}
