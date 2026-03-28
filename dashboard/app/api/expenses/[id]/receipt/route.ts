import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorise' }, { status: 401 });

  const { id } = await params;
  const rows = await query(
    `SELECT receipt_url, receipt_filename FROM expenses WHERE id = $1`,
    [parseInt(id)],
  );

  const exp = rows[0];
  if (!exp || !exp.receipt_url) {
    return NextResponse.json({ error: 'Aucun recu' }, { status: 404 });
  }

  return NextResponse.redirect(exp.receipt_url as string);
}
