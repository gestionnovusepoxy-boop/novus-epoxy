/**
 * Money — arithmétique en cents (entiers) pour zéro problème d'arrondi flottant.
 *
 * Convention :
 * - En interne, tout calcul se fait en CENTS (integers).
 * - L'interface (DB, API, UI) reste en DOLLARS (number) pour compat totale.
 * - Conversion aux frontières : dollarsToCents() à l'entrée, centsToDollars() à la sortie.
 *
 * ROUND_HALF_UP (standard fiscal Québec) appliqué via Math.round (qui fait round-half-up
 * pour les positifs, ce qui est notre seul cas — pas de montants négatifs).
 */

/** Convertit des dollars (ex: 8.50) en cents entiers (850). Robuste aux floats. */
export function dollarsToCents(dollars: number): number {
  return Math.round((dollars + Number.EPSILON) * 100);
}

/** Convertit des cents entiers (850) en dollars (8.50). */
export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

/** Additionne une liste de montants en cents. */
export function sumCents(...amounts: number[]): number {
  return amounts.reduce((s, a) => s + Math.round(a), 0);
}

/**
 * Multiplie un montant en cents par une quantité (peut être fractionnaire,
 * ex: superficie 2952.5 pi²). Retourne des cents arrondis.
 */
export function mulCents(cents: number, qty: number): number {
  return Math.round(cents * qty);
}

/**
 * Applique un pourcentage à un montant en cents. Retourne des cents arrondis.
 * Ex: pctOfCents(2509200, 15) = 376380 (15% de 25092.00$ = 3763.80$)
 */
export function pctOfCents(cents: number, pct: number): number {
  return Math.round(cents * (pct / 100));
}

/** Formatte un montant en CENTS en string CAD ($). */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(centsToDollars(cents));
}

export const TPS_RATE_PCT = 5;        // 5%
export const TVQ_RATE_PCT = 9.975;    // 9.975%
export const DEPOT_RATE_PCT = 30;     // 30%

/**
 * Calcule TPS + TVQ + total + dépôt à partir d'un sous-total taxable en cents.
 * Taxes calculées séparément sur le sous-total (norme Revenu Québec).
 */
export function taxesFromSubtotalCents(sousTotalCents: number) {
  const tpsCents = pctOfCents(sousTotalCents, TPS_RATE_PCT);
  const tvqCents = pctOfCents(sousTotalCents, TVQ_RATE_PCT);
  const totalCents = sumCents(sousTotalCents, tpsCents, tvqCents);
  const depotCents = pctOfCents(totalCents, DEPOT_RATE_PCT);
  return { tpsCents, tvqCents, totalCents, depotCents };
}
