import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const page      = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const limit     = Math.min(100, parseInt(searchParams.get('limit') ?? '25'));
  const categorie = searchParams.get('categorie') ?? '';
  const search    = searchParams.get('search') ?? '';
  const quoteId   = searchParams.get('quote_id') ?? '';
  const offset    = (page - 1) * limit;

  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  let i = 1;

  if (quoteId) {
    where += ` AND quote_id = $${i++}`;
    params.push(parseInt(quoteId));
  }
  if (categorie) {
    where += ` AND categorie = $${i++}`;
    params.push(categorie);
  }
  if (search) {
    where += ` AND (fournisseur ILIKE $${i} OR description ILIKE $${i})`;
    params.push(`%${search}%`);
    i++;
  }

  const countRows = await query(`SELECT COUNT(*)::int AS count FROM expenses ${where}`, params);
  const total = (countRows[0]?.count as number) ?? 0;

  const dataRows = await query(
    `SELECT * FROM expenses ${where} ORDER BY date_depense DESC LIMIT $${i++} OFFSET $${i}`,
    [...params, limit, offset],
  );

  return NextResponse.json({ data: dataRows, total, page, limit });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const body = await req.json();
  const { date_depense, fournisseur, description, categorie, montant_ht, tps, tvq, methode, reference } = body;

  if (!fournisseur || !categorie || !montant_ht) {
    return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
  }

  const ht = parseFloat(montant_ht);
  const tpsVal = parseFloat(tps ?? '0');
  const tvqVal = parseFloat(tvq ?? '0');
  const ttc = Math.round((ht + tpsVal + tvqVal) * 100) / 100;

  const rows = await query(
    `INSERT INTO expenses (date_depense, fournisseur, description, categorie, montant_ht, tps, tvq, montant_ttc, methode, reference)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      date_depense ?? new Date().toISOString().slice(0, 10),
      fournisseur.slice(0, 120), description ?? null, categorie,
      ht, tpsVal, tvqVal, ttc,
      methode ?? null, reference ?? null,
    ],
  );

  return NextResponse.json(rows[0], { status: 201 });
}

// PATCH — update notes (internal only, not exported)
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const body = await req.json();
  const { id, notes } = body;
  if (!id) return NextResponse.json({ error: 'ID requis' }, { status: 400 });

  await query(`UPDATE expenses SET notes = $1, updated_at = NOW() WHERE id = $2`, [notes || null, id]);
  return NextResponse.json({ ok: true });
}
