import { NextRequest, NextResponse } from 'next/server';
import { requireJJ } from '@/lib/auth';
import { query } from '@/lib/db';

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

type Params = { params: Promise<{ id: string }> };

const ALLOWED_PATCH = ['description', 'sous_total', 'recu_url'] as const;

export async function PATCH(req: NextRequest, { params }: Params) {
  const gate = await requireJJ(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const depenseId = parseInt(id, 10);
  if (!Number.isFinite(depenseId)) {
    return NextResponse.json({ error: 'id invalide' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Corps invalide' }, { status: 400 });

  const setClauses: string[] = [];
  const vals: unknown[] = [];

  for (const key of ALLOWED_PATCH) {
    if (body[key] !== undefined) {
      vals.push(body[key]);
      setClauses.push(`${key} = $${vals.length}`);
    }
  }

  // Toggle rembourse: si true → date_rembourse=CURRENT_DATE, si false → NULL.
  if (body.rembourse !== undefined) {
    const rembourse = Boolean(body.rembourse);
    vals.push(rembourse);
    setClauses.push(`rembourse = $${vals.length}`);
    setClauses.push(rembourse ? `date_rembourse = CURRENT_DATE` : `date_rembourse = NULL`);
  }

  if (setClauses.length === 0) {
    return NextResponse.json({ error: 'Aucun champ valide fourni' }, { status: 400 });
  }

  vals.push(depenseId);
  const rows = await query(
    `UPDATE jj_depenses SET ${setClauses.join(', ')} WHERE id = $${vals.length} RETURNING *`,
    vals,
  );

  if (rows.length === 0) return NextResponse.json({ error: 'Dépense introuvable' }, { status: 404 });
  return NextResponse.json({ ...rows[0], sous_total: num(rows[0].sous_total) });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const gate = await requireJJ(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const depenseId = parseInt(id, 10);
  if (!Number.isFinite(depenseId)) {
    return NextResponse.json({ error: 'id invalide' }, { status: 400 });
  }

  const rows = await query(`DELETE FROM jj_depenses WHERE id = $1 RETURNING id`, [depenseId]);
  if (rows.length === 0) return NextResponse.json({ error: 'Dépense introuvable' }, { status: 404 });
  return NextResponse.json({ success: true });
}
