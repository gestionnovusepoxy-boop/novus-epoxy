/**
 * Subcontract — calcul de profit pour un contrat de sous-traitance.
 *
 * Un contrat = un PROJET dans la table `quotes` avec is_subcontract=true.
 * Il réutilise l'infra existante : expenses + time_entries liés à quote_id.
 *
 * Modèle de profit (un contrat) :
 *   revenu       = contract_price
 *   couts        = SUM(expenses.montant_ttc) + SUM(time_entries.heures * employees.taux_horaire)
 *   profit       = revenu - couts
 *   part_luca    = profit * profit_split_pct / 100
 *   part_partner = profit * (100 - profit_split_pct) / 100
 */

import { query } from '@/lib/db';

/** Breakdown complet d'un contrat de sous-traitance (tous en dollars). */
export interface ProfitBreakdown {
  revenue: number;
  costs: number;
  profit: number;
  lucaShare: number;
  partnerShare: number;
}

/** Entrées de la fonction pure de calcul de profit. */
export interface ComputeProfitInput {
  contractPrice: number | null | undefined;
  costs: number | null | undefined;
  splitPct: number | null | undefined;
}

/** Coerce une valeur potentiellement nulle/NaN vers un nombre fini sûr. */
function num(value: unknown, fallback = 0): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Fonction pure : calcule le breakdown de profit à partir de valeurs déjà connues.
 * Aucun accès DB. Gère les nulls (contract_price null → revenue 0, split null → 50%).
 */
export function computeProfit({
  contractPrice,
  costs,
  splitPct,
}: ComputeProfitInput): ProfitBreakdown {
  const revenue = num(contractPrice, 0);
  const totalCosts = num(costs, 0);
  const pct = num(splitPct, 50);
  const profit = revenue - totalCosts;
  const lucaShare = (profit * pct) / 100;
  const partnerShare = (profit * (100 - pct)) / 100;
  return {
    revenue,
    costs: totalCosts,
    profit,
    lucaShare,
    partnerShare,
  };
}

/**
 * Lit contract_price + profit_split_pct depuis `quotes`, calcule les couts via
 * expenses + time_entries × taux_horaire, et retourne le breakdown complet.
 *
 * Retourne un breakdown à zéro si le devis n'existe pas.
 */
export async function getSubcontractProfit(quoteId: number): Promise<ProfitBreakdown> {
  const quoteRows = await query(
    'SELECT contract_price, profit_split_pct FROM quotes WHERE id = $1',
    [quoteId],
  );

  if (quoteRows.length === 0) {
    return computeProfit({ contractPrice: 0, costs: 0, splitPct: 50 });
  }

  const contractPrice = num(quoteRows[0].contract_price, 0);
  const splitPct = num(quoteRows[0].profit_split_pct, 50);

  const costRows = await query(
    `SELECT
       COALESCE((SELECT SUM(montant_ttc) FROM expenses WHERE quote_id = $1), 0)
       + COALESCE((
           SELECT SUM(te.heures * e.taux_horaire)
           FROM time_entries te
           JOIN employees e ON e.id = te.employee_id
           WHERE te.quote_id = $1
         ), 0) AS costs`,
    [quoteId],
  );

  const costs = num(costRows[0]?.costs, 0);

  return computeProfit({ contractPrice, costs, splitPct });
}
