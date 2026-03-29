import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const actif = searchParams.get('actif');

  let sql = 'SELECT * FROM employees';
  const params: unknown[] = [];

  if (actif !== null) {
    sql += ' WHERE actif = $1';
    params.push(actif === 'true');
  }

  sql += ' ORDER BY actif DESC, nom ASC';

  const rows = await query(sql, params);
  return NextResponse.json({ data: rows });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const body = await req.json();
  const { nom, telephone, role, taux_horaire } = body;

  if (!nom) {
    return NextResponse.json({ error: 'nom requis' }, { status: 400 });
  }

  const rows = await query(
    `INSERT INTO employees (nom, telephone, role, taux_horaire)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [nom, telephone ?? null, role ?? 'installateur', taux_horaire ?? 0],
  );

  return NextResponse.json(rows[0], { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  const body = await req.json();
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (body.nom !== undefined) { sets.push(`nom = $${i++}`); params.push(body.nom); }
  if (body.telephone !== undefined) { sets.push(`telephone = $${i++}`); params.push(body.telephone); }
  if (body.role !== undefined) { sets.push(`role = $${i++}`); params.push(body.role); }
  if (body.taux_horaire !== undefined) { sets.push(`taux_horaire = $${i++}`); params.push(body.taux_horaire); }
  if (body.actif !== undefined) { sets.push(`actif = $${i++}`); params.push(body.actif); }

  if (sets.length === 0) {
    return NextResponse.json({ error: 'Aucun champ à modifier' }, { status: 400 });
  }

  params.push(parseInt(id));
  const rows = await query(
    `UPDATE employees SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    params,
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Employé non trouvé' }, { status: 404 });
  }

  return NextResponse.json(rows[0]);
}
