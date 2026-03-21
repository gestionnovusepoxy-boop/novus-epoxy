import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Public endpoint — returns limited quote data for the payment page
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await query(
    `SELECT id, client_nom, type_service, superficie, total, depot_requis, statut,
            deposit_paid_at, balance_paid_at
     FROM quotes WHERE id = $1`,
    [parseInt(id)]
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

  return NextResponse.json(quote);
}
