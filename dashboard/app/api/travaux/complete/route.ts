import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function POST(req: NextRequest) {
  const { auth } = await import('@/lib/auth');
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorise' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.quoteId) {
    return NextResponse.json({ error: 'quoteId requis' }, { status: 400 });
  }

  const quoteId = parseInt(body.quoteId);

  // Update quote statut
  await query(
    `UPDATE quotes SET statut = $1, updated_at = NOW() WHERE id = $2`,
    ['complete', quoteId]
  );

  // Update booking statut if exists
  await query(
    `UPDATE bookings SET statut = $1, updated_at = NOW() WHERE quote_id = $2`,
    ['complete', quoteId]
  );

  return NextResponse.json({ ok: true });
}
