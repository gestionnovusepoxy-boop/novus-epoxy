import { NextRequest, NextResponse } from 'next/server';
import { auth, requireAdmin } from '@/lib/auth';
import { query } from '@/lib/db';
import { calculateQuoteWithExtras, type ServiceType, SERVICES } from '@/lib/pricing';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const rows = await query('SELECT * FROM quotes WHERE id = $1', [parseInt(id)]);
  if (!rows[0]) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });

  // Verify ownership: user must own the quote or be the admin
  const quote = rows[0];
  const userEmail = session.user?.email?.toLowerCase().trim();
  const isOwner = (quote.client_email as string | undefined)?.toLowerCase().trim() === userEmail;
  const isAdmin = userEmail === process.env.ADMIN_EMAIL?.toLowerCase().trim();
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
  }

  // Fetch items and extras
  const items = await query('SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY sort_order', [parseInt(id)]).catch(() => []);
  const extras = await query('SELECT * FROM quote_extras WHERE quote_id = $1 ORDER BY sort_order', [parseInt(id)]).catch(() => []);

  return NextResponse.json({ ...rows[0], items, extras });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const current = await query('SELECT client_email FROM quotes WHERE id = $1', [parseInt(id)]);
  if (!current[0]) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });

  // Verify ownership
  const userEmail = session.user?.email?.toLowerCase().trim();
  const isOwner = (current[0].client_email as string | undefined)?.toLowerCase().trim() === userEmail;
  const isAdmin = userEmail === process.env.ADMIN_EMAIL?.toLowerCase().trim();
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 });
  }
  const body = await req.json();
  const allowed = ['statut', 'client_nom', 'client_email', 'client_tel', 'client_adresse', 'type_service', 'superficie', 'etat_plancher', 'notes', 'description_travaux', 'couleur_flake', 'contrat_signature_nom', 'rabais_pct', 'sous_total'];

  // Valide type_service contre SERVICES — un service inconnu ferait planter send/send-sms (SERVICES[x].label).
  if (body.type_service !== undefined && !(body.type_service in SERVICES)) {
    return NextResponse.json({ error: `type_service invalide: ${body.type_service}` }, { status: 400 });
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  // Recalculer si service / superficie / rabais / prix_fixe change.
  // ALWAYS include extras when computing sous_total/taxes (extras = prix fixe sans rabais).
  const needsRecalc =
    body.type_service !== undefined ||
    body.superficie !== undefined ||
    body.rabais_pct !== undefined ||
    body.sous_total !== undefined;
  let serviceNetForItem: number | null = null;

  if (needsRecalc) {
    const currentFull = await query('SELECT * FROM quotes WHERE id = $1', [parseInt(id)]);
    if (!currentFull[0]) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });

    const extrasRows = await query('SELECT sous_total FROM quote_extras WHERE quote_id = $1', [parseInt(id)]).catch(() => []);
    const extrasTotal = extrasRows.reduce<number>((s, r) => s + Number(r.sous_total || 0), 0);

    const service = (body.type_service ?? currentFull[0].type_service) as ServiceType;
    const superficie = parseFloat(body.superficie ?? currentFull[0].superficie);
    const rabais = parseFloat(body.rabais_pct ?? currentFull[0].rabais_pct ?? 0);
    const prixCarre = Number(body.prix_pied_carre ?? currentFull[0].prix_pied_carre ?? 0);

    // Prix fixe : si body.sous_total est explicitement passé (modal édition), c'est le sous_total SERVICE seul.
    // Sinon on conserve le sous_total service existant (currentFull[0].sous_total - extras_actuels post-rabais).
    const isPrixFixe = (!prixCarre || prixCarre === 0) && Number(currentFull[0].sous_total) > 0;
    let sousTotalService: number;
    if (body.sous_total !== undefined && isPrixFixe) {
      sousTotalService = parseFloat(body.sous_total);
    } else if (isPrixFixe) {
      // Reconstruct service-only from currentFull : currentFull.sous_total - previousExtrasNet
      const prevRabais = Number(currentFull[0].rabais_pct ?? 0);
      const currentSousTotal = Number(currentFull[0].sous_total ?? 0);
      // Avant fix: currentFull.sous_total = service_net SEUL. On garde cette convention.
      sousTotalService = currentSousTotal / (1 - prevRabais / 100 || 1); // brut
    } else {
      sousTotalService = 0; // calculé par le helper via prix_pied_carre * superficie
    }

    if (service in SERVICES || isPrixFixe) {
      const calc = calculateQuoteWithExtras({
        serviceType: service,
        superficie,
        prixPiedCarre: isPrixFixe ? 0 : (SERVICES[service]?.prix ?? prixCarre),
        sousTotalService: isPrixFixe ? sousTotalService : 0,
        rabaisPct: rabais,
        extrasTotal,
      });
      body.prix_pied_carre = calc.prix_pied_carre;
      body.sous_total = calc.sous_total;
      body.tps = calc.tps;
      body.tvq = calc.tvq;
      body.total = calc.total;
      body.depot_requis = calc.depot_requis;
      body.rabais_pct = calc.rabais_pct;
      body.rabais_montant = calc.rabais_montant;
      // Store SERVICE BRUT in quote_items.sous_total (gross before rabais).
      // The rabais line + sous_total at the quote level already reflect the discount.
      serviceNetForItem = calc.service_brut;
    }
  }

  const allFields = [...allowed, 'prix_pied_carre', 'tps', 'tvq', 'total', 'depot_requis', 'rabais_montant'];

  for (const key of allFields) {
    if (key in body) {
      sets.push(`${key} = $${i++}`);
      values.push(body[key]);
    }
  }

  if (body.statut === 'approuve') {
    sets.push(`approved_at = NOW()`);
  }
  if (body.statut === 'envoye') {
    sets.push(`sent_at = NOW()`);
  }
  if (body.statut === 'contrat_signe') {
    sets.push(`contrat_signe_at = NOW()`);
  }

  if (sets.length === 0) {
    return NextResponse.json({ error: 'Rien à mettre à jour' }, { status: 400 });
  }

  values.push(parseInt(id));
  const rows = await query(
    `UPDATE quotes SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    values,
  );

  if (!rows[0]) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });

  // Sync quote_items: store service_net (post-rabais service only, NOT extras).
  // sous_total at the quote level already includes extras; the item line shows the service alone.
  if (body.superficie !== undefined || serviceNetForItem !== null) {
    const items = await query('SELECT id FROM quote_items WHERE quote_id = $1', [parseInt(id)]).catch(() => []);
    if (items.length === 1) {
      const itemUpdates: string[] = [];
      const itemVals: unknown[] = [];
      if (body.superficie !== undefined) { itemUpdates.push(`superficie = $${itemUpdates.length + 1}`); itemVals.push(parseFloat(body.superficie)); }
      if (serviceNetForItem !== null) { itemUpdates.push(`sous_total = $${itemUpdates.length + 1}`); itemVals.push(serviceNetForItem); }
      if (itemUpdates.length > 0) {
        itemVals.push(items[0].id);
        await query(`UPDATE quote_items SET ${itemUpdates.join(', ')} WHERE id = $${itemVals.length}`, itemVals).catch(() => {});
      }
    }
  }

  // Propagate price changes to the linked invoice if it exists and is NOT yet paid.
  if (body.sous_total !== undefined || body.total !== undefined) {
    const invs = await query(
      `SELECT id, depot_paye, final_paye FROM invoices WHERE quote_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [parseInt(id)]
    ).catch(() => []);
    if (invs[0] && !invs[0].depot_paye && !invs[0].final_paye) {
      const fresh = rows[0];
      const total = Number(fresh.total);
      const depotMontant = Math.round(total * 0.30 * 100) / 100;
      const finalMontant = Math.round((total - depotMontant) * 100) / 100;
      await query(
        `UPDATE invoices SET sous_total = $1, tps = $2, tvq = $3, total = $4, depot_montant = $5, final_montant = $6, updated_at = NOW() WHERE id = $7`,
        [fresh.sous_total, fresh.tps, fresh.tvq, total, depotMontant, finalMontant, invs[0].id]
      ).catch(() => {});
    }
  }

  const items = await query('SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY sort_order', [parseInt(id)]).catch(() => []);
  const extras = await query('SELECT * FROM quote_extras WHERE quote_id = $1 ORDER BY sort_order', [parseInt(id)]).catch(() => []);


  return NextResponse.json({ ...rows[0], items, extras });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const quoteId = parseInt(id);

  const rows = await query('SELECT statut FROM quotes WHERE id = $1', [quoteId]);
  if (!rows[0]) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });

  const protectedStatuts = ['depot_paye', 'planifie', 'complete'];
  if (protectedStatuts.includes(rows[0].statut as string)) {
    return NextResponse.json({ error: 'Impossible de supprimer un devis avec depot paye ou complete' }, { status: 400 });
  }

  // Nullify booking FK on quote, then delete booking, then delete quote
  await query('UPDATE quotes SET booking_id = NULL WHERE id = $1', [quoteId]);
  await query('DELETE FROM bookings WHERE quote_id = $1', [quoteId]);
  await query('DELETE FROM quotes WHERE id = $1', [quoteId]);

  return NextResponse.json({ success: true });
}
