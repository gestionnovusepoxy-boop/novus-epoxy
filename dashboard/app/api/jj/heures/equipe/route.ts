import { NextRequest, NextResponse } from 'next/server';
import { requireJJ } from '@/lib/auth';
import { query } from '@/lib/db';

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// POST — logger des heures pour TOUTE une équipe d'un coup.
// Pour chaque worker actif de l'équipe, insère une ligne jj_heures
// avec snapshot du taux_horaire courant du worker.
export async function POST(req: NextRequest) {
  const gate = await requireJJ(req);
  if (gate instanceof NextResponse) return gate;

  const body = await req.json().catch(() => null);
  if (!body || body.equipe == null || !body.date || body.heures == null) {
    return NextResponse.json({ error: 'equipe, date et heures requis' }, { status: 400 });
  }

  const equipe = Number(body.equipe);
  if (![1, 2].includes(equipe)) {
    return NextResponse.json({ error: 'equipe doit etre 1 ou 2' }, { status: 400 });
  }

  const heures = num(body.heures);
  const chantierId = body.chantier_id != null ? parseInt(String(body.chantier_id), 10) : null;
  const notes = typeof body.notes === 'string' ? body.notes : null;

  const workers = await query(
    `SELECT id, nom, taux_horaire FROM jj_workers WHERE actif = TRUE AND equipe = $1`,
    [equipe],
  );

  if (workers.length === 0) {
    return NextResponse.json(
      { error: `Aucun employé dans l'équipe ${equipe}` },
      { status: 400 },
    );
  }

  const names: string[] = [];
  for (const w of workers) {
    await query(
      `INSERT INTO jj_heures (worker_id, chantier_id, equipe, date, heures, taux_horaire, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        w.id,
        chantierId && Number.isFinite(chantierId) ? chantierId : null,
        equipe,
        body.date,
        heures,
        num(w.taux_horaire),
        notes,
      ],
    );
    names.push(w.nom as string);
  }

  return NextResponse.json({ ok: true, count: names.length, workers: names }, { status: 201 });
}
