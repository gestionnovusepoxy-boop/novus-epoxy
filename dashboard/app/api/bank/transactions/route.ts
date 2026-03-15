import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const page       = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const limit      = Math.min(100, parseInt(searchParams.get('limit') ?? '50'));
  const reconciled = searchParams.get('reconciled');
  const offset     = (page - 1) * limit;

  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  let i = 1;

  if (reconciled === 'true') { where += ' AND bt.reconciled = true'; }
  if (reconciled === 'false') { where += ' AND bt.reconciled = false'; }

  const countRows = await query(`SELECT COUNT(*)::int AS count FROM bank_transactions bt ${where}`, params);
  const total = (countRows[0]?.count as number) ?? 0;

  const dataRows = await query(
    `SELECT bt.*,
       inv.numero AS invoice_numero,
       e.fournisseur AS expense_fournisseur
     FROM bank_transactions bt
     LEFT JOIN invoices inv ON inv.id = bt.invoice_id
     LEFT JOIN expenses e ON e.id = bt.expense_id
     ${where}
     ORDER BY bt.date_tx DESC LIMIT $${i++} OFFSET $${i}`,
    [...params, limit, offset],
  );

  return NextResponse.json({ data: dataRows, total, page, limit });
}
