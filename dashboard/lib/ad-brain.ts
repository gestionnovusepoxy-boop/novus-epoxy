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

  const byServiceRows = await query(
    `SELECT type_service, COUNT(*)::int AS n, COALESCE(SUM(total), 0)::numeric AS revenu
     FROM quotes
     WHERE statut IN ('depot_paye','planifie','complete') AND is_subcontract IS NOT TRUE
       AND created_at > NOW() - INTERVAL '180 days'
     GROUP BY type_service ORDER BY revenu DESC LIMIT 8`,
  ).catch(() => []);

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
  return {
    bySource: bySourceRows.map(r => ({ source: String(r.source ?? '?'), leads: Number(r.leads), avecDevis: Number(r.avec_devis), revenuSigne: Number(r.revenu_signe) })),
    byService: byServiceRows.map(r => ({ service: String(r.type_service ?? '?'), contrats: Number(r.n), revenu: Number(r.revenu) })),
    dealMoyen: Number(m.deal_moyen),
    tauxSignature: m.total > 0 ? Math.round((100 * m.signes) / m.total) : 0,
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
