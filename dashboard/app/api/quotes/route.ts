import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { calculateQuote, SERVICES, type ServiceType } from '@/lib/pricing';

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
    where += ` AND (client_nom ILIKE $${i} OR client_email ILIKE $${i})`;
    params.push(`%${search}%`);
    i++;
  }

  const countRows = await query(`SELECT COUNT(*)::int AS count FROM quotes ${where}`, params);
  const total = (countRows[0]?.count as number) ?? 0;

  const dataRows = await query(
    `SELECT * FROM quotes ${where} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i}`,
    [...params, limit, offset],
  );

  return NextResponse.json({ data: dataRows, total, page, limit });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const body = await req.json();
  const { client_nom, client_email, client_tel, client_adresse, type_service, superficie, etat_plancher, notes, submission_id, rabais_pct } = body;

  if (!client_nom || !client_email || !type_service || !superficie) {
    return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
  }

  if (!(type_service in SERVICES)) {
    return NextResponse.json({ error: 'Type de service invalide' }, { status: 400 });
  }

  const rabaisPct = Math.min(100, Math.max(0, parseFloat(rabais_pct ?? 0) || 0));
  const calc = calculateQuote(type_service as ServiceType, parseFloat(superficie), rabaisPct);

  const rows = await query(
    `INSERT INTO quotes (client_nom, client_email, client_tel, client_adresse, type_service, superficie, etat_plancher, notes, prix_pied_carre, rabais_pct, rabais_montant, sous_total, tps, tvq, total, depot_requis, submission_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      client_nom, client_email, client_tel ?? null, client_adresse ?? null,
      type_service, parseFloat(superficie),
      etat_plancher ?? null, notes ?? null,
      calc.prix_pied_carre, calc.rabais_pct, calc.rabais_montant, calc.sous_total, calc.tps, calc.tvq, calc.total, calc.depot_requis,
      submission_id ?? null,
    ],
  );

  return NextResponse.json(rows[0], { status: 201 });
}
