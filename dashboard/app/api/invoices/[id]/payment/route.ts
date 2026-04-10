import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const invoiceId = parseInt(id);
  const body = await req.json();
  const { type, montant, methode, reference, notes } = body;

  if (!type || !montant || !methode) {
    return NextResponse.json({ error: 'type, montant et methode requis' }, { status: 400 });
  }

  if (!['depot', 'final'].includes(type)) {
    return NextResponse.json({ error: 'Type invalide (depot ou final)' }, { status: 400 });
  }

  if (!['virement', 'cheque', 'comptant', 'carte', 'autre'].includes(methode)) {
    return NextResponse.json({ error: 'Méthode de paiement invalide' }, { status: 400 });
  }

  // Verify invoice exists
  const invRows = await query('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
  if (!invRows[0]) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 });

  // Record payment
  await query(
    `INSERT INTO payments (invoice_id, type, montant, methode, reference, notes) VALUES ($1,$2,$3,$4,$5,$6)`,
    [invoiceId, type, parseFloat(montant), methode, reference ?? null, notes ?? null],
  );

  // Update invoice
  if (type === 'depot') {
    await query(
      `UPDATE invoices SET depot_paye = true, depot_paye_at = NOW(), depot_methode = $1, statut = 'depot_recu' WHERE id = $2`,
      [methode, invoiceId],
    );
    // Also update linked quote — sync both deposit_paid_at AND paid_at for backward compat
    const inv = invRows[0];
    await query(
      `UPDATE quotes SET statut = 'depot_paye', deposit_paid_at = NOW(), paid_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [inv.quote_id],
    );
  } else {
    await query(
      `UPDATE invoices SET final_paye = true, final_paye_at = NOW(), final_methode = $1, statut = 'completee' WHERE id = $2`,
      [methode, invoiceId],
    );
    // Sync balance_paid_at on the linked quote so Rapport projet shows "payé"
    await query(
      `UPDATE quotes SET statut = 'complete', balance_paid_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [invRows[0].quote_id],
    );
  }

  // Return updated invoice
  const updated = await query(
    `SELECT inv.*, c.nom AS client_nom, c.email AS client_email
     FROM invoices inv JOIN clients c ON c.id = inv.client_id WHERE inv.id = $1`,
    [invoiceId],
  );

  return NextResponse.json(updated[0]);
}
