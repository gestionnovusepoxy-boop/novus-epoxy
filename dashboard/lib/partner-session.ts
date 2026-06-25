/**
 * Partner session — identification d'un sous-traitant à partir de la session NextAuth.
 *
 * Le portail /partenaire est ISOLÉ du dashboard admin Novus. Un sous-traitant se
 * connecte avec le même mécanisme NextAuth, mais on l'identifie en faisant
 * correspondre son email de session avec `partners.email` (partenaire actif).
 *
 * GARDE-FOU: ce module ne retourne JAMAIS de données financières. Il sert
 * uniquement à résoudre `partner_id` pour filtrer strictement les contrats.
 */

import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

/** Identité minimale d'un sous-traitant — aucune donnée financière. */
export interface Subcontractor {
  partnerId: number;
  nom: string;
  email: string;
}

/**
 * Retourne le sous-traitant correspondant à la session courante, ou `null` si
 * l'utilisateur connecté n'est pas un partenaire actif (ou pas connecté).
 *
 * Matching: session.user.email (insensible à la casse) === partners.email,
 * uniquement parmi les partenaires `actif = TRUE`.
 */
export async function getSubcontractorFromSession(): Promise<Subcontractor | null> {
  const session = await auth();
  const email = session?.user?.email?.toLowerCase().trim();
  if (!email) return null;

  const rows = await query(
    `SELECT id, nom, email
       FROM partners
      WHERE actif = TRUE
        AND email IS NOT NULL
        AND LOWER(email) = $1
      LIMIT 1`,
    [email],
  );

  if (rows.length === 0) return null;

  return {
    partnerId: rows[0].id as number,
    nom: rows[0].nom as string,
    email: rows[0].email as string,
  };
}
