import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const activeOnly = searchParams.get('active') === 'true';

  let sql = 'SELECT * FROM promotions';
  const params: unknown[] = [];

  if (activeOnly) {
    sql += ' WHERE actif = true AND date_debut <= CURRENT_DATE AND date_fin >= CURRENT_DATE';
  }

  sql += ' ORDER BY created_at DESC';

  const rows = await query(sql, params);
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const body = await req.json();
  const { nom, description, rabais_pct, date_debut, date_fin, services } = body;

  if (!nom || !rabais_pct || !date_debut || !date_fin) {
    return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
  }

  const rows = await query(
    `INSERT INTO promotions (nom, description, rabais_pct, date_debut, date_fin, services)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [nom, description ?? null, parseFloat(rabais_pct), date_debut, date_fin, services ?? '{}']
  );

  return NextResponse.json(rows[0], { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const body = await req.json();
  const { id, nom, description, rabais_pct, date_debut, date_fin, actif, services } = body;

  if (!id) {
    return NextResponse.json({ error: 'ID requis' }, { status: 400 });
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (nom !== undefined) { sets.push(`nom = $${i++}`); params.push(nom); }
  if (description !== undefined) { sets.push(`description = $${i++}`); params.push(description); }
  if (rabais_pct !== undefined) { sets.push(`rabais_pct = $${i++}`); params.push(parseFloat(rabais_pct)); }
  if (date_debut !== undefined) { sets.push(`date_debut = $${i++}`); params.push(date_debut); }
  if (date_fin !== undefined) { sets.push(`date_fin = $${i++}`); params.push(date_fin); }
  if (actif !== undefined) { sets.push(`actif = $${i++}`); params.push(actif); }
  if (services !== undefined) { sets.push(`services = $${i++}`); params.push(services); }

  if (sets.length === 0) {
    return NextResponse.json({ error: 'Rien à mettre à jour' }, { status: 400 });
  }

  params.push(id);
  const rows = await query(
    `UPDATE promotions SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    params
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Promotion introuvable' }, { status: 404 });
  }

  return NextResponse.json(rows[0]);
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'ID requis' }, { status: 400 });
  }

  const rows = await query('DELETE FROM promotions WHERE id = $1 RETURNING id', [parseInt(id)]);

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Promotion introuvable' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
