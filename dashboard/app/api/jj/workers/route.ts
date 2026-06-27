import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireJJ } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  const gate = await requireJJ(req);
  if (gate instanceof NextResponse) return gate;

  const rows = await query(
    `SELECT id, nom, taux_horaire, telephone, equipe, actif, created_at
     FROM jj_workers
     ORDER BY actif DESC, nom ASC`,
    [],
  );

  return NextResponse.json({
    data: rows.map(r => ({
      ...r,
      taux_horaire: Number(r.taux_horaire ?? 0),
    })),
  });
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const body = await req.json().catch(() => null);
  if (!body || !body.nom) {
    return NextResponse.json({ error: 'nom requis' }, { status: 400 });
  }

  const tauxHoraire = body.taux_horaire != null ? Number(body.taux_horaire) : 0;
  const telephone = typeof body.telephone === 'string' ? body.telephone : null;
  const equipe = body.equipe != null ? Number(body.equipe) : null;

  const rows = await query(
    `INSERT INTO jj_workers (nom, taux_horaire, telephone, equipe) VALUES ($1, $2, $3, $4) RETURNING *`,
    [body.nom, tauxHoraire, telephone, equipe],
  );

  return NextResponse.json(
    { ...rows[0], taux_horaire: Number(rows[0].taux_horaire ?? 0) },
    { status: 201 },
  );
}
