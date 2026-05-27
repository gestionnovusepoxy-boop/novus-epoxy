import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-dynamic';

type VercelConfig = {
  crons?: { path: string; schedule: string }[];
};

type CronEntry = {
  path: string;
  schedule: string;
  label: string;
  status: 'actif' | 'manquant';
  missing?: boolean;
};

// Human-readable labels keyed by API path (no query string).
// If a cron is missing here, we fall back to the last path segment.
const CRON_LABELS: Record<string, string> = {
  '/api/gmail/watch':             'Gmail Watch renewal',
  '/api/gmail/cleanup':           'Gmail cleanup',
  '/api/cron/recurring-expenses': 'Depenses recurrentes',
  '/api/cron/email-scan':         'Scan emails entrants',
  '/api/cron/morning-summary':    'Resume matin/soir (Telegram)',
  '/api/cron/aria-prospect':      'Aria prospection email',
  '/api/cron/deposit-watch':      'Surveillance depots',
  '/api/cron/relance-facture':    'Relance factures impayees',
  '/api/cron/rappels':            'Rappels rendez-vous',
  '/api/cron/health-check':       'Health check (Echo)',
  '/api/cron/sync-submissions':   'Sync soumissions CRM',
  '/api/cron/relance':            'Relance devis (48h + 5j)',
  '/api/cron/lead-followup':      'Relance leads (Claude IA)',
  '/api/cron/iris-report':        'Rapport Iris (finances)',
  '/api/cron/depot':              'Rappel depot contrat',
  '/api/cron/relance-prospect':   'Relance prospects (48h + 5j)',
  '/api/cron/avis':               'Demande avis Google',
  '/api/cron/nurture-leads':      'Nurture leads tiedes (5 etapes)',
  '/api/cron/referral':           'Programme referral (6 mois)',
  '/api/cron/reviews':            'Rappel avis Google (admin)',
  '/api/cron/fb-leads-sync':      'Sync leads Facebook Ads',
  '/api/cron/soustraitants-paie': 'Paie sous-traitants (samedi)',
  '/api/cron/monthly-accounting': 'Comptabilite mensuelle',
  '/api/cron/worker-reminders':   'Rappels travailleurs',
  '/api/cron/meta-ads-spend':     'Suivi depenses Meta Ads',
  '/api/cron/ads-weekly':         'Rapport pubs hebdomadaire',
  '/api/crm/leads/sync-ghl':      'Sync GoHighLevel CRM',
};

function describeSchedule(schedule: string): string {
  // Simple human-readable hints — keep raw cron alongside for accuracy.
  return schedule;
}

function labelFor(p: string): string {
  const clean = p.split('?')[0];
  if (CRON_LABELS[clean]) return CRON_LABELS[clean];
  return clean.split('/').filter(Boolean).pop() ?? clean;
}

async function routeExists(apiPath: string): Promise<boolean> {
  // Strip query string, then map to filesystem (app/<path>/route.ts).
  const clean = apiPath.split('?')[0];
  const rel = clean.replace(/^\//, ''); // "api/cron/email-scan"
  const candidates = [
    path.join(process.cwd(), 'app', rel, 'route.ts'),
    path.join(process.cwd(), 'app', rel, 'route.tsx'),
    path.join(process.cwd(), 'app', rel, 'route.js'),
  ];
  for (const f of candidates) {
    try {
      await stat(f);
      return true;
    } catch {
      // continue
    }
  }
  return false;
}

async function loadVercelCrons(): Promise<{ path: string; schedule: string }[]> {
  // vercel.json sits at the project root (same dir as package.json on Vercel = cwd).
  const cfgPath = path.join(process.cwd(), 'vercel.json');
  try {
    const raw = await readFile(cfgPath, 'utf-8');
    const cfg = JSON.parse(raw) as VercelConfig;
    return Array.isArray(cfg.crons) ? cfg.crons : [];
  } catch {
    return [];
  }
}

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorise' }, { status: 401 });

  const vercelCrons = await loadVercelCrons();

  const crons: CronEntry[] = await Promise.all(
    vercelCrons.map(async (c) => {
      const exists = await routeExists(c.path);
      return {
        path: c.path,
        schedule: describeSchedule(c.schedule),
        label: labelFor(c.path),
        status: exists ? 'actif' : 'manquant',
        ...(exists ? {} : { missing: true }),
      } as CronEntry;
    })
  );

  const missingCrons = crons.filter((c) => c.missing).map((c) => c.path);

  // SMS stats today
  const smsToday = await query(`
    SELECT COUNT(*)::int as total,
           COUNT(CASE WHEN statut = 'sent' THEN 1 END)::int as sent,
           COUNT(CASE WHEN statut = 'failed' THEN 1 END)::int as failed
    FROM sms_logs WHERE created_at >= CURRENT_DATE
  `).catch(() => [{ total: 0, sent: 0, failed: 0 }]);

  // Email stats today
  const emailsToday = await query(`
    SELECT COUNT(*)::int as total,
           COUNT(CASE WHEN statut = 'delivered' THEN 1 END)::int as delivered,
           COUNT(CASE WHEN statut = 'opened' THEN 1 END)::int as opened,
           COUNT(CASE WHEN statut = 'bounced' THEN 1 END)::int as bounced
    FROM email_logs WHERE created_at >= CURRENT_DATE
  `).catch(() => [{ total: 0, delivered: 0, opened: 0, bounced: 0 }]);

  // Leads stats
  const leadsToday = await query(`SELECT COUNT(*)::int as cnt FROM crm_leads WHERE created_at >= CURRENT_DATE`).catch(() => [{ cnt: 0 }]);
  const leadsTotal = await query(`SELECT COUNT(*)::int as cnt FROM crm_leads`).catch(() => [{ cnt: 0 }]);
  const leadsProspected = await query(`SELECT COUNT(*)::int as cnt FROM crm_leads WHERE prospect_sent_at IS NOT NULL`).catch(() => [{ cnt: 0 }]);

  // Quotes pipeline
  const quotesPipeline = await query(`
    SELECT statut, COUNT(*)::int as cnt FROM quotes GROUP BY statut ORDER BY cnt DESC
  `).catch(() => []);

  // Active bookings
  const bookings = await query(`
    SELECT COUNT(*)::int as cnt FROM bookings WHERE statut IN ('en_attente', 'confirme') AND jour1_date >= CURRENT_DATE
  `).catch(() => [{ cnt: 0 }]);

  // Agent memories count
  const agentMemories = await query(`
    SELECT key, jsonb_array_length(value::jsonb) as cnt FROM kv_store
    WHERE key LIKE 'agent_memory_%'
  `).catch(() => []);

  // Recent submissions
  const submissions = await query(`SELECT COUNT(*)::int as cnt FROM submissions WHERE created_at >= CURRENT_DATE`).catch(() => [{ cnt: 0 }]);

  // Conversations active
  const conversations = await query(`SELECT COUNT(*)::int as cnt FROM conversations WHERE statut IN ('active', 'pending_approval')`).catch(() => [{ cnt: 0 }]);

  return NextResponse.json({
    crons,
    missingCrons,
    sms: smsToday[0] || { total: 0, sent: 0, failed: 0 },
    emails: emailsToday[0] || { total: 0, delivered: 0, opened: 0, bounced: 0 },
    leads: { today: leadsToday[0]?.cnt || 0, total: leadsTotal[0]?.cnt || 0, prospected: leadsProspected[0]?.cnt || 0 },
    quotes: quotesPipeline,
    bookings: bookings[0]?.cnt || 0,
    agentMemories,
    submissions: submissions[0]?.cnt || 0,
    conversations: conversations[0]?.cnt || 0,
  });
}
