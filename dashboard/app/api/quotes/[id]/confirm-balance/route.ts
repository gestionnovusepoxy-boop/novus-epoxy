import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorise' }, { status: 401 });

  const { id } = await params;
  const quoteId = parseInt(id);

  const quotes = await query('SELECT * FROM quotes WHERE id = $1', [quoteId]);
  if (quotes.length === 0) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });

  const quote = quotes[0];

  if (quote.statut !== 'depot_paye' && quote.statut !== 'planifie') {
    return NextResponse.json({ error: 'Le devis doit etre en statut depot_paye ou planifie' }, { status: 400 });
  }

  await query(
    `UPDATE quotes SET statut = 'complete', balance_paid_at = NOW() WHERE id = $1`,
    [quoteId]
  );

  // Marque la facture payée en entier + enregistre le paiement final (idempotent).
  const { ensureInvoiceForQuote } = await import('@/lib/ensure-invoice');
  await ensureInvoiceForQuote(quoteId).catch((e) => console.error('ensureInvoiceForQuote (confirm-balance):', e));

  return NextResponse.json({ success: true });
}
