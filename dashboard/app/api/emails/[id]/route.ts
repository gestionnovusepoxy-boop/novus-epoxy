import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const rows = await query('SELECT * FROM email_logs WHERE id = $1', [parseInt(id)]);
  if (!rows[0]) return NextResponse.json({ error: 'Email introuvable' }, { status: 404 });

  return NextResponse.json(rows[0]);
}
