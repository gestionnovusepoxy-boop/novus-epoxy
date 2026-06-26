/**
 * lib/ad-brain.ts — Cerveau publicitaire (analyse PROFONDE quotidienne).
 *
 * Va au-delà du CPL: relie chaque source/service au REVENU SIGNÉ réel
 * (lead → devis → contrat signé → $). Trouve ce qui VEND, pas juste ce qui clique.
 * Lecture seule. Utilisé par le cron ad-brain → recommandation LLM sur Telegram.
 */
import { query } from '@/lib/db';
import { callLLM } from '@/lib/llm';

export interface ServicePerf { service: string; contrats: number; revenu: number }
export interface SourcePerf { source: string; leads: number; avecDevis: number; revenuSigne: number }
export interface AdBrainData {
  bySource: SourcePerf[];
  byService: ServicePerf[];
  dealMoyen: number;
  tauxSignature: number; // %
  metaSpend30d: number | null;
  metaLeads30d: number | null;
}

/** Tire l'analyse profonde du funnel (90j) + dépense Meta (30j). */
export async function gatherAdBrainData(metaToken?: string, adAccountId?: string): Promise<AdBrainData> {
  const bySourceRows = await query(
    `SELECT source,
       COUNT(*)::int AS leads,
       COUNT(*) FILTER (WHERE EXISTS(SELECT 1 FROM quotes q WHERE q.client_tel = c.telephone))::int AS avec_devis,
       COALESCE(SUM((SELECT SUM(total) FROM quotes q
          WHERE q.client_tel = c.telephone
            AND q.statut IN ('depot_paye','planifie','complete')
            AND q.is_subcontract IS NOT TRUE)), 0)::numeric AS revenu_signe
     FROM crm_leads c
     WHERE created_at > NOW() - INTERVAL '90 days'
     GROUP BY source ORDER BY revenu_signe DESC NULLS LAST LIMIT 10`,
  ).catch(() => []);

  // Revenu par service = contrats signes (quotes) UNION ventes manuelles (hors-systeme).
  // Luca: beaucoup de ventes ne sont pas dans le systeme — on les inclut pour ne pas
  // sous-estimer ce qui VEND vraiment (ex: FLAKE).
  const byServiceRows = await query(
    `SELECT service AS type_service, SUM(n)::int AS n, SUM(revenu)::numeric AS revenu FROM (
       SELECT type_service AS service, COUNT(*)::int AS n, COALESCE(SUM(total), 0)::numeric AS revenu
       FROM quotes
       WHERE statut IN ('depot_paye','planifie','complete') AND is_subcontract IS NOT TRUE
         AND created_at > NOW() - INTERVAL '180 days'
       GROUP BY type_service
       UNION ALL
       SELECT service, COUNT(*)::int AS n, COALESCE(SUM(montant), 0)::numeric AS revenu
       FROM manual_sales
       WHERE date_vente > CURRENT_DATE - INTERVAL '180 days'
       GROUP BY service
     ) u
     GROUP BY service ORDER BY revenu DESC LIMIT 8`,
  ).catch(() => []);

  // Ventes manuelles agregees par source (90j) — apparaissent comme sources qui signent.
  const manualBySourceRows = await query(
    `SELECT COALESCE(source, 'manuel') AS source,
       COUNT(*)::int AS leads,
       COALESCE(SUM(montant), 0)::numeric AS revenu_signe
     FROM manual_sales
     WHERE date_vente > CURRENT_DATE - INTERVAL '90 days'
     GROUP BY source`,
  ).catch(() => []);

  // Total ventes manuelles signees (90j) pour ajuster deal moyen / taux.
  const manualAggRows = await query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(montant), 0)::numeric AS revenu
     FROM manual_sales WHERE date_vente > CURRENT_DATE - INTERVAL '90 days'`,
  ).catch(() => [{ n: 0, revenu: 0 }]);

  const mRows = await query(
    `SELECT COALESCE(AVG(total),0)::numeric AS deal_moyen,
       COUNT(*) FILTER (WHERE statut IN ('depot_paye','planifie','complete'))::int AS signes,
       COUNT(*)::int AS total
     FROM quotes WHERE is_subcontract IS NOT TRUE AND created_at > NOW() - INTERVAL '90 days'`,
  ).catch(() => [{ deal_moyen: 0, signes: 0, total: 0 }]);

  let metaSpend30d: number | null = null;
  let metaLeads30d: number | null = null;
  if (metaToken && adAccountId) {
    try {
      const r = await fetch(`https://graph.facebook.com/v25.0/act_${adAccountId}/insights?fields=spend,actions&date_preset=last_30d&access_token=${metaToken}`);
      const j = await r.json();
      const d = j.data?.[0];
      if (d) {
        metaSpend30d = Number(d.spend ?? 0);
        const lead = (d.actions ?? []).find((a: { action_type: string; value: string }) => /lead/i.test(a.action_type));
        metaLeads30d = lead ? Number(lead.value) : 0;
      }
    } catch { /* Meta indispo — on continue sans */ }
  }

  const m = mRows[0] as { deal_moyen: number; signes: number; total: number };
  const manualAgg = (manualAggRows[0] ?? { n: 0, revenu: 0 }) as { n: number; revenu: number };
  const manualN = Number(manualAgg.n);
  const manualRevenu = Number(manualAgg.revenu);

  // Fusionne les sources CRM (quotes) avec les sources des ventes manuelles (90j),
  // en additionnant le revenu signe quand la source est la meme.
  const sourceMap = new Map<string, SourcePerf>();
  for (const r of bySourceRows) {
    const key = String(r.source ?? '?');
    sourceMap.set(key, { source: key, leads: Number(r.leads), avecDevis: Number(r.avec_devis), revenuSigne: Number(r.revenu_signe) });
  }
  for (const r of manualBySourceRows) {
    const key = String(r.source ?? 'manuel');
    const cur = sourceMap.get(key) ?? { source: key, leads: 0, avecDevis: 0, revenuSigne: 0 };
    cur.leads += Number(r.leads);
    cur.avecDevis += Number(r.leads); // une vente manuelle = un deal signe
    cur.revenuSigne += Number(r.revenu_signe);
    sourceMap.set(key, cur);
  }
  const bySource = [...sourceMap.values()].sort((a, b) => b.revenuSigne - a.revenuSigne).slice(0, 10);

  // Deal moyen et taux ajustes pour inclure les ventes manuelles signees.
  const signesTotal = m.signes + manualN;
  const totalTotal = m.total + manualN;
  const revenuSignesQuotes = Number(m.deal_moyen) * m.signes;
  const dealMoyen = signesTotal > 0 ? (revenuSignesQuotes + manualRevenu) / signesTotal : Number(m.deal_moyen);

  return {
    bySource,
    byService: byServiceRows.map(r => ({ service: String(r.type_service ?? '?'), contrats: Number(r.n), revenu: Number(r.revenu) })),
    dealMoyen,
    tauxSignature: totalTotal > 0 ? Math.round((100 * signesTotal) / totalTotal) : 0,
    metaSpend30d,
    metaLeads30d,
  };
}

/** Recommandation quotidienne écrite par LLM, basée sur le revenu SIGNÉ réel. */
export async function buildDailyRecommendation(data: AdBrainData): Promise<string> {
  const topService = data.byService[0];
  const topSource = data.bySource.find(s => s.revenuSigne > 0);
  const facts = [
    `Deal moyen signé: ${Math.round(data.dealMoyen)}$ — taux de signature ${data.tauxSignature}%.`,
    `Services qui signent (180j): ${data.byService.map(s => `${s.service}=${Math.round(s.revenu)}$ (${s.contrats})`).join(', ')}.`,
    `Sources qui signent (90j): ${data.bySource.filter(s => s.revenuSigne > 0).map(s => `${s.source}=${Math.round(s.revenuSigne)}$`).join(', ') || 'aucune'}.`,
    data.metaSpend30d != null ? `Meta 30j: ${data.metaSpend30d}$ dépensé, ${data.metaLeads30d} leads trackés.` : '',
  ].filter(Boolean).join('\n');

  try {
    const reco = await callLLM({
      tier: 'top',
      maxTokens: 300,
      agent: 'ad-brain',
      system: `Tu es le stratège pub de Novus Epoxy (planchers époxy, Québec). Analyse les VRAIES données de vente ci-dessous et donne une recommandation COURTE et ACTIONNABLE pour les pubs Facebook d'aujourd'hui (3-5 puces max). Concentre-toi sur ce qui VEND (revenu signé), pas juste les clics. Recommande quel SERVICE pousser, quel budget/action, et quoi couper. Français québécois, direct, zéro jargon. Pas de bla-bla.`,
      messages: [{ role: 'user', content: facts }],
    });
    return reco || facts;
  } catch {
    const tip = topService ? `Pousse le ${topService.service} (ton plus gros vendeur: ${Math.round(topService.revenu)}$).` : '';
    return `${facts}\n\n→ ${tip}${topSource ? ` Source qui vend: ${topSource.source}.` : ''}`;
  }
}
