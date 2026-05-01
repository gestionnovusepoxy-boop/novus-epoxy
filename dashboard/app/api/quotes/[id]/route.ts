import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { calculateQuote, type ServiceType, SERVICES } from '@/lib/pricing';
import { sendSMS } from '@/lib/sms';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const rows = await query('SELECT * FROM quotes WHERE id = $1', [parseInt(id)]);
  if (!rows[0]) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });

  // Fetch items and extras
  const items = await query('SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY sort_order', [parseInt(id)]).catch(() => []);
  const extras = await query('SELECT * FROM quote_extras WHERE quote_id = $1 ORDER BY sort_order', [parseInt(id)]).catch(() => []);

  return NextResponse.json({ ...rows[0], items, extras });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const allowed = ['statut', 'client_nom', 'client_email', 'client_tel', 'client_adresse', 'type_service', 'superficie', 'etat_plancher', 'notes', 'description_travaux', 'couleur_flake', 'contrat_signature_nom', 'rabais_pct', 'sous_total'];

  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  // If type_service or superficie or rabais_pct changed, recalculate prices
  // BUT skip recalc if this is a prix fixe quote (prix_pied_carre = 0)
  const needsRecalc = body.type_service !== undefined || body.superficie !== undefined || body.rabais_pct !== undefined;
  if (needsRecalc) {
    const current = await query('SELECT * FROM quotes WHERE id = $1', [parseInt(id)]);
    if (!current[0]) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });

    const isPrixFixe = Number(current[0].prix_pied_carre) === 0 && Number(current[0].sous_total) > 0;

    if (!isPrixFixe) {
      const service = (body.type_service ?? current[0].type_service) as ServiceType;
      const superficie = parseFloat(body.superficie ?? current[0].superficie);
      const rabais = parseFloat(body.rabais_pct ?? current[0].rabais_pct ?? 0);

      if (service in SERVICES && superficie > 0) {
        const calc = calculateQuote(service, superficie, rabais);
        body.prix_pied_carre = calc.prix_pied_carre;
        body.sous_total = calc.sous_total;
        body.tps = calc.tps;
        body.tvq = calc.tvq;
        body.total = calc.total;
        body.depot_requis = calc.depot_requis;
        body.rabais_pct = calc.rabais_pct;
        body.rabais_montant = calc.rabais_montant;
      }
    }
    // Prix fixe: if sous_total is explicitly passed, recalculate taxes
    if (isPrixFixe && body.sous_total !== undefined) {
      const sousTotal = parseFloat(body.sous_total);
      const rabais = parseFloat(body.rabais_pct ?? current[0].rabais_pct ?? 0);
      const rabaisMontant = sousTotal * (rabais / 100);
      const sousApresRabais = sousTotal - rabaisMontant;
      const tps = Math.round(sousApresRabais * 0.05 * 100) / 100;
      const tvq = Math.round(sousApresRabais * 0.09975 * 100) / 100;
      const total = Math.round((sousApresRabais + tps + tvq) * 100) / 100;
      body.sous_total = sousApresRabais;
      body.tps = tps;
      body.tvq = tvq;
      body.total = total;
      body.depot_requis = Math.round(total * 0.30 * 100) / 100;
      body.rabais_montant = rabaisMontant;
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

  // Sync quote_items for single-item quotes when superficie or sous_total changes
  if (body.superficie !== undefined || body.sous_total !== undefined) {
    const items = await query('SELECT id FROM quote_items WHERE quote_id = $1', [parseInt(id)]).catch(() => []);
    if (items.length === 1) {
      const itemUpdates: string[] = [];
      const itemVals: unknown[] = [];
      if (body.superficie !== undefined) { itemUpdates.push(`superficie = $${itemUpdates.length + 1}`); itemVals.push(parseFloat(body.superficie)); }
      if (body.sous_total !== undefined) { itemUpdates.push(`sous_total = $${itemUpdates.length + 1}`); itemVals.push(body.sous_total); }
      if (itemUpdates.length > 0) {
        itemVals.push(items[0].id);
        await query(`UPDATE quote_items SET ${itemUpdates.join(', ')} WHERE id = $${itemVals.length}`, itemVals).catch(() => {});
      }
    }
  }

  const items = await query('SELECT * FROM quote_items WHERE quote_id = $1 ORDER BY sort_order', [parseInt(id)]).catch(() => []);
  const extras = await query('SELECT * FROM quote_extras WHERE quote_id = $1 ORDER BY sort_order', [parseInt(id)]).catch(() => []);

  // Auto photo request SMS — seulement pour les balcons (besoin d'évaluation visuelle)
  if (body.statut === 'envoye' && rows[0]?.client_tel) {
    const fieldsToCheck = ['notes', 'client_adresse', 'description_travaux', 'type_service'];
    const isBalcon = fieldsToCheck.some(f => ((rows[0][f] as string) ?? '').toLowerCase().includes('balcon'));
    if (isBalcon) {
      const prenom = ((rows[0].client_nom as string) ?? '').split(' ')[0];
      const greeting = prenom ? `Bonjour ${prenom}!` : 'Bonjour!';
      const photoMsg = `${greeting} Pour finaliser votre soumission de balcon Novus Époxy #${id}, pourriez-vous nous envoyer quelques photos de votre balcon (vue d'ensemble + zones abîmées)? Répondez à ce texto avec vos photos. Merci! 📸`;
      sendSMS(rows[0].client_tel as string, photoMsg).catch(() => {});
    }
  }

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
