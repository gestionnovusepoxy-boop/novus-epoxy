import { query } from '@/lib/db';

/**
 * Source de verite pour la promotion active.
 * Avant: "Rabais Mai 15%" etait code en dur dans 5+ endroits — perimait
 * silencieusement le 1er du mois suivant. Maintenant: une seule requete SQL
 * sur la table `promotions` (migration-023), avec cache 5 minutes.
 *
 * UI/agents/emails doivent appeler getActivePromo() et n'afficher la promo
 * que si `active === true`. Aucun fallback hard-coded.
 */
export interface ActivePromo {
  active: boolean;
  label: string;
  pct: number;
  ends_at: Date | null;
  services: string[]; // [] = applicable a tous les services
}

const NO_PROMO: ActivePromo = {
  active: false,
  label: '',
  pct: 0,
  ends_at: null,
  services: [],
};

const CACHE_TTL_MS = 5 * 60 * 1000;
let cached: { value: ActivePromo; expires: number } | null = null;

interface PromoRow {
  nom: string;
  rabais_pct: number;
  date_fin: string | Date | null;
  services: string[] | null;
}

export async function getActivePromo(): Promise<ActivePromo> {
  if (cached && cached.expires > Date.now()) return cached.value;

  try {
    const rows = (await query(
      `SELECT nom, rabais_pct, date_fin, services
       FROM promotions
       WHERE date_debut <= NOW()
         AND date_fin >= NOW()
         AND COALESCE(actif, true) = true
       ORDER BY rabais_pct DESC
       LIMIT 1`
    )) as unknown as PromoRow[];

    const value: ActivePromo = rows[0]
      ? {
          active: true,
          label: rows[0].nom,
          pct: Number(rows[0].rabais_pct),
          ends_at: rows[0].date_fin ? new Date(rows[0].date_fin as string) : null,
          services: rows[0].services ?? [],
        }
      : NO_PROMO;

    cached = { value, expires: Date.now() + CACHE_TTL_MS };
    return value;
  } catch {
    // Schema manquant, DB down — pas de promo plutot qu'une erreur d'affichage.
    return NO_PROMO;
  }
}

/**
 * Format texte court pour insertion dans prompts/emails/SMS.
 * Renvoie "" si pas de promo active (a coller tel quel sans verifier).
 */
export function formatPromoText(p: ActivePromo): string {
  if (!p.active) return '';
  const end = p.ends_at
    ? p.ends_at.toLocaleDateString('fr-CA', { day: 'numeric', month: 'long' })
    : null;
  return end
    ? `${p.label} — ${p.pct}% de rabais (jusqu'au ${end})`
    : `${p.label} — ${p.pct}% de rabais`;
}

/**
 * Reinitialise le cache. A utiliser dans les tests, ou apres ecriture
 * sur la table `promotions` depuis l'admin.
 */
export function clearPromoCache(): void {
  cached = null;
}
