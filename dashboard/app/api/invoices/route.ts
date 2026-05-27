import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { insertInvoiceWithRetry } from '@/lib/invoice-numero';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const page   = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
  const limit  = Math.min(100, parseInt(searchParams.get('limit') ?? '25'));
  const statut = searchParams.get('statut') ?? '';
  const search = searchParams.get('search') ?? '';
  const quoteIdParam = searchParams.get('quote_id') ?? '';
  const offset = (page - 1) * limit;

  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  let i = 1;

  if (quoteIdParam) {
    where += ` AND inv.quote_id = $${i++}`;
    params.push(parseInt(quoteIdParam));
  }
  if (statut) {
    where += ` AND inv.statut = $${i++}`;
    params.push(statut);
  }
  if (search) {
    where += ` AND (c.nom ILIKE $${i} OR c.email ILIKE $${i} OR inv.numero ILIKE $${i})`;
    params.push(`%${search}%`);
    i++;
  }

  const countRows = await query(
    `SELECT COUNT(*)::int AS count FROM invoices inv JOIN clients c ON c.id = inv.client_id ${where}`,
    params,
  );
  const total = (countRows[0]?.count as number) ?? 0;

  const dataRows = await query(
    `SELECT inv.*, c.nom AS client_nom, c.email AS client_email, c.telephone AS client_tel
     FROM invoices inv JOIN clients c ON c.id = inv.client_id
     ${where} ORDER BY inv.created_at DESC LIMIT $${i++} OFFSET $${i}`,
    [...params, limit, offset],
  );

  return NextResponse.json({ data: dataRows, total, page, limit });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const body = await req.json();
  const { quote_id } = body;

  if (!quote_id) return NextResponse.json({ error: 'quote_id requis' }, { status: 400 });

  // Fetch quote
  const quoteRows = await query('SELECT * FROM quotes WHERE id = $1', [quote_id]);
  const quote = quoteRows[0];
  if (!quote) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });

  // Check not already invoiced
  const existingInv = await query('SELECT id FROM invoices WHERE quote_id = $1', [quote_id]);
  if (existingInv[0]) {
    return NextResponse.json({ error: 'Ce devis a déjà une facture', invoice_id: existingInv[0].id }, { status: 409 });
  }

  // Find or create client
  const email = (quote.client_email as string).toLowerCase().trim();
  let clientRows = await query('SELECT * FROM clients WHERE email = $1', [email]);
  if (!clientRows[0]) {
    clientRows = await query(
      `INSERT INTO clients (nom, email, telephone, adresse) VALUES ($1, $2, $3, $4) RETURNING *`,
      [quote.client_nom, email, quote.client_tel ?? null, quote.client_adresse ?? null],
    );
  }
  const clientId = clientRows[0].id as number;

  // Calculate deposit & final
  const total = Number(quote.total);
  const depot = Number(quote.depot_requis);
  const finalMontant = Math.round((total - depot) * 100) / 100;

  // Race-safe invoice number generation. Pairs with UNIQUE(invoices.numero)
  // added in migration-031. On 23505 (unique_violation) the helper re-mints
  // and retries up to 5 times.
  const rows = await insertInvoiceWithRetry({ digits: 3 }, async (numero) => {
    return await query(
      `INSERT INTO invoices (numero, quote_id, client_id, type_service, superficie, prix_pied_carre, rabais_pct, rabais_montant, sous_total, tps, tvq, total, depot_montant, final_montant)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        numero, quote_id, clientId,
        quote.type_service, quote.superficie, quote.prix_pied_carre,
        quote.rabais_pct ?? 0, quote.rabais_montant ?? 0,
        quote.sous_total, quote.tps, quote.tvq, quote.total,
        depot, finalMontant,
      ],
    );
  });

  return NextResponse.json(rows[0], { status: 201 });
}
