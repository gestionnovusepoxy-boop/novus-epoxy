import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireJJ } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  const gate = await requireJJ(req);
  if (gate instanceof NextResponse) return gate;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  let sql = `
    SELECT p.*, c.client_nom, c.ville, c.service, c.statut AS chantier_statut
    FROM jj_planning p
    JOIN jj_chantiers c ON c.id = p.chantier_id
  `;
  const vals: unknown[] = [];

  if (from && to) {
    sql += ` WHERE p.date >= $1 AND p.date <= $2`;
    vals.push(from, to);
  } else {
    sql += ` WHERE p.date >= CURRENT_DATE`;
  }

  sql += ` ORDER BY p.date ASC, p.equipe ASC`;

  const rows = await query(sql, vals);
  return NextResponse.json({ data: rows });
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const body = await req.json().catch(() => null);
  if (!body || !body.chantier_id || !body.date) {
    return NextResponse.json({ error: 'chantier_id et date requis' }, { status: 400 });
  }

  const equipe = body.equipe != null ? Number(body.equipe) : 1;
  const slot = body.slot ?? 'am';
  const jourNumero = body.jour_numero != null ? Number(body.jour_numero) : 1;

  const rows = await query(
    `INSERT INTO jj_planning
       (chantier_id, date, equipe, slot, heure_debut, heure_fin, jour_numero, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      Number(body.chantier_id),
      body.date,
      equipe,
      slot,
      body.heure_debut ?? null,
      body.heure_fin ?? null,
      jourNumero,
      body.notes ?? null,
    ],
  );

  // Logique: dès qu'un contrat a une journée à l'horaire, il passe de
  // 'a_planifier' à 'planifie' automatiquement.
  await query(
    `UPDATE jj_chantiers SET statut = 'planifie', updated_at = NOW()
     WHERE id = $1 AND statut = 'a_planifier'`,
    [Number(body.chantier_id)],
  ).catch(() => {});

  return NextResponse.json(rows[0], { status: 201 });
}
