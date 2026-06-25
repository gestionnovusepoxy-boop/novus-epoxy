import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSubcontractorFromSession } from '@/lib/partner-session';

/**
 * GET /api/partenaire — liste les chantiers (contrats) du sous-traitant connecté.
 *
 * ISOLATION STRICTE:
 *   - 403 si l'utilisateur connecté n'est pas un sous-traitant (partenaire actif).
 *   - Filtré par SON partner_id uniquement (jamais les contrats d'un autre partenaire).
 *   - Ne retourne JAMAIS contract_price / profit / revenu ni aucune donnée financière
 *     de l'entreprise. Le sous-traitant ne voit que ses chantiers + dates.
 */
export async function GET() {
  const sub = await getSubcontractorFromSession();
  if (!sub) {
    return NextResponse.json({ error: 'Accès réservé aux sous-traitants' }, { status: 403 });
  }

  // SELECT volontairement limité: aucune colonne de prix/profit.
  // Les dates viennent du booking (jour1/jour2) lié au quote_id.
  const rows = await query(
    `SELECT
       q.id,
       q.client_nom,
       q.client_adresse,
       q.type_service,
       q.statut,
       q.created_at,
       b.jour1_date,
       b.jour2_date
     FROM quotes q
     LEFT JOIN bookings b ON b.quote_id = q.id AND b.statut != 'annule'
     WHERE q.is_subcontract = TRUE
       AND q.partner_id = $1
     ORDER BY q.created_at DESC`,
    [sub.partnerId],
  );

  return NextResponse.json({
    partenaire: { nom: sub.nom },
    data: rows.map(r => ({
      id: r.id,
      client_nom: r.client_nom,
      client_adresse: r.client_adresse,
      type_service: r.type_service,
      statut: r.statut,
      jour1_date: r.jour1_date,
      jour2_date: r.jour2_date,
      created_at: r.created_at,
    })),
  });
}
