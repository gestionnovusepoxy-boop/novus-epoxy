import { query } from '@/lib/db';

/**
 * ROAS / Rendement par source de lead (lecture seule).
 *
 * Pour chaque valeur de crm_leads.source, on calcule :
 *  - leads     : nombre de leads
 *  - devis     : nombre de devis créés reliés au lead (par lead_id OU par email)
 *  - signes    : nombre de devis signés (statut IN depot_paye/planifie/complete)
 *  - revenu    : SUM(total) des devis signés
 *  - taux lead→devis, devis→signé, lead→signé
 *  - revenu / lead
 *  - depense (CAD) : dépense pub Meta — uniquement attribuable aux sources Facebook
 *  - roas      : revenu / dépense (si dépense connue)
 *  - cpl       : coût par lead (dépense / leads) si dépense connue
 *
 * Les devis sont reliés à un lead par lead_id en priorité, sinon par email
 * (LOWER(quotes.client_email) = LOWER(crm_leads.email)). On ne compte chaque
 * devis qu'une seule fois par source.
 */

const SIGNED_STATUSES = ['depot_paye', 'planifie', 'complete'] as const;

// Sources considérées comme du trafic publicitaire Facebook/Meta.
// La dépense Meta totale leur est attribuée (au prorata des leads entre ces sources).
const META_SOURCES = ['facebook-leadad', 'facebook-zapier', 'facebook'] as const;

export interface RoasRow {
  source: string;
  leads: number;
  devis: number;
  signes: number;
  revenu: number;
  taux_lead_devis: number;   // % leads ayant au moins un devis (devis/leads)
  taux_devis_signe: number;  // % devis signés (signes/devis)
  taux_lead_signe: number;   // % leads convertis en contrat (signes/leads)
  revenu_par_lead: number;
  depense_cad: number | null;
  roas: number | null;       // revenu / dépense
  cpl_cad: number | null;    // dépense / leads
}

export interface RoasTotals {
  leads: number;
  devis: number;
  signes: number;
  revenu: number;
  depense_cad: number;
  roas: number | null;
  taux_lead_signe: number;
}

export interface RoasReport {
  rows: RoasRow[];
  totals: RoasTotals;
  meta_spend_total_cad: number;
  generated_at: string;
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '0'));
  return Number.isFinite(n) ? n : 0;
}

function pct(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10; // 1 décimale
}

/**
 * Calcule le rapport ROAS par source.
 * @param sinceDays  Optionnel : ne compter que les leads créés dans les N derniers jours.
 */
export async function getRoasReport(sinceDays?: number): Promise<RoasReport> {
  const params: unknown[] = [];
  let leadWhere = '';
  if (sinceDays && sinceDays > 0) {
    params.push(`${sinceDays} days`);
    leadWhere = `WHERE l.created_at >= NOW() - $${params.length}::interval`;
  }

  // statut signé en paramètres
  const signedParams = SIGNED_STATUSES.map((_, i) => `$${params.length + i + 1}`).join(',');
  params.push(...SIGNED_STATUSES);

  // Un devis est relié au lead par lead_id, sinon par email.
  // DISTINCT q.id pour ne pas double-compter un devis relié par 2 voies.
  const sql = `
    WITH lead_quote AS (
      SELECT
        l.source AS source,
        l.id     AS lead_id,
        q.id     AS quote_id,
        q.statut AS quote_statut,
        q.total  AS quote_total
      FROM crm_leads l
      LEFT JOIN quotes q
        ON (q.lead_id = l.id)
        OR (q.lead_id IS NULL
            AND q.client_email IS NOT NULL AND q.client_email <> ''
            AND l.email IS NOT NULL AND l.email <> ''
            AND LOWER(q.client_email) = LOWER(l.email))
      ${leadWhere}
    ),
    per_lead AS (
      SELECT source, lead_id,
             COUNT(DISTINCT quote_id) AS devis,
             COUNT(DISTINCT quote_id) FILTER (WHERE quote_statut IN (${signedParams})) AS signes,
             COALESCE(SUM(DISTINCT_total), 0) AS revenu
      FROM (
        SELECT source, lead_id, quote_id, quote_statut,
               CASE WHEN quote_statut IN (${signedParams}) THEN quote_total ELSE 0 END AS DISTINCT_total
        FROM lead_quote
      ) x
      GROUP BY source, lead_id
    )
    SELECT
      source,
      COUNT(DISTINCT lead_id)::int        AS leads,
      COALESCE(SUM(devis), 0)::int        AS devis,
      COALESCE(SUM(signes), 0)::int       AS signes,
      COALESCE(SUM(revenu), 0)::numeric   AS revenu
    FROM per_lead
    GROUP BY source
    ORDER BY revenu DESC, leads DESC
  `;

  const [rowsRaw, spendRows] = await Promise.all([
    query(sql, params),
    query(`SELECT COALESCE(SUM(spend_cad), 0)::numeric AS total_cad FROM meta_ads_spend`),
  ]);

  const metaSpendTotal = num(spendRows[0]?.total_cad);

  // Total des leads issus des sources Meta (pour répartir la dépense au prorata).
  const metaLeadTotal = rowsRaw
    .filter((r) => (META_SOURCES as readonly string[]).includes(String(r.source)))
    .reduce((acc, r) => acc + num(r.leads), 0);

  const rows: RoasRow[] = rowsRaw.map((r) => {
    const source = String(r.source ?? '—');
    const leads = num(r.leads);
    const devis = num(r.devis);
    const signes = num(r.signes);
    const revenu = num(r.revenu);

    let depense: number | null = null;
    if ((META_SOURCES as readonly string[]).includes(source) && metaLeadTotal > 0) {
      depense = Math.round((metaSpendTotal * (leads / metaLeadTotal)) * 100) / 100;
    }

    const roas = depense && depense > 0 ? Math.round((revenu / depense) * 100) / 100 : null;
    const cpl = depense && depense > 0 && leads > 0 ? Math.round((depense / leads) * 100) / 100 : null;

    return {
      source,
      leads,
      devis,
      signes,
      revenu,
      taux_lead_devis: pct(devis, leads),
      taux_devis_signe: pct(signes, devis),
      taux_lead_signe: pct(signes, leads),
      revenu_par_lead: leads > 0 ? Math.round((revenu / leads) * 100) / 100 : 0,
      depense_cad: depense,
      roas,
      cpl_cad: cpl,
    };
  });

  const tLeads = rows.reduce((a, r) => a + r.leads, 0);
  const tDevis = rows.reduce((a, r) => a + r.devis, 0);
  const tSignes = rows.reduce((a, r) => a + r.signes, 0);
  const tRevenu = rows.reduce((a, r) => a + r.revenu, 0);
  const tDepense = rows.reduce((a, r) => a + (r.depense_cad ?? 0), 0);

  const totals: RoasTotals = {
    leads: tLeads,
    devis: tDevis,
    signes: tSignes,
    revenu: tRevenu,
    depense_cad: tDepense,
    roas: tDepense > 0 ? Math.round((tRevenu / tDepense) * 100) / 100 : null,
    taux_lead_signe: pct(tSignes, tLeads),
  };

  return {
    rows,
    totals,
    meta_spend_total_cad: metaSpendTotal,
    generated_at: new Date().toISOString(),
  };
}
