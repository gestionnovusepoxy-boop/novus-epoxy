import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session) return new NextResponse('Non autorisé', { status: 401 });

  const [
    hunterStats,
    ariaStats,
    rexStats,
    irisStats,
    zaraStats,
    novaStats,
    marcelHistory,
  ] = await Promise.all([
    query(`SELECT
      COUNT(*) FILTER (WHERE temperature = 'chaud') as chauds,
      COUNT(*) FILTER (WHERE temperature = 'tiede') as tièdes,
      COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) as nouveaux
      FROM crm_leads WHERE statut NOT IN ('ferme','froid','perdu')`),
    query(`SELECT COUNT(*) as emails_today FROM email_logs WHERE created_at::date = CURRENT_DATE`),
    query(`SELECT
      COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) as devis_today,
      COUNT(*) FILTER (WHERE statut IN ('brouillon','en_attente')) as en_attente
      FROM quotes`),
    query(`SELECT
      COALESCE(SUM(total),0) FILTER (WHERE statut IN ('contrat_signe','depot_paye','planifie','complete')) as confirmes,
      COALESCE(SUM(total),0) FILTER (WHERE statut = 'envoye') as pipeline,
      COUNT(*) FILTER (WHERE statut IN ('en_attente','approuve','envoye')) as actifs
      FROM quotes`),
    query(`SELECT
      COUNT(*) FILTER (WHERE jour1_date >= CURRENT_DATE) as a_venir,
      COUNT(*) FILTER (WHERE statut = 'confirme' AND created_at::date = CURRENT_DATE) as confirmees_today
      FROM bookings`),
    query(`SELECT
      COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) as today,
      COUNT(*) FILTER (WHERE status = 'pending_approval') as en_attente,
      COUNT(*) FILTER (WHERE quote_id IS NOT NULL AND created_at::date = CURRENT_DATE) as devis_today
      FROM conversations`),
    query(`SELECT value FROM kv_store WHERE key = 'marcel_history_shared'`),
  ]);

  const h = hunterStats[0] as Record<string, string | number>;
  const a = ariaStats[0] as Record<string, string | number>;
  const r = rexStats[0] as Record<string, string | number>;
  const i = irisStats[0] as Record<string, string | number>;
  const z = zaraStats[0] as Record<string, string | number>;
  const n = novaStats[0] as Record<string, string | number>;

  let marcelMsgCount = 0;
  try {
    const raw = marcelHistory[0]?.value as string;
    if (raw) marcelMsgCount = (JSON.parse(raw) as unknown[]).length;
  } catch { /* noop */ }

  const envVars = [
    'ANTHROPIC_API_KEY','DATABASE_URL','TELEGRAM_BOT_TOKEN',
    'TWILIO_ACCOUNT_SID','GOOGLE_CLIENT_ID','RESEND_API_KEY','STRIPE_SECRET_KEY',
  ];
  const envOk = envVars.filter(v => !!process.env[v]).length;

  // Format money helper
  const fmt = (val: string | number) => {
    const num = Number(val ?? 0);
    return num >= 1000 ? `${(num / 1000).toFixed(1)}k$` : `${num.toFixed(0)}$`;
  };

  return NextResponse.json({
    marcel:  { messages: marcelMsgCount, label: `${marcelMsgCount} msgs en mémoire` },
    hunter:  { chauds: Number(h.chauds ?? 0), tièdes: Number(h['tièdes'] ?? 0), nouveaux: Number(h.nouveaux ?? 0) },
    aria:    { emails_today: Number(a.emails_today ?? 0) },
    rex:     { devis_today: Number(r.devis_today ?? 0), en_attente: Number(r.en_attente ?? 0) },
    iris:    { confirmes: fmt(i.confirmes), pipeline: fmt(i.pipeline), actifs: Number(i.actifs ?? 0) },
    sage:    { posts: 0 },
    zara:    { a_venir: Number(z.a_venir ?? 0), confirmees_today: Number(z.confirmees_today ?? 0) },
    bolt:    { notifications: 0 },
    echo:    { env_ok: envOk, env_total: envVars.length },
    nova:    { today: Number(n.today ?? 0), en_attente: Number(n.en_attente ?? 0), devis_today: Number(n.devis_today ?? 0) },
  });
}
