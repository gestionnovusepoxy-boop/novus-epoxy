import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function POST(_req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  let matched = 0;

  // Get unreconciled transactions
  const unreconciledTx = await query(
    'SELECT * FROM bank_transactions WHERE reconciled = false ORDER BY date_tx DESC',
    [],
  );

  for (const tx of unreconciledTx) {
    const montant = Math.abs(Number(tx.montant));
    const type = tx.type as string;

    if (type === 'credit') {
      // Try to match with payments (deposits/finals)
      const paymentRows = await query(
        `SELECT p.*, inv.id AS inv_id FROM payments p
         JOIN invoices inv ON inv.id = p.invoice_id
         WHERE ABS(p.montant - $1) < 0.01
         AND p.paid_at::date BETWEEN ($2::date - INTERVAL '3 days') AND ($2::date + INTERVAL '3 days')
         AND NOT EXISTS (SELECT 1 FROM bank_transactions bt WHERE bt.payment_id = p.id AND bt.reconciled = true)
         LIMIT 1`,
        [montant, tx.date_tx],
      );

      if (paymentRows[0]) {
        await query(
          'UPDATE bank_transactions SET reconciled = true, payment_id = $1, invoice_id = $2 WHERE id = $3',
          [paymentRows[0].id, paymentRows[0].inv_id, tx.id],
        );
        matched++;
        continue;
      }
    }

    if (type === 'debit') {
      // Try to match with expenses
      const expenseRows = await query(
        `SELECT * FROM expenses
         WHERE ABS(montant_ttc - $1) < 0.01
         AND date_depense BETWEEN ($2::date - INTERVAL '3 days') AND ($2::date + INTERVAL '3 days')
         AND reconciled = false
         LIMIT 1`,
        [montant, tx.date_tx],
      );

      if (expenseRows[0]) {
        await query(
          'UPDATE bank_transactions SET reconciled = true, expense_id = $1 WHERE id = $2',
          [expenseRows[0].id, tx.id],
        );
        await query(
          'UPDATE expenses SET reconciled = true, transaction_id = $1 WHERE id = $2',
          [tx.id, expenseRows[0].id],
        );
        matched++;
      }
    }
  }

  return NextResponse.json({ matched });
}
