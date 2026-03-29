import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export async function GET() {
  const { auth } = await import('@/lib/auth');
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorise' }, { status: 401 });

  const rows = await query(
    `SELECT q.*, b.jour1_date, b.jour2_date, b.jour1_slot, b.jour2_slot, b.statut AS booking_statut
     FROM quotes q
     LEFT JOIN bookings b ON b.quote_id = q.id
     WHERE q.statut IN ($1, $2)
     ORDER BY b.jour1_date ASC NULLS LAST`,
    ['depot_paye', 'planifie']
  );

  return NextResponse.json({ data: rows });
}
