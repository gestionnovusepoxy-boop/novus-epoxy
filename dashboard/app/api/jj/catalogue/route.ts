import { NextRequest, NextResponse } from 'next/server';
import { requireJJ } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(req: NextRequest) {
  const gate = await requireJJ(req);
  if (gate instanceof NextResponse) return gate;

  const rows = await query(
    `SELECT id, nom, cout_unitaire, unite, actif, created_at
     FROM jj_produits_catalogue
     WHERE actif = TRUE
     ORDER BY nom ASC`,
    [],
  );

  return NextResponse.json({
    data: rows.map(r => ({ ...r, cout_unitaire: Number(r.cout_unitaire ?? 0) })),
  });
}

export async function POST(req: NextRequest) {
  const gate = await requireJJ(req);
  if (gate instanceof NextResponse) return gate;

  const body = await req.json().catch(() => null);
  if (!body || !body.nom) {
    return NextResponse.json({ error: 'nom requis' }, { status: 400 });
  }

  const coutUnitaire = body.cout_unitaire != null ? Number(body.cout_unitaire) : 0;
  const unite = typeof body.unite === 'string' ? body.unite : null;

  const rows = await query(
    `INSERT INTO jj_produits_catalogue (nom, cout_unitaire, unite)
     VALUES ($1, $2, $3)
     ON CONFLICT (nom) DO UPDATE SET cout_unitaire = EXCLUDED.cout_unitaire, unite = EXCLUDED.unite
     RETURNING *`,
    [body.nom, coutUnitaire, unite],
  );

  return NextResponse.json(
    { ...rows[0], cout_unitaire: Number(rows[0].cout_unitaire ?? 0) },
    { status: 201 },
  );
}
