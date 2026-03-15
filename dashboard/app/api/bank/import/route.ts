import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const body = await req.json();
  const { transactions } = body;

  if (!Array.isArray(transactions) || transactions.length === 0) {
    return NextResponse.json({ error: 'Aucune transaction fournie' }, { status: 400 });
  }

  let imported = 0;
  for (const tx of transactions) {
    const { date_tx, description, montant, type } = tx;
    if (!date_tx || !description || montant == null || !type) continue;

    await query(
      `INSERT INTO bank_transactions (date_tx, description, montant, type, reference)
       VALUES ($1, $2, $3, $4, $5)`,
      [date_tx, description.slice(0, 500), parseFloat(montant), type, tx.reference ?? null],
    );
    imported++;
  }

  return NextResponse.json({ imported });
}
