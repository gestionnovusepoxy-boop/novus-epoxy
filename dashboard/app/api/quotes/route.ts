import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { calculateQuote, calculateMultiQuote, SERVICES, type ServiceType } from '@/lib/pricing';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const page   = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const limit  = Math.min(100, parseInt(searchParams.get('limit') ?? '25'));
  const statut = searchParams.get('statut') ?? '';
  const search = searchParams.get('search') ?? '';
  const offset = (page - 1) * limit;

  const showAll = searchParams.get('all') === 'true';
  let where = showAll ? 'WHERE 1=1' : `WHERE statut NOT IN ('depot_paye', 'planifie', 'complete')`;
  const params: unknown[] = [];
  let i = 1;

  if (statut) {
    where = `WHERE statut = $${i++}`;
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
  const { client_nom, client_email, client_tel, client_adresse, etat_plancher, notes, submission_id, rabais_pct } = body;

  // Support both old (single service) and new (multi items + extras) format
  const items: { type_service: string; superficie: number; prix_fixe?: number }[] = body.items ?? [];
  const extras: { description: string; quantite: number; prix_unitaire: number }[] = body.extras ?? [];

  // Backwards compat: if no items array, use single type_service + superficie
  if (items.length === 0 && body.type_service && body.superficie) {
    items.push({ type_service: body.type_service, superficie: parseFloat(body.superficie) });
  }

  if (!client_nom || !client_email || items.length === 0) {
    return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
  }

  // Validate all service types
  for (const item of items) {
    if (!(item.type_service in SERVICES)) {
      return NextResponse.json({ error: `Type de service invalide: ${item.type_service}` }, { status: 400 });
    }
  }

  const rabaisExplicit = rabais_pct !== undefined && rabais_pct !== null;
  let rabaisPct = Math.min(100, Math.max(0, parseFloat(rabais_pct ?? 0) || 0));

  // Only auto-apply promos if rabais was NOT explicitly set by user
  if (!rabaisExplicit) {
    try {
      const promoRows = await query(
        `SELECT rabais_pct, services FROM promotions
         WHERE actif = true AND date_debut <= CURRENT_DATE AND date_fin >= CURRENT_DATE
         ORDER BY rabais_pct DESC LIMIT 1`
      );
      if (promoRows.length > 0) {
        const promo = promoRows[0];
        const services = promo.services as string[];
        if (!services || services.length === 0 || items.some(i => services.includes(i.type_service))) {
          rabaisPct = Number(promo.rabais_pct);
        }
      }
    } catch (err) {
      console.error('Failed to check active promos for quote:', err);
    }
  }

  // Use multi-quote calculator if items > 1 or extras exist, otherwise single for backwards compat
  const typedItems = items.map(i => ({ type_service: i.type_service as ServiceType, superficie: Number(i.superficie), prix_fixe: i.prix_fixe ? Number(i.prix_fixe) : undefined }));
  const typedExtras = extras.map(e => ({ description: e.description, quantite: Number(e.quantite), prix_unitaire: Number(e.prix_unitaire) }));

  // Always use multi-quote calculator (supports prix_fixe)
  const multi = calculateMultiQuote(typedItems, typedExtras, rabaisPct);
  const calc = {
    prix_pied_carre: typedItems[0]?.prix_fixe ? 0 : (typedItems[0] ? SERVICES[typedItems[0].type_service].prix : 0),
    rabais_pct: multi.rabais_pct,
    rabais_montant: multi.rabais_montant,
    sous_total: multi.sous_total,
    tps: multi.tps,
    tvq: multi.tvq,
    total: multi.total,
    depot_requis: multi.depot_requis,
  };

  // Primary type_service = first item (for backwards compat display)
  const primaryService = typedItems[0].type_service;
  const primarySuperficie = typedItems[0].superficie;

  const rows = await query(
    `INSERT INTO quotes (client_nom, client_email, client_tel, client_adresse, type_service, superficie, etat_plancher, notes, prix_pied_carre, rabais_pct, rabais_montant, sous_total, tps, tvq, total, depot_requis, submission_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      client_nom, client_email, client_tel ?? null, client_adresse ?? null,
      primaryService, primarySuperficie,
      etat_plancher ?? null, notes ?? null,
      calc.prix_pied_carre, calc.rabais_pct, calc.rabais_montant, calc.sous_total, calc.tps, calc.tvq, calc.total, calc.depot_requis,
      submission_id ?? null,
    ],
  );

  const quoteId = rows[0].id as number;

  // Insert quote items (supports prix_fixe)
  for (let idx = 0; idx < typedItems.length; idx++) {
    const item = typedItems[idx];
    const hasPrixFixe = item.prix_fixe && item.prix_fixe > 0;
    const prix = hasPrixFixe ? 0 : SERVICES[item.type_service].prix;
    const st = hasPrixFixe ? item.prix_fixe! : Math.round(prix * item.superficie * 100) / 100;
    await query(
      `INSERT INTO quote_items (quote_id, type_service, superficie, prix_pied_carre, sous_total, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [quoteId, item.type_service, item.superficie || 0, prix, st, idx],
    );
  }

  // Insert quote extras
  for (let idx = 0; idx < typedExtras.length; idx++) {
    const ex = typedExtras[idx];
    const st = Math.round(ex.quantite * ex.prix_unitaire * 100) / 100;
    await query(
      `INSERT INTO quote_extras (quote_id, description, quantite, prix_unitaire, sous_total, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [quoteId, ex.description, ex.quantite, ex.prix_unitaire, st, idx],
    );
  }

  return NextResponse.json(rows[0], { status: 201 });
}
