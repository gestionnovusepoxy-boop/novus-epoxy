import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

/**
 * Enregistre un paiement sur une facture.
 *
 * Types supportés:
 *   - 'depot'   : marque le dépôt comme payé (montant = depot_montant attendu)
 *   - 'partial' : paiement partiel d'un montant quelconque (ne ferme PAS la facture)
 *   - 'final'   : encaissement du solde. Le backend RECALCULE toujours
 *                 (total − somme des paiements déjà enregistrés) pour éviter
 *                 une double-comptabilité quand des partiels existent.
 *
 * Après chaque paiement, si la somme des paiements ≥ total, on marque
 * final_paye=true + statut='completee'.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const invoiceId = parseInt(id);
  const body = await req.json();
  const { type, montant, methode, reference, notes } = body as {
    type?: string; montant?: number | string; methode?: string; reference?: string; notes?: string;
  };

  if (!type || !methode) {
    return NextResponse.json({ error: 'type et methode requis' }, { status: 400 });
  }
  if (!['depot', 'partial', 'final'].includes(type)) {
    return NextResponse.json({ error: 'Type invalide (depot, partial ou final)' }, { status: 400 });
  }
  if (!['virement', 'cheque', 'comptant', 'autre'].includes(methode)) {
    return NextResponse.json({ error: 'Méthode de paiement invalide' }, { status: 400 });
  }

  const invRows = await query('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
  if (!invRows[0]) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 });
  const inv = invRows[0];
  const total = Number(inv.total);

  // Somme des paiements déjà enregistrés (AVANT celui-ci)
  const paidRows = await query(
    'SELECT COALESCE(SUM(montant),0) AS sum FROM payments WHERE invoice_id = $1',
    [invoiceId]
  );
  const alreadyPaid = Number((paidRows[0] as { sum: number | string }).sum);
  const remaining = Math.max(0, total - alreadyPaid);

  // Calcule le montant réel à enregistrer selon le type
  let amountToRecord: number;
  if (type === 'final') {
    // Toujours le RESTANT (jamais le final_montant statique — c'est la cause du bug Charles).
    amountToRecord = remaining;
    if (amountToRecord <= 0) {
      return NextResponse.json({ error: 'Facture déjà entièrement payée', already_paid: alreadyPaid, total }, { status: 400 });
    }
  } else {
    // depot / partial : utilise le montant fourni
    amountToRecord = Number(montant);
    if (!Number.isFinite(amountToRecord) || amountToRecord <= 0) {
      return NextResponse.json({ error: 'Montant invalide' }, { status: 400 });
    }
    // Plafonne au restant pour ne pas dépasser le total
    if (amountToRecord > remaining + 0.01) {
      amountToRecord = remaining;
    }
  }

  await query(
    `INSERT INTO payments (invoice_id, type, montant, methode, reference, notes, paid_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
    [invoiceId, type, amountToRecord, methode, reference ?? null, notes ?? null],
  );

  // Mises à jour facture selon le type
  if (type === 'depot') {
    await query(
      `UPDATE invoices SET depot_paye = true, depot_paye_at = NOW(), depot_methode = $1,
                          statut = COALESCE(NULLIF(statut,'completee'), 'depot_recu')
       WHERE id = $2`,
      [methode, invoiceId],
    );
    await query(
      `UPDATE quotes SET statut = 'depot_paye', deposit_paid_at = NOW(), paid_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [inv.quote_id],
    );
  }

  // Re-somme APRÈS l'insertion pour déterminer si la facture est maintenant complète
  const newSumRows = await query(
    'SELECT COALESCE(SUM(montant),0) AS sum FROM payments WHERE invoice_id = $1',
    [invoiceId]
  );
  const newSum = Number((newSumRows[0] as { sum: number | string }).sum);
  const fullyPaid = newSum >= total - 0.01;

  // Detect transition: was the invoice NOT fully paid before, but IS now?
  const justBecameFullyPaid = fullyPaid && !inv.final_paye;

  if (fullyPaid) {
    await query(
      `UPDATE invoices SET final_paye = true, final_paye_at = NOW(), final_methode = $1, statut = 'completee' WHERE id = $2`,
      [methode, invoiceId],
    );
    await query(
      `UPDATE quotes SET statut = 'complete', balance_paid_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [inv.quote_id],
    );
  }

  // Auto-send the "facture payée en entier" email to the client the moment the
  // invoice transitions to fully-paid. Fire-and-forget — never blocks the response.
  if (justBecameFullyPaid) {
    const baseUrl = process.env.NEXTAUTH_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://novus-epoxy.vercel.app');
    const adminKey = process.env.ADMIN_API_KEY ?? '';
    void fetch(`${baseUrl}/api/invoices/${invoiceId}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': adminKey },
      body: JSON.stringify({}),
    }).catch(err => console.error('Auto-send paid-in-full email failed:', err));
  }

  const updated = await query(
    `SELECT inv.*, c.nom AS client_nom, c.email AS client_email
     FROM invoices inv LEFT JOIN clients c ON c.id = inv.client_id WHERE inv.id = $1`,
    [invoiceId],
  );

  return NextResponse.json({
    ...updated[0],
    payment_recorded: amountToRecord,
    total_paid: newSum,
    remaining_after: Math.max(0, total - newSum),
    fully_paid: fullyPaid,
  });
}
