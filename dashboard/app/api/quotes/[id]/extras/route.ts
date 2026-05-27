import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { auth } from '@/lib/auth';
import { calculateQuoteWithExtras, SERVICES, type ServiceType } from '@/lib/pricing';

// PUT /api/quotes/[id]/extras — replace all extras for a quote (then recalc quote totals)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const quoteId = parseInt(id);
  if (isNaN(quoteId)) return NextResponse.json({ error: 'ID invalide' }, { status: 400 });

  const extras = await req.json().catch(() => []);
  if (!Array.isArray(extras)) return NextResponse.json({ error: 'Format invalide' }, { status: 400 });

  // Delete existing extras
  await query(`DELETE FROM quote_extras WHERE quote_id = $1`, [quoteId]);

  // Insert new extras + sum total
  let extrasTotal = 0;
  for (const ex of extras) {
    if (!ex.description?.trim()) continue;
    const sousTotal = Number(ex.sous_total) || (Number(ex.quantite || 1) * Number(ex.prix_unitaire || 0));
    extrasTotal += sousTotal;
    await query(
      `INSERT INTO quote_extras (quote_id, description, quantite, prix_unitaire, sous_total, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [quoteId, String(ex.description).slice(0, 255), Number(ex.quantite) || 1, Number(ex.prix_unitaire) || 0, sousTotal, Number(ex.sort_order) || 0]
    );
  }

  // Recalc quote totals to reflect new extras (rabais sur service seul, extras = prix fixe)
  const quoteRows = await query('SELECT * FROM quotes WHERE id = $1', [quoteId]);
  if (quoteRows[0]) {
    const q = quoteRows[0];
    const service = q.type_service as ServiceType;
    const itemRows = await query('SELECT sous_total FROM quote_items WHERE quote_id = $1', [quoteId]).catch(() => []);
    const isPrixFixe = Number(q.prix_pied_carre) === 0 && Number(q.sous_total) > 0;
    const sousTotalService = isPrixFixe ? Number(itemRows[0]?.sous_total ?? q.sous_total) : 0;

    const calc = calculateQuoteWithExtras({
      serviceType: service,
      superficie: Number(q.superficie),
      prixPiedCarre: isPrixFixe ? 0 : (SERVICES[service]?.prix ?? Number(q.prix_pied_carre)),
      sousTotalService,
      rabaisPct: Number(q.rabais_pct ?? 0),
      extrasTotal,
    });

    await query(
      `UPDATE quotes SET sous_total = $1, tps = $2, tvq = $3, total = $4, depot_requis = $5, rabais_montant = $6 WHERE id = $7`,
      [calc.sous_total, calc.tps, calc.tvq, calc.total, calc.depot_requis, calc.rabais_montant, quoteId]
    );
  }

  return NextResponse.json({ ok: true });
}
