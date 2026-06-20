import { NextRequest, NextResponse } from 'next/server';
import { auth, requireAdmin } from '@/lib/auth';
import { query } from '@/lib/db';
import { getSubcontractProfit } from '@/lib/subcontract';

function num(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// GET — détail d'un contrat de sous-traitance: quote + partenaire + breakdown
// profit + factures liées + dépenses liées.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const quoteId = parseInt(id);
  if (!Number.isFinite(quoteId)) {
    return NextResponse.json({ error: 'id invalide' }, { status: 400 });
  }

  const rows = await query(
    `SELECT q.*, p.nom AS partner_nom, p.telephone AS partner_telephone, p.email AS partner_email
     FROM quotes q
     LEFT JOIN partners p ON p.id = q.partner_id
     WHERE q.id = $1 AND q.is_subcontract = TRUE`,
    [quoteId],
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Contrat introuvable' }, { status: 404 });
  }

  const [profit, invoices, expenses] = await Promise.all([
    getSubcontractProfit(quoteId),
    query(
      `SELECT id, numero, statut, created_at FROM invoices WHERE quote_id = $1 ORDER BY created_at DESC`,
      [quoteId],
    ),
    query(
      `SELECT id, fournisseur, description, categorie, montant, montant_ttc, date_depense
       FROM expenses WHERE quote_id = $1 ORDER BY date_depense DESC`,
      [quoteId],
    ),
  ]);

  return NextResponse.json({
    contract: rows[0],
    profit,
    invoices,
    expenses,
  });
}

// PATCH — modifier contract_price / profit_split_pct / partner_id / statut / notes.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const quoteId = parseInt(id);
  if (!Number.isFinite(quoteId)) {
    return NextResponse.json({ error: 'id invalide' }, { status: 400 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Corps invalide' }, { status: 400 });

  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;

  if ('contract_price' in body) {
    sets.push(`contract_price = $${i++}`);
    vals.push(body.contract_price != null ? num(body.contract_price) : null);
  }
  if ('profit_split_pct' in body) {
    sets.push(`profit_split_pct = $${i++}`);
    vals.push(body.profit_split_pct != null ? num(body.profit_split_pct, 50) : null);
  }
  if ('partner_id' in body) {
    sets.push(`partner_id = $${i++}`);
    vals.push(body.partner_id != null ? parseInt(String(body.partner_id)) : null);
  }
  if ('statut' in body && typeof body.statut === 'string') {
    sets.push(`statut = $${i++}`);
    vals.push(body.statut);
  }
  if ('notes' in body) {
    sets.push(`notes = $${i++}`);
    vals.push(body.notes ?? null);
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: 'Aucun champ à modifier' }, { status: 400 });
  }

  vals.push(quoteId);
  const rows = await query(
    `UPDATE quotes SET ${sets.join(', ')}
     WHERE id = $${i} AND is_subcontract = TRUE
     RETURNING id, client_nom, client_adresse, notes, type_service, statut,
               is_subcontract, partner_id, contract_price, profit_split_pct, created_at`,
    vals,
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Contrat introuvable' }, { status: 404 });
  }

  return NextResponse.json(rows[0]);
}
