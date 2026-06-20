import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const rows = await query(
    'SELECT * FROM partners WHERE actif = TRUE ORDER BY nom ASC',
  );
  return NextResponse.json({ data: rows });
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const body = await req.json();
  const { nom, telephone, email, split_defaut_pct, notes } = body;

  if (!nom) {
    return NextResponse.json({ error: 'nom requis' }, { status: 400 });
  }

  const rows = await query(
    `INSERT INTO partners (nom, telephone, email, split_defaut_pct, notes)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [nom, telephone ?? null, email ?? null, split_defaut_pct ?? 50, notes ?? null],
  );

  return NextResponse.json(rows[0], { status: 201 });
}
