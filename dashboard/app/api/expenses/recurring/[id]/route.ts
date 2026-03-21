import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorise' }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  if (typeof body.actif === 'boolean') {
    const rows = await query('UPDATE recurring_expenses SET actif = $1 WHERE id = $2 RETURNING *', [body.actif, id]);
    if (rows.length === 0) return NextResponse.json({ error: 'Non trouve' }, { status: 404 });
    return NextResponse.json(rows[0]);
  }

  return NextResponse.json({ error: 'Champ actif requis' }, { status: 400 });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorise' }, { status: 401 });

  const { id } = await params;
  await query('DELETE FROM recurring_expenses WHERE id = $1', [id]);
  return NextResponse.json({ success: true });
}
