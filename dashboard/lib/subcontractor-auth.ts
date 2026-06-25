/**
 * Subcontractor auth — couche d'authentification ISOLÉE pour les sous-traitants.
 *
 * MODÈLE DE SÉCURITÉ (lire avant de toucher) :
 *   - Un sous-traitant est un partenaire (table `partners`, colonne `id` = partnerId).
 *   - Un CONTRAT = un projet dans `quotes` avec is_subcontract=true ET partner_id = le sien.
 *   - RÈGLE D'OR : un sous-traitant ne doit JAMAIS voir autre chose que SES propres
 *     contrats (quotes.partner_id = son partnerId). Toute requête côté sous-traitant
 *     DOIT filtrer `WHERE partner_id = $1` avec le partnerId retourné ici — jamais une
 *     valeur fournie par le client. Le partnerId est dérivé du compte authentifié, pas
 *     d'un paramètre de requête.
 *
 *   - Les identifiants vivent dans l'env var SUBCONTRACTOR_USERS (jamais en DB, jamais
 *     commités). Format : "email:motdepasse:Nom:partnerId" séparés par des virgules.
 *     Exemple : "jj@ex.com:secret:JJ:3,bob@ex.com:pass:Bob:5"
 *   - Le mot de passe supporte un hash bcrypt ($2a$/$2b$) OU du texte clair comparé
 *     en temps constant (timingSafeEqual) pour éviter les attaques par timing —
 *     même approche que lib/auth.ts.
 *
 * Cette couche est volontairement séparée de lib/auth.ts (les admins) : un sous-traitant
 * n'est PAS un admin et ne partage aucune des permissions admin.
 */

import { compareSync } from 'bcryptjs';
import { timingSafeEqual } from 'crypto';

/** Un sous-traitant authentifié. */
export interface Subcontractor {
  nom: string;
  partnerId: number;
}

/** Entrée du parseur d'env (interne). */
interface SubcontractorRecord {
  email: string;
  password: string;
  nom: string;
  partnerId: number;
}

/**
 * Comparaison de mot de passe : bcrypt ($2a$/$2b$) sinon comparaison texte clair
 * en temps constant. Identique à lib/auth.ts.
 */
function checkPassword(input: string, stored: string): boolean {
  if (stored.startsWith('$2a$') || stored.startsWith('$2b$')) {
    return compareSync(input, stored);
  }
  const a = Buffer.from(input);
  const b = Buffer.from(stored);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Parse SUBCONTRACTOR_USERS.
 * Format : "email:motdepasse:Nom:partnerId" (virgules pour plusieurs).
 * Les entrées invalides (champs manquants, partnerId non numérique) sont ignorées.
 *
 * Note : le mot de passe ne doit pas contenir de `:`. On split en 4 morceaux et on
 * suppose que partnerId est le dernier ; le nom est l'avant-dernier ; le reste est
 * email/password.
 */
function parseSubcontractors(): SubcontractorRecord[] {
  const raw = process.env.SUBCONTRACTOR_USERS ?? '';
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry): SubcontractorRecord | null => {
      const parts = entry.split(':');
      if (parts.length < 4) return null;
      const [email, password, nom, partnerIdRaw] = parts;
      const normEmail = email?.toLowerCase().trim();
      const partnerId = Number.parseInt(partnerIdRaw?.trim() ?? '', 10);
      if (!normEmail || !password || !nom || !Number.isInteger(partnerId)) {
        return null;
      }
      return { email: normEmail, password, nom: nom.trim(), partnerId };
    })
    .filter((r): r is SubcontractorRecord => r !== null);
}

/**
 * Vérifie les identifiants d'un sous-traitant.
 * @returns {nom, partnerId} si valide, sinon null.
 *
 * SÉCURITÉ : retourne null pour email inconnu OU mauvais mot de passe (pas de fuite
 * d'information sur l'existence du compte). La comparaison du mot de passe est en
 * temps constant.
 */
export function checkSubcontractor(
  email: string | null | undefined,
  password: string | null | undefined,
): Subcontractor | null {
  const normEmail = email?.toLowerCase().trim();
  if (!normEmail || !password) return null;

  const records = parseSubcontractors();
  const match = records.find(
    (r) => r.email === normEmail && checkPassword(password, r.password),
  );
  if (!match) return null;

  return { nom: match.nom, partnerId: match.partnerId };
}

/** Forme minimale d'une session : on n'a besoin que de l'email de l'utilisateur. */
type SessionLike = { user?: { email?: string | null } | null } | null | undefined;

/**
 * Dérive le partnerId à partir d'une session (par l'email).
 * @returns {partnerId} si l'email de session correspond à un sous-traitant configuré,
 *          sinon null.
 *
 * SÉCURITÉ : le partnerId provient EXCLUSIVEMENT de la config serveur
 * (SUBCONTRACTOR_USERS), jamais d'un champ contrôlé par le client. Utiliser ce
 * partnerId pour filtrer toutes les lectures (`WHERE partner_id = $1`).
 */
export function getSubcontractorFromSession(
  session: SessionLike,
): { partnerId: number } | null {
  const email = session?.user?.email?.toLowerCase().trim();
  if (!email) return null;

  const records = parseSubcontractors();
  const match = records.find((r) => r.email === email);
  if (!match) return null;

  return { partnerId: match.partnerId };
}
