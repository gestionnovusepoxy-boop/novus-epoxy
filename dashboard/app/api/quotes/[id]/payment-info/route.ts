import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Public endpoint — returns limited quote data for the payment page
// Requires ?token= parameter for security (prevents ID enumeration)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ error: 'Token requis' }, { status: 403 });
  }

  const rows = await query(
    `SELECT id, client_nom, type_service, superficie, total, depot_requis, statut,
            deposit_paid_at, balance_paid_at, booking_id
     FROM quotes WHERE id = $1 AND secret_token = $2`,
    [parseInt(id), token]
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });
  }

  const quote = rows[0];

  // Only allow access for quotes that have been signed or later
  const allowedStatuts = ['contrat_signe', 'depot_paye', 'planifie', 'complete'];
  if (!allowedStatuts.includes(quote.statut as string)) {
    return NextResponse.json({ error: 'Cette page n\'est pas encore disponible' }, { status: 400 });
  }

  // Include booking dates if deposit is paid
  const depositStatuts = ['depot_paye', 'planifie', 'complete'];
  if (depositStatuts.includes(quote.statut as string) && quote.booking_id) {
    const bookingRows = await query(
      'SELECT jour1_date, jour1_slot, jour2_date, jour2_slot FROM bookings WHERE id = $1',
      [quote.booking_id]
    );
    if (bookingRows.length > 0) {
      const b = bookingRows[0];
      const formatDateStr = (d: unknown) =>
        d instanceof Date ? d.toISOString().split('T')[0] : String(d).split('T')[0];
      return NextResponse.json({
        ...quote,
        jour1_date: formatDateStr(b.jour1_date),
        jour1_slot: b.jour1_slot,
        jour2_date: formatDateStr(b.jour2_date),
        jour2_slot: b.jour2_slot,
      });
    }
  }

  return NextResponse.json(quote);
}
