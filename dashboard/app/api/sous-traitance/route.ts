import { NextRequest, NextResponse } from 'next/server';
import { auth, requireAdmin } from '@/lib/auth';
import { query } from '@/lib/db';
import { computeProfit } from '@/lib/subcontract';

const VALID_SLOTS = ['matin', 'apres-midi', 'journee'] as const;
type Slot = typeof VALID_SLOTS[number];

function normalizeSlot(s: unknown, fallback: Slot = 'matin'): Slot {
  return VALID_SLOTS.includes(s as Slot) ? (s as Slot) : fallback;
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// GET — liste des contrats de sous-traitance (quotes WHERE is_subcontract=true),
// avec le nom du partenaire et le breakdown de profit calculé pour chacun.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  // Une seule requête: chaque contrat + partenaire + couts agrégés (expenses + main d'oeuvre).
  const rows = await query(
    `SELECT
       q.id, q.client_nom, q.client_adresse, q.type_service, q.notes,
       q.statut, q.contract_price, q.profit_split_pct, q.partner_id,
       q.created_at,
       p.nom AS partner_nom,
       COALESCE((SELECT SUM(montant_ttc) FROM expenses WHERE quote_id = q.id), 0)
       + COALESCE((
           SELECT SUM(te.heures * e.taux_horaire)
           FROM time_entries te
           JOIN employees e ON e.id = te.employee_id
           WHERE te.quote_id = q.id
         ), 0) AS costs
     FROM quotes q
     LEFT JOIN partners p ON p.id = q.partner_id
     WHERE q.is_subcontract = TRUE
     ORDER BY q.created_at DESC`,
    [],
  );

  const data = rows.map(r => {
    const profit = computeProfit({
      contractPrice: r.contract_price as number | null,
      costs: r.costs as number | null,
      splitPct: r.profit_split_pct as number | null,
    });
    return {
      id: r.id,
      client_nom: r.client_nom,
      client_adresse: r.client_adresse,
      type_service: r.type_service,
      notes: r.notes,
      statut: r.statut,
      contract_price: num(r.contract_price),
      profit_split_pct: num(r.profit_split_pct, 50),
      partner_id: r.partner_id,
      partner_nom: r.partner_nom,
      created_at: r.created_at,
      profit,
    };
  });

  return NextResponse.json({ data });
}

// POST — créer un contrat de sous-traitance = un projet dans `quotes` avec
// is_subcontract=true. Crée optionnellement un booking si des dates sont fournies.
export async function POST(req: NextRequest) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Corps invalide' }, { status: 400 });

  const {
    client_nom,
    client_adresse,
    notes,
    partner_id,
    contract_price,
    profit_split_pct,
    type_service,
  } = body;

  if (!client_nom) {
    return NextResponse.json({ error: 'client_nom requis' }, { status: 400 });
  }

  const partnerId = partner_id != null ? parseInt(String(partner_id)) : null;

  // Default le split au split_defaut_pct du partenaire si non fourni.
  let splitPct = profit_split_pct != null ? num(profit_split_pct, 50) : 50;
  if (partnerId && profit_split_pct == null) {
    const partnerRows = await query(
      'SELECT split_defaut_pct FROM partners WHERE id = $1',
      [partnerId],
    );
    if (partnerRows.length > 0) splitPct = num(partnerRows[0].split_defaut_pct, 50);
  }

  const service = (typeof type_service === 'string' && type_service.trim())
    ? type_service.trim()
    : 'soustraitance';

  const rows = await query(
    `INSERT INTO quotes (
       client_nom, client_adresse, notes, type_service, statut,
       is_subcontract, partner_id, contract_price, profit_split_pct
     )
     VALUES ($1, $2, $3, $4, 'planifie', TRUE, $5, $6, $7)
     RETURNING id, client_nom, client_adresse, notes, type_service, statut,
               is_subcontract, partner_id, contract_price, profit_split_pct, created_at`,
    [
      client_nom,
      client_adresse ?? null,
      notes ?? null,
      service,
      partnerId,
      contract_price != null ? num(contract_price) : null,
      splitPct,
    ],
  );

  const contract = rows[0];
  const quoteId = contract.id as number;

  // Optionnel: créer un booking si des dates sont fournies (imite app/api/bookings POST).
  let bookingId: number | null = null;
  if (body.jour1_date) {
    const jour1Slot = normalizeSlot(body.jour1_slot, 'matin');
    const jour2Slot = normalizeSlot(body.jour2_slot, 'apres-midi');
    const jour2Date = body.jour2_date || null;

    const bookingRows = await query(
      `INSERT INTO bookings (quote_id, jour1_date, jour1_slot, jour2_date, jour2_slot, statut)
       VALUES ($1, $2, $3, $4, $5, 'confirme')
       RETURNING id`,
      [quoteId, body.jour1_date, jour1Slot, jour2Date, jour2Date ? jour2Slot : null],
    );
    bookingId = bookingRows[0].id as number;
    await query('UPDATE quotes SET booking_id = $1 WHERE id = $2', [bookingId, quoteId]);
  }

  return NextResponse.json({ ...contract, booking_id: bookingId }, { status: 201 });
}
