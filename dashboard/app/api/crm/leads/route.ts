import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

const VALID_STATUT = ['nouveau', 'contacte', 'devis_envoye', 'rdv_pris', 'ferme', 'gagne'] as const;
const VALID_TEMP   = ['chaud', 'tiede', 'froid'] as const;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const page   = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const limit  = Math.min(100, parseInt(searchParams.get('limit') ?? '25'));
  const statut = searchParams.get('statut') ?? '';
  const search = searchParams.get('search') ?? '';
  const offset = (page - 1) * limit;

  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  let i = 1;

  if (statut) {
    where += ` AND statut = $${i++}`;
    params.push(statut);
  }
  if (search) {
    where += ` AND (nom ILIKE $${i} OR telephone ILIKE $${i} OR email ILIKE $${i})`;
    params.push(`%${search}%`);
    i++;
  }

  const countRows = await query(`SELECT COUNT(*)::int AS count FROM crm_leads ${where}`, params);
  const total = (countRows[0]?.count as number) ?? 0;

  const dataRows = await query(
    `SELECT * FROM crm_leads ${where} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i}`,
    [...params, limit, offset],
  );

  return NextResponse.json({ data: dataRows, total, page, limit });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { nom, telephone, email, service, superficie, ville, notes, source, statut, temperature } = body;

  if (!nom) return NextResponse.json({ error: 'nom requis' }, { status: 400 });

  const statutVal = VALID_STATUT.includes(statut) ? statut : 'nouveau';
  const tempVal   = VALID_TEMP.includes(temperature) ? temperature : 'tiede';

  const rows = await query(
    `INSERT INTO crm_leads (nom, telephone, email, service, superficie, ville, notes, source, statut, temperature)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      nom.slice(0, 120),
      telephone ?? null,
      email ?? null,
      service ?? null,
      superficie ?? null,
      ville ?? null,
      notes ?? null,
      source ?? 'jason',
      statutVal,
      tempVal,
    ],
  );

  return NextResponse.json(rows[0], { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = parseInt(searchParams.get('id') ?? '0');
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  const body = await req.json();
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (body.statut !== undefined) {
    if (!VALID_STATUT.includes(body.statut)) return NextResponse.json({ error: 'statut invalide' }, { status: 400 });
    sets.push(`statut = $${i++}`);
    params.push(body.statut);
  }
  if (body.temperature !== undefined) {
    if (!VALID_TEMP.includes(body.temperature)) return NextResponse.json({ error: 'temperature invalide' }, { status: 400 });
    sets.push(`temperature = $${i++}`);
    params.push(body.temperature);
  }

  if (sets.length === 0) return NextResponse.json({ error: 'rien à mettre à jour' }, { status: 400 });

  sets.push(`updated_at = NOW()`);
  params.push(id);

  const rows = await query(
    `UPDATE crm_leads SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    params,
  );

  if (rows.length === 0) return NextResponse.json({ error: 'lead introuvable' }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = parseInt(searchParams.get('id') ?? '0');
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  await query(`DELETE FROM crm_leads WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
