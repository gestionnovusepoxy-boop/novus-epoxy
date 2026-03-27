import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

const VALID_STATUT = ['nouveau', 'contacte', 'devis_envoye', 'rdv_pris', 'ferme', 'gagne'] as const;
const VALID_TEMP   = ['chaud', 'tiede', 'froid'] as const;

// Auto-score lead temperature based on notes keywords
const HOT_KW = ['asap','maintenant','rapidement','le plus tot','le plus tôt','cette semaine','urgent','tout de suite','immediat','immédiat','des que possible','dès que possible','au plus vite','presse','pressé','vite','demain','aujourd','ready','pret','prêt','commencer','le plus vite','rapide'];
const COLD_KW = ['pas de date','a voir','à voir','???','juste savoir','pas presse','pas pressé','aucune idee','aucune idée','sais pas','pas sur','pas sûr','pas certain','no date','annee prochaine','année prochaine','pas pour tout de suite','dans longtemps','pas decide','pas décidé'];

function autoScoreTemp(notes: string | null, service: string | null): 'chaud' | 'tiede' | 'froid' {
  const text = ((notes ?? '') + ' ' + (service ?? '')).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const kw of HOT_KW) { if (text.includes(kw.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) return 'chaud'; }
  for (const kw of COLD_KW) { if (text.includes(kw.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) return 'froid'; }
  if (!notes || notes.trim().length < 5) return 'froid';
  return 'tiede';
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const page   = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const limit  = Math.min(100, parseInt(searchParams.get('limit') ?? '25'));
  const statut      = searchParams.get('statut') ?? '';
  const type        = searchParams.get('type') ?? '';
  const temperature = searchParams.get('temperature') ?? '';
  const search      = searchParams.get('search') ?? '';
  const source      = searchParams.get('source') ?? '';
  const offset = (page - 1) * limit;

  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  let i = 1;

  if (statut) {
    where += ` AND statut = $${i++}`;
    params.push(statut);
  }
  if (type) {
    where += ` AND type = $${i++}`;
    params.push(type);
  }
  if (temperature) {
    where += ` AND temperature = $${i++}`;
    params.push(temperature);
  }
  if (source) {
    where += ` AND source = $${i++}`;
    params.push(source);
  }
  if (search) {
    where += ` AND (nom ILIKE $${i} OR telephone ILIKE $${i} OR email ILIKE $${i})`;
    params.push(`%${search}%`);
    i++;
  }

  const [countRows, statsRows, dataRows, sourceRows] = await Promise.all([
    query(`SELECT COUNT(*)::int AS count FROM crm_leads ${where}`, params),
    query(`SELECT temperature, COUNT(*)::int AS count FROM crm_leads ${where} GROUP BY temperature`, params),
    query(
      `SELECT * FROM crm_leads ${where} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i}`,
      [...params, limit, offset],
    ),
    // Always count all sources (unfiltered) for the source tabs
    query(`SELECT COALESCE(source, 'autre') as source, COUNT(*)::int AS count FROM crm_leads GROUP BY source ORDER BY count DESC`),
  ]);

  const total = (countRows[0]?.count as number) ?? 0;
  const stats = { chaud: 0, tiede: 0, froid: 0 };
  for (const row of statsRows) {
    const t = row.temperature as string;
    if (t in stats) stats[t as keyof typeof stats] = row.count as number;
  }

  const sources: Record<string, number> = {};
  let sourcesTotal = 0;
  for (const row of sourceRows) {
    sources[row.source as string] = row.count as number;
    sourcesTotal += row.count as number;
  }

  return NextResponse.json({ data: dataRows, total, page, limit, stats, sources: { ...sources, _total: sourcesTotal } });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { nom, telephone, email, service, superficie, ville, notes, source, statut, temperature, type } = body;

  if (!nom) return NextResponse.json({ error: 'nom requis' }, { status: 400 });

  const statutVal = VALID_STATUT.includes(statut) ? statut : 'nouveau';
  const tempVal   = VALID_TEMP.includes(temperature) ? temperature : autoScoreTemp(notes, service);
  const typeVal   = ['residentiel', 'commercial'].includes(type) ? type : 'residentiel';

  const rows = await query(
    `INSERT INTO crm_leads (nom, telephone, email, service, superficie, ville, notes, source, statut, temperature, type)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      nom.slice(0, 120),
      telephone ?? null,
      email ?? null,
      service ?? null,
      superficie ?? null,
      ville ?? null,
      notes ?? null,
      source ?? 'manuel',
      statutVal,
      tempVal,
      typeVal,
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
