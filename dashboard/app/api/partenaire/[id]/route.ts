import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSubcontractorFromSession } from '@/lib/partner-session';

/**
 * Vérifie que le contrat `quoteId` est bien un contrat de sous-traitance
 * APPARTENANT au partenaire `partnerId`. Retourne la ligne du contrat ou null.
 * C'est le garde-fou central: aucune route ne sert un contrat d'un autre partenaire.
 */
async function getOwnedContract(quoteId: number, partnerId: number) {
  const rows = await query(
    `SELECT
       q.id, q.client_nom, q.client_adresse, q.client_tel,
       q.type_service, q.notes, q.statut, q.created_at,
       b.jour1_date, b.jour1_slot, b.jour2_date, b.jour2_slot
     FROM quotes q
     LEFT JOIN bookings b ON b.quote_id = q.id AND b.statut != 'annule'
     WHERE q.id = $1
       AND q.is_subcontract = TRUE
       AND q.partner_id = $2
     LIMIT 1`,
    [quoteId, partnerId],
  );
  return rows[0] ?? null;
}

/**
 * GET /api/partenaire/[id] — détail d'UN chantier du sous-traitant connecté.
 *
 * ISOLATION STRICTE:
 *   - 403 si pas un sous-traitant.
 *   - 404 si le contrat n'appartient pas à SON partner_id (vérifié par getOwnedContract).
 *   - Ne retourne JAMAIS contract_price / profit / revenu.
 *   - Inclut: infos de base, dates, photos avant/après, et SES factures.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sub = await getSubcontractorFromSession();
  if (!sub) {
    return NextResponse.json({ error: 'Accès réservé aux sous-traitants' }, { status: 403 });
  }

  const { id } = await params;
  const quoteId = parseInt(id, 10);
  if (!Number.isFinite(quoteId)) {
    return NextResponse.json({ error: 'id invalide' }, { status: 400 });
  }

  const contract = await getOwnedContract(quoteId, sub.partnerId);
  if (!contract) {
    return NextResponse.json({ error: 'Chantier introuvable' }, { status: 404 });
  }

  const photos = await query(
    `SELECT id, type, url, filename, created_at
       FROM job_photos
      WHERE quote_id = $1
      ORDER BY type ASC, created_at ASC`,
    [quoteId],
  );

  // Uniquement les factures DE CE partenaire pour CE chantier.
  const invoices = await query(
    `SELECT id, description, heures, taux_horaire, montant, fichier_url, fichier_nom, statut, created_at
       FROM partner_invoices
      WHERE quote_id = $1 AND partner_id = $2
      ORDER BY created_at DESC`,
    [quoteId, sub.partnerId],
  );

  return NextResponse.json({
    contract: {
      id: contract.id,
      client_nom: contract.client_nom,
      client_adresse: contract.client_adresse,
      client_tel: contract.client_tel,
      type_service: contract.type_service,
      notes: contract.notes,
      statut: contract.statut,
      created_at: contract.created_at,
      jour1_date: contract.jour1_date,
      jour1_slot: contract.jour1_slot,
      jour2_date: contract.jour2_date,
      jour2_slot: contract.jour2_slot,
    },
    photos,
    invoices,
  });
}

/**
 * POST /api/partenaire/[id] — le sous-traitant dépose une facture (heures) pour CE chantier.
 * Vérifie l'appartenance avant tout insert. N'écrit que dans partner_invoices (table isolée).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sub = await getSubcontractorFromSession();
  if (!sub) {
    return NextResponse.json({ error: 'Accès réservé aux sous-traitants' }, { status: 403 });
  }

  const { id } = await params;
  const quoteId = parseInt(id, 10);
  if (!Number.isFinite(quoteId)) {
    return NextResponse.json({ error: 'id invalide' }, { status: 400 });
  }

  const contract = await getOwnedContract(quoteId, sub.partnerId);
  if (!contract) {
    return NextResponse.json({ error: 'Chantier introuvable' }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Corps invalide' }, { status: 400 });

  const num = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const heures = num(body.heures);
  const tauxHoraire = num(body.taux_horaire);
  let montant = num(body.montant);

  // Si montant non fourni mais heures + taux le sont, on le calcule.
  if (montant == null && heures != null && tauxHoraire != null) {
    montant = heures * tauxHoraire;
  }
  if (montant == null || montant <= 0) {
    return NextResponse.json({ error: 'montant (ou heures × taux) requis' }, { status: 400 });
  }

  const description = typeof body.description === 'string' ? body.description.slice(0, 2000) : null;
  const fichierUrl = typeof body.fichier_url === 'string' ? body.fichier_url.slice(0, 1000) : null;
  const fichierNom = typeof body.fichier_nom === 'string' ? body.fichier_nom.slice(0, 255) : null;

  const rows = await query(
    `INSERT INTO partner_invoices
       (quote_id, partner_id, description, heures, taux_horaire, montant, fichier_url, fichier_nom)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, description, heures, taux_horaire, montant, fichier_url, fichier_nom, statut, created_at`,
    [quoteId, sub.partnerId, description, heures, tauxHoraire, montant, fichierUrl, fichierNom],
  );

  return NextResponse.json(rows[0], { status: 201 });
}
