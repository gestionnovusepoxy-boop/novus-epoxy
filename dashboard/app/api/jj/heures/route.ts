import { NextRequest, NextResponse } from 'next/server';
import { requireJJ } from '@/lib/auth';
import { query } from '@/lib/db';

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(req: NextRequest) {
  const gate = await requireJJ(req);
  if (gate instanceof NextResponse) return gate;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');
  const workerId = searchParams.get('worker_id');

  const conditions: string[] = [];
  const vals: unknown[] = [];

  if (from) { vals.push(from); conditions.push(`h.date >= $${vals.length}`); }
  if (to)   { vals.push(to);   conditions.push(`h.date <= $${vals.length}`); }
  if (workerId) { vals.push(parseInt(workerId, 10)); conditions.push(`h.worker_id = $${vals.length}`); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await query(
    `SELECT h.*, w.nom AS worker_nom, c.client_nom AS chantier_client_nom
     FROM jj_heures h
     JOIN jj_workers w ON w.id = h.worker_id
     LEFT JOIN jj_chantiers c ON c.id = h.chantier_id
     ${where}
     ORDER BY h.date DESC`,
    vals,
  );

  const totals = await query(
    `SELECT h.worker_id, w.nom, SUM(h.heures) AS total_heures,
            SUM(h.heures * h.taux_horaire) AS total_montant,
            SUM(CASE WHEN h.paye THEN h.heures * h.taux_horaire ELSE 0 END) AS total_paye
     FROM jj_heures h
     JOIN jj_workers w ON w.id = h.worker_id
     ${where}
     GROUP BY h.worker_id, w.nom`,
    vals,
  );

  return NextResponse.json({
    data: rows.map(r => ({
      ...r,
      heures: num(r.heures),
      taux_horaire: num(r.taux_horaire),
    })),
    par_worker: totals.map(t => ({
      worker_id: t.worker_id,
      nom: t.nom,
      total_heures: num(t.total_heures),
      total_montant: num(t.total_montant),
      total_paye: num(t.total_paye),
    })),
  });
}

export async function POST(req: NextRequest) {
  const gate = await requireJJ(req);
  if (gate instanceof NextResponse) return gate;

  const body = await req.json().catch(() => null);
  if (!body || !body.worker_id || !body.date || body.heures == null) {
    return NextResponse.json({ error: 'worker_id, date et heures requis' }, { status: 400 });
  }

  const workerId = parseInt(String(body.worker_id), 10);
  if (!Number.isFinite(workerId)) {
    return NextResponse.json({ error: 'worker_id invalide' }, { status: 400 });
  }

  const workers = await query(`SELECT taux_horaire FROM jj_workers WHERE id = $1`, [workerId]);
  if (workers.length === 0) return NextResponse.json({ error: 'Worker introuvable' }, { status: 404 });

  const tauxSnapshot = num(workers[0].taux_horaire);
  const heures = num(body.heures);
  const chantierId = body.chantier_id != null ? parseInt(String(body.chantier_id), 10) : null;
  const equipe = body.equipe != null ? Number(body.equipe) : null;

  const rows = await query(
    `INSERT INTO jj_heures (worker_id, chantier_id, equipe, date, heures, taux_horaire, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      workerId,
      chantierId && Number.isFinite(chantierId) ? chantierId : null,
      equipe,
      body.date,
      heures,
      tauxSnapshot,
      body.notes ?? null,
    ],
  );

  return NextResponse.json(
    { ...rows[0], heures: num(rows[0].heures), taux_horaire: num(rows[0].taux_horaire) },
    { status: 201 },
  );
}
