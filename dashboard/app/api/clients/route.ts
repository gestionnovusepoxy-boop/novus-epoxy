import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const page   = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const limit  = Math.min(100, parseInt(searchParams.get('limit') ?? '25'));
  const search = searchParams.get('search') ?? '';
  const offset = (page - 1) * limit;

  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  let i = 1;

  if (search) {
    where += ` AND (c.nom ILIKE $${i} OR c.email ILIKE $${i})`;
    params.push(`%${search}%`);
    i++;
  }

  const countRows = await query(
    `SELECT COUNT(*)::int AS count FROM clients c ${where}`, params
  );
  const total = (countRows[0]?.count as number) ?? 0;

  const dataRows = await query(
    `SELECT c.*,
       (SELECT COUNT(*)::int FROM quotes q WHERE q.client_email = c.email) AS nb_devis,
       (SELECT COUNT(*)::int FROM invoices inv WHERE inv.client_id = c.id) AS nb_factures,
       (SELECT COALESCE(SUM(inv.total), 0) FROM invoices inv WHERE inv.client_id = c.id AND inv.statut = 'completee') AS revenue_total
     FROM clients c ${where}
     ORDER BY c.created_at DESC LIMIT $${i++} OFFSET $${i}`,
    [...params, limit, offset],
  );

  return NextResponse.json({ data: dataRows, total, page, limit });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const body = await req.json();
  const { nom, email, telephone, adresse } = body;

  if (!nom || !email) {
    return NextResponse.json({ error: 'Nom et email requis' }, { status: 400 });
  }

  // Upsert: find existing or create
  const existing = await query('SELECT * FROM clients WHERE email = $1', [email.toLowerCase().trim()]);
  if (existing[0]) {
    return NextResponse.json(existing[0]);
  }

  const rows = await query(
    `INSERT INTO clients (nom, email, telephone, adresse) VALUES ($1, $2, $3, $4) RETURNING *`,
    [nom.slice(0, 120), email.toLowerCase().trim().slice(0, 255), telephone?.slice(0, 30) ?? null, adresse ?? null],
  );

  return NextResponse.json(rows[0], { status: 201 });
}
