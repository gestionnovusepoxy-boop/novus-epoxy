import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// Public endpoint — returns quote data for the contract signing page
// Only returns data when quote is in a signable/signed state
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rows = await query(
    `SELECT q.id, q.client_nom, q.client_email, q.client_tel, q.client_adresse,
            q.type_service, q.superficie, q.etat_plancher, q.notes,
            q.sous_total, q.tps, q.tvq, q.total, q.depot_requis,
            q.statut, q.contrat_signe_at, q.contrat_signature_nom, q.created_at,
            b.jour1_date AS booking_jour1_date,
            b.jour2_date AS booking_jour2_date,
            b.jour2_slot AS booking_jour2_slot
     FROM quotes q
     LEFT JOIN bookings b ON b.id = q.booking_id
     WHERE q.id = $1`,
    [parseInt(id)]
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });
  }

  const quote = rows[0];
  // Normalize booking dates to string format
  if (quote.booking_jour1_date instanceof Date) {
    quote.booking_jour1_date = quote.booking_jour1_date.toISOString().split('T')[0];
  }
  if (quote.booking_jour2_date instanceof Date) {
    quote.booking_jour2_date = quote.booking_jour2_date.toISOString().split('T')[0];
  }

  // Only allow access for quotes that have been sent or later
  const allowedStatuts = ['envoye', 'contrat_signe', 'depot_paye', 'planifie', 'complete'];
  if (!allowedStatuts.includes(quote.statut as string)) {
    return NextResponse.json({ error: 'Ce contrat n\'est pas disponible' }, { status: 400 });
  }

  // If already signed, indicate that
  if (['contrat_signe', 'depot_paye', 'planifie', 'complete'].includes(quote.statut as string)) {
    return NextResponse.json({ ...quote, already_signed: true });
  }

  return NextResponse.json(quote);
}
