import { query } from '@/lib/db';
import { insertInvoiceWithRetry } from '@/lib/invoice-numero';

/**
 * Crée (ou retrouve) une facture pour un devis dont le dépôt a été reçu.
 * Idempotent — appelable depuis n'importe quel trigger (confirm-deposit,
 * Telegram callback, cron). N'envoie PAS d'email au client.
 *
 * Paiements: Interac, chèque, comptant uniquement — Stripe jamais utilisé.
 *
 * Retourne l'invoice_id (créé ou existant), ou null si quote introuvable.
 */
export async function ensureInvoiceForQuote(quoteId: number): Promise<{ invoice_id: number | null; created: boolean; payment_recorded: boolean }> {
  const quoteRows = await query(
    `SELECT id, client_nom, client_email, client_tel, client_adresse, type_service, superficie,
            prix_pied_carre, rabais_pct, rabais_montant, sous_total, tps, tvq, total, depot_requis,
            deposit_paid_at, balance_paid_at, client_id
       FROM quotes WHERE id = $1`,
    [quoteId]
  );
  if (!quoteRows.length) return { invoice_id: null, created: false, payment_recorded: false };
  const q = quoteRows[0];

  // 1. Resolve client_id — find by email/phone, or create if needed
  let clientId = q.client_id as number | null;
  if (!clientId) {
    if (q.client_email) {
      const existing = await query(
        `SELECT id FROM clients WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [q.client_email]
      ).catch(() => []);
      if (existing.length) clientId = existing[0].id as number;
    }
    if (!clientId) {
      const inserted = await query(
        `INSERT INTO clients (nom, email, telephone, adresse) VALUES ($1, $2, $3, $4) RETURNING id`,
        [q.client_nom, q.client_email, q.client_tel, q.client_adresse]
      ).catch(() => []);
      if (inserted.length) clientId = inserted[0].id as number;
    }
  }

  // 2. Find existing invoice for this quote
  let invoiceRows = await query(
    `SELECT id FROM invoices WHERE quote_id = $1 LIMIT 1`,
    [quoteId]
  );

  let created = false;
  if (!invoiceRows.length) {
    invoiceRows = await insertInvoiceWithRetry({ digits: 4 }, (numero) =>
      query(
        `INSERT INTO invoices (numero, quote_id, client_id, type_service, superficie, prix_pied_carre,
                               rabais_pct, rabais_montant, sous_total, tps, tvq, total, depot_montant, statut)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'depot_recu')
         RETURNING id`,
        [numero, quoteId, clientId,
         q.type_service, q.superficie, q.prix_pied_carre,
         Number(q.rabais_pct ?? 0), Number(q.rabais_montant ?? 0),
         q.sous_total, q.tps, q.tvq, q.total, q.depot_requis]
      )
    );
    created = true;
  }

  const invoiceId = invoiceRows[0].id as number;

  // 3. If deposit paid, ensure invoice reflects + payment record exists
  let paymentRecorded = false;
  if (q.deposit_paid_at) {
    // Update invoice deposit flags
    await query(
      `UPDATE invoices SET depot_paye = true, depot_paye_at = $1, statut = CASE WHEN statut = 'en_cours' THEN 'depot_recu' ELSE statut END
        WHERE id = $2 AND (depot_paye = false OR depot_paye IS NULL)`,
      [q.deposit_paid_at, invoiceId]
    );

    // Insert payment if not exists
    const existingDepot = await query(
      `SELECT id FROM payments WHERE invoice_id = $1 AND type = 'depot' LIMIT 1`,
      [invoiceId]
    );
    if (!existingDepot.length) {
      await query(
        `INSERT INTO payments (invoice_id, type, montant, methode, notes, paid_at)
         VALUES ($1, 'depot', $2, 'autre', 'Auto via ensureInvoiceForQuote', $3)`,
        [invoiceId, Number(q.depot_requis ?? 0), q.deposit_paid_at]
      );
      paymentRecorded = true;
    }
  }

  // 4. If balance paid, ensure invoice reflects + payment record exists
  if (q.balance_paid_at) {
    const finalMontant = Number(q.total ?? 0) - Number(q.depot_requis ?? 0);
    await query(
      `UPDATE invoices SET final_paye = true, final_paye_at = $1, final_montant = $2, statut = 'completee'
        WHERE id = $3 AND (final_paye = false OR final_paye IS NULL)`,
      [q.balance_paid_at, finalMontant, invoiceId]
    );

    const existingFinal = await query(
      `SELECT id FROM payments WHERE invoice_id = $1 AND type = 'final' LIMIT 1`,
      [invoiceId]
    );
    if (!existingFinal.length) {
      await query(
        `INSERT INTO payments (invoice_id, type, montant, methode, notes, paid_at)
         VALUES ($1, 'final', $2, 'autre', 'Auto via ensureInvoiceForQuote', $3)`,
        [invoiceId, finalMontant, q.balance_paid_at]
      );
      paymentRecorded = true;
    }
  }

  return { invoice_id: invoiceId, created, payment_recorded: paymentRecorded };
}
