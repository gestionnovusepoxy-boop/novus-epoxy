import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session) return new NextResponse('Non autorisé', { status: 401 });

  const [
    hunterStats,
    hunterCampaigns,
    ariaStats,
    ariaLastAction,
    rexStats,
    irisStats,
    zaraStats,
    novaStats,
    marcelHistory,
    sageStats,
    sageLastScan,
    jasonStats,
  ] = await Promise.all([
    // Hunter: leads par température + prospects envoyés
    query(`SELECT
      COUNT(*) FILTER (WHERE temperature = 'chaud') as chauds,
      COUNT(*) FILTER (WHERE temperature = 'tiede') as tiedes,
      COUNT(*) FILTER (WHERE temperature = 'froid') as froids,
      COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) as nouveaux,
      COUNT(*) as total
      FROM crm_leads WHERE statut NOT IN ('ferme','perdu')`),
    // Hunter: campagnes/prospects envoyés
    query(`SELECT
      COUNT(*) as total_campaigns,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as semaine,
      MAX(created_at) as last_action
      FROM lead_campaigns`),
    // Aria: emails envoyés + ouverts + cliqués
    query(`SELECT
      COUNT(*) as total_envoyes,
      COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) as emails_today,
      COUNT(*) FILTER (WHERE statut = 'opened' OR opened_at IS NOT NULL) as ouverts,
      COUNT(*) FILTER (WHERE statut = 'clicked' OR clicked_at IS NOT NULL) as cliques,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as semaine,
      MAX(created_at) as last_action
      FROM email_logs`),
    // Aria: dernière action + closer/import stats
    query(`SELECT
      (SELECT created_at FROM email_logs ORDER BY created_at DESC LIMIT 1) as last_email,
      (SELECT COUNT(*) FROM crm_leads WHERE created_at::date = CURRENT_DATE) as leads_importes_today,
      (SELECT COUNT(*) FROM crm_leads WHERE last_agent_reply_at IS NOT NULL AND last_agent_reply_at::date = CURRENT_DATE) as closer_today,
      (SELECT COUNT(*) FROM crm_leads WHERE prospect_relance_1_at IS NOT NULL AND prospect_relance_1_at >= NOW() - INTERVAL '7 days') as suivis_semaine,
      (SELECT COUNT(*) FROM crm_leads WHERE statut = 'interesse' AND updated_at >= NOW() - INTERVAL '7 days') as reponses_semaine,
      (SELECT COUNT(*) FROM crm_leads WHERE prospect_sent_at IS NOT NULL AND prospect_sent_at::date = CURRENT_DATE) as offres_today`),
    // Rex: devis en attente + envoyés
    query(`SELECT
      COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) as devis_today,
      COUNT(*) FILTER (WHERE statut IN ('brouillon','en_attente')) as en_attente,
      COUNT(*) FILTER (WHERE statut = 'envoye') as envoyes,
      COUNT(*) as total
      FROM quotes`),
    // Iris: finances
    query(`SELECT
      COALESCE(SUM(total),0) FILTER (WHERE statut IN ('contrat_signe','depot_paye','planifie','complete')) as confirmes,
      COALESCE(SUM(total),0) FILTER (WHERE statut = 'envoye') as pipeline,
      COUNT(*) FILTER (WHERE statut IN ('en_attente','approuve','envoye')) as actifs
      FROM quotes`),
    // Zara: bookings
    query(`SELECT
      COUNT(*) FILTER (WHERE jour1_date >= CURRENT_DATE) as a_venir,
      COUNT(*) FILTER (WHERE statut = 'confirme' AND created_at::date = CURRENT_DATE) as confirmees_today,
      COUNT(*) FILTER (WHERE statut = 'confirme') as total_confirmes,
      MIN(jour1_date) FILTER (WHERE jour1_date >= CURRENT_DATE AND statut = 'confirme') as prochain
      FROM bookings`),
    // Nova: conversations chatbot
    query(`SELECT
      COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) as today,
      COUNT(*) FILTER (WHERE status = 'pending_approval') as en_attente,
      COUNT(*) FILTER (WHERE quote_id IS NOT NULL AND created_at::date = CURRENT_DATE) as devis_today,
      COUNT(*) FILTER (WHERE quote_id IS NOT NULL) as total_devis,
      COUNT(*) as total_convos
      FROM conversations`),
    // Marcel: mémoire partagée
    query(`SELECT value FROM kv_store WHERE key = 'marcel_history_shared'`),
    // Sage: portfolio stats
    query(`SELECT
      COUNT(*) as total_items,
      COUNT(*) FILTER (WHERE array_length(photos, 1) > 0) as avec_photos,
      COUNT(*) FILTER (WHERE array_length(videos, 1) > 0) as avec_videos,
      COUNT(*) FILTER (WHERE featured = true) as featured,
      COALESCE(SUM(array_length(photos, 1)), 0) as total_photos,
      COALESCE(SUM(array_length(videos, 1)), 0) as total_videos
      FROM portfolio`),
    // Sage: dernier scan
    query(`SELECT created_at FROM portfolio ORDER BY created_at DESC LIMIT 1`),
    // Jason: leads de prospection
    query(`SELECT
      COUNT(*) as total_leads,
      COUNT(*) FILTER (WHERE temperature = 'chaud') as chauds,
      COUNT(*) FILTER (WHERE prospect_sent_at IS NOT NULL) as emails_envoyes,
      COUNT(*) FILTER (WHERE prospect_relance_1_at IS NOT NULL OR prospect_relance_2_at IS NOT NULL) as relances,
      COUNT(*) FILTER (WHERE statut IN ('interesse','qualification','negocie','gagne')) as convertis,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as leads_semaine
      FROM crm_leads WHERE source = 'jason'`),
  ]);

  const h = hunterStats[0] as Record<string, string | number>;
  const hc = hunterCampaigns[0] as Record<string, string | number>;
  const a = ariaStats[0] as Record<string, string | number>;
  const r = rexStats[0] as Record<string, string | number>;
  const i = irisStats[0] as Record<string, string | number>;
  const z = zaraStats[0] as Record<string, string | number>;
  const n = novaStats[0] as Record<string, string | number>;
  const sg = sageStats[0] as Record<string, string | number>;
  const js = jasonStats[0] as Record<string, string | number>;

  let marcelMsgCount = 0;
  try {
    const raw = marcelHistory[0]?.value as string;
    if (raw) marcelMsgCount = (JSON.parse(raw) as unknown[]).length;
  } catch { /* noop */ }

  // Format money helper
  const fmt = (val: string | number) => {
    const num = Number(val ?? 0);
    return num >= 1000 ? `${(num / 1000).toFixed(1)}k$` : `${num.toFixed(0)}$`;
  };

  // Time ago helper
  const timeAgo = (date: string | null | undefined): string | null => {
    if (!date) return null;
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `il y a ${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `il y a ${hrs}h`;
    const days = Math.floor(hrs / 24);
    return `il y a ${days}j`;
  };

  // Health checks for live status
  const ariaExtra = ariaLastAction[0] as Record<string, string | number>;
  const ariaLastDate = ariaExtra?.last_email as string | undefined;
  const hunterLastDate = hc.last_action as string | undefined;
  const sageLastDate = sageLastScan[0]?.created_at as string | undefined;

  const health: Record<string, 'green' | 'yellow' | 'red'> = {
    marcel: process.env.ANTHROPIC_API_KEY ? 'green' : 'red',
    hunter: process.env.ANTHROPIC_API_KEY ? 'green' : 'red',
    aria: process.env.GOOGLE_CLIENT_ID ? 'green' : 'red',
    rex: process.env.TWILIO_ACCOUNT_SID ? 'green' : 'red',
    iris: 'green',
    sage: process.env.GOOGLE_CLIENT_ID ? 'green' : 'red',
    zara: 'green',
    bolt: process.env.TELEGRAM_BOT_TOKEN ? 'green' : 'red',
    echo: 'green',
    nova: process.env.ANTHROPIC_API_KEY ? 'green' : 'red',
    jason: process.env.ANTHROPIC_API_KEY ? 'green' : 'red',
  };

  // Check staleness — if no activity in 7+ days, mark yellow
  const checkStale = (key: string, lastDate: string | undefined) => {
    if (!lastDate) return;
    const daysSince = (Date.now() - new Date(lastDate).getTime()) / 86400000;
    if (daysSince > 7 && health[key] === 'green') health[key] = 'yellow';
  };
  checkStale('aria', ariaLastDate);
  checkStale('hunter', hunterLastDate);
  checkStale('sage', sageLastDate);

  const envVars = [
    'ANTHROPIC_API_KEY','DATABASE_URL','TELEGRAM_BOT_TOKEN',
    'TWILIO_ACCOUNT_SID','GOOGLE_CLIENT_ID','STRIPE_SECRET_KEY',
  ];
  const envOk = envVars.filter(v => !!process.env[v]).length;
  const envMissing = envVars.filter(v => !process.env[v]);

  return NextResponse.json({
    marcel:  { messages: marcelMsgCount, label: `${marcelMsgCount} msgs en mémoire` },
    hunter:  {
      chauds: Number(h.chauds ?? 0),
      tiedes: Number(h.tiedes ?? 0),
      froids: Number(h.froids ?? 0),
      nouveaux: Number(h.nouveaux ?? 0),
      total_leads: Number(h.total ?? 0),
      prospects_envoyes: Number(hc.total_campaigns ?? 0),
      prospects_semaine: Number(hc.semaine ?? 0),
      last_action: timeAgo(hunterLastDate),
    },
    aria: {
      emails_today: Number(a.emails_today ?? 0),
      total_envoyes: Number(a.total_envoyes ?? 0),
      ouverts: Number(a.ouverts ?? 0),
      cliques: Number(a.cliques ?? 0),
      semaine: Number(a.semaine ?? 0),
      last_action: timeAgo(ariaLastDate),
      leads_importes_today: Number(ariaExtra?.leads_importes_today ?? 0),
      closer_today: Number(ariaExtra?.closer_today ?? 0),
      suivis_semaine: Number(ariaExtra?.suivis_semaine ?? 0),
      reponses_semaine: Number(ariaExtra?.reponses_semaine ?? 0),
      offres_today: Number(ariaExtra?.offres_today ?? 0),
    },
    rex: {
      devis_today: Number(r.devis_today ?? 0),
      en_attente: Number(r.en_attente ?? 0),
      envoyes: Number(r.envoyes ?? 0),
      total: Number(r.total ?? 0),
    },
    iris: {
      confirmes: fmt(i.confirmes),
      pipeline: fmt(i.pipeline),
      actifs: Number(i.actifs ?? 0),
    },
    sage: {
      total_photos: Number(sg.total_photos ?? 0),
      total_videos: Number(sg.total_videos ?? 0),
      featured: Number(sg.featured ?? 0),
      total_items: Number(sg.total_items ?? 0),
      last_scan: timeAgo(sageLastDate),
    },
    zara: {
      a_venir: Number(z.a_venir ?? 0),
      confirmees_today: Number(z.confirmees_today ?? 0),
      total_confirmes: Number(z.total_confirmes ?? 0),
      prochain: z.prochain ?? null,
    },
    bolt: { notifications: 0 },
    echo: {
      env_ok: envOk,
      env_total: envVars.length,
      env_missing: envMissing,
    },
    nova: {
      today: Number(n.today ?? 0),
      en_attente: Number(n.en_attente ?? 0),
      devis_today: Number(n.devis_today ?? 0),
      total_devis: Number(n.total_devis ?? 0),
      total_convos: Number(n.total_convos ?? 0),
    },
    jason: {
      total_leads: Number(js.total_leads ?? 0),
      chauds: Number(js.chauds ?? 0),
      emails_envoyes: Number(js.emails_envoyes ?? 0),
      relances: Number(js.relances ?? 0),
      convertis: Number(js.convertis ?? 0),
      leads_semaine: Number(js.leads_semaine ?? 0),
    },
    health,
  });
}
