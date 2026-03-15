import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const body = await req.json();
  const { transaction_id, invoice_id, expense_id, payment_id } = body;

  if (!transaction_id) return NextResponse.json({ error: 'transaction_id requis' }, { status: 400 });
  if (!invoice_id && !expense_id && !payment_id) {
    return NextResponse.json({ error: 'invoice_id, expense_id ou payment_id requis' }, { status: 400 });
  }

  const sets: string[] = ['reconciled = true'];
  const values: unknown[] = [];
  let i = 1;

  if (invoice_id) { sets.push(`invoice_id = $${i++}`); values.push(invoice_id); }
  if (expense_id) { sets.push(`expense_id = $${i++}`); values.push(expense_id); }
  if (payment_id) { sets.push(`payment_id = $${i++}`); values.push(payment_id); }

  values.push(transaction_id);
  const rows = await query(
    `UPDATE bank_transactions SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    values,
  );

  // Also mark expense as reconciled
  if (expense_id) {
    await query('UPDATE expenses SET reconciled = true, transaction_id = $1 WHERE id = $2', [transaction_id, expense_id]);
  }

  if (!rows[0]) return NextResponse.json({ error: 'Transaction introuvable' }, { status: 404 });
  return NextResponse.json(rows[0]);
}
