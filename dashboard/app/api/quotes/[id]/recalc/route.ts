import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { calculateQuoteWithExtras, SERVICES, type ServiceType } from '@/lib/pricing';

/**
 * POST /api/quotes/[id]/recalc
 * Force a full recalc of the quote: pulls service + extras, applies rabais on service only,
 * adds extras at full price to the sous_total, recomputes taxes, total, depot.
 * Also normalises quote_items.sous_total to the GROSS service amount (before rabais).
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const quoteId = parseInt(id);
  if (isNaN(quoteId)) return NextResponse.json({ error: 'ID invalide' }, { status: 400 });

  const rows = await query('SELECT * FROM quotes WHERE id = $1', [quoteId]);
  if (!rows[0]) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });
  const q = rows[0];

  const extrasRows = await query('SELECT sous_total FROM quote_extras WHERE quote_id = $1', [quoteId]).catch(() => []);
  const extrasTotal = extrasRows.reduce<number>((s, r) => s + Number(r.sous_total || 0), 0);

  const service = q.type_service as ServiceType;
  const isPrixFixe = Number(q.prix_pied_carre) === 0 && Number(q.sous_total) > 0;

  // For prix-fixe quotes, we need the BRUT service amount before any previous rabais.
  // The current quote_items.sous_total already holds (after our fix) the brut amount;
  // for legacy data it might be the net — reconstruct from rabais_pct if needed.
  let sousTotalService = 0;
  if (isPrixFixe) {
    const itemRows = await query('SELECT sous_total FROM quote_items WHERE quote_id = $1', [quoteId]).catch(() => []);
    const itemSousTotal = Number(itemRows[0]?.sous_total ?? q.sous_total);
    const rabaisPctNum = Number(q.rabais_pct ?? 0);
    // Heuristic: if itemSousTotal != q.sous_total - extras, it might be already-net legacy data.
    // Best-effort: use itemSousTotal as brut.
    sousTotalService = itemSousTotal;
    // If it looks already-net (i.e. q.sous_total - extras ≈ itemSousTotal * (1 - rabais)), un-rabais it.
    if (rabaisPctNum > 0 && Math.abs(itemSousTotal - (Number(q.sous_total) - extrasTotal)) < 0.5) {
      sousTotalService = Math.round((itemSousTotal / (1 - rabaisPctNum / 100)) * 100) / 100;
    }
  }

  const calc = calculateQuoteWithExtras({
    serviceType: service,
    superficie: Number(q.superficie),
    prixPiedCarre: isPrixFixe ? 0 : (SERVICES[service]?.prix ?? Number(q.prix_pied_carre)),
    sousTotalService,
    rabaisPct: Number(q.rabais_pct ?? 0),
    extrasTotal,
  });

  await query(
    `UPDATE quotes SET prix_pied_carre = $1, sous_total = $2, tps = $3, tvq = $4, total = $5, depot_requis = $6, rabais_montant = $7 WHERE id = $8`,
    [calc.prix_pied_carre, calc.sous_total, calc.tps, calc.tvq, calc.total, calc.depot_requis, calc.rabais_montant, quoteId]
  );

  // Sync quote_items: store brut service amount for clean display
  const items = await query('SELECT id FROM quote_items WHERE quote_id = $1', [quoteId]).catch(() => []);
  if (items.length === 1) {
    await query(`UPDATE quote_items SET sous_total = $1 WHERE id = $2`, [calc.service_brut, items[0].id]).catch(() => {});
  }

  // Propagate to linked invoice if not yet paid (depot_paye = false).
  // Once depot is paid, the invoice is locked — we don't mutate it.
  let invoiceSynced: { id: number; numero: string } | null = null;
  let invoiceLocked: { id: number; numero: string; reason: string } | null = null;
  const invoices = await query(
    `SELECT id, numero, depot_paye, final_paye FROM invoices WHERE quote_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [quoteId]
  ).catch(() => []);
  if (invoices[0]) {
    const inv = invoices[0];
    if (inv.depot_paye || inv.final_paye) {
      invoiceLocked = { id: inv.id as number, numero: inv.numero as string, reason: inv.final_paye ? 'solde payé' : 'dépôt payé' };
    } else {
      const sousTotal = calc.sous_total;
      const tps = calc.tps;
      const tvq = calc.tvq;
      const total = calc.total;
      const depotMontant = Math.round(total * 0.30 * 100) / 100;
      const finalMontant = Math.round((total - depotMontant) * 100) / 100;
      await query(
        `UPDATE invoices SET sous_total = $1, tps = $2, tvq = $3, total = $4, depot_montant = $5, final_montant = $6, updated_at = NOW() WHERE id = $7`,
        [sousTotal, tps, tvq, total, depotMontant, finalMontant, inv.id]
      ).catch(() => {});
      invoiceSynced = { id: inv.id as number, numero: inv.numero as string };
    }
  }

  return NextResponse.json({
    ok: true,
    service_brut: calc.service_brut,
    service_net: calc.service_net,
    extras_total: calc.extras_total,
    rabais_montant: calc.rabais_montant,
    sous_total: calc.sous_total,
    tps: calc.tps,
    tvq: calc.tvq,
    total: calc.total,
    depot_requis: calc.depot_requis,
    invoice_synced: invoiceSynced,
    invoice_locked: invoiceLocked,
  });
}
