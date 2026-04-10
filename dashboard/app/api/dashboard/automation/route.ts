import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

// All 20 crons from vercel.json with human-readable labels and schedules
// Heures affichees en heure du Quebec (EDT = UTC-4, EST = UTC-5)
// En avril (EDT): UTC-4, donc 13 UTC = 9h Quebec
const VERCEL_CRONS = [
  { path: '/api/gmail/watch',             label: 'Gmail Watch renewal',            schedule: '0 6 * * *',    desc: 'Tous les jours 2h (nuit)' },
  { path: '/api/cron/recurring-expenses', label: 'Depenses recurrentes',           schedule: '0 10 * * *',   desc: 'Tous les jours 6h' },
  { path: '/api/cron/email-scan',         label: 'Scan emails entrants',           schedule: '0 8 * * *',    desc: 'Tous les jours 4h (nuit)' },
  { path: '/api/cron/morning-summary',    label: 'Resume du matin (Telegram)',     schedule: '0 8 * * *',    desc: 'Tous les jours 4h (nuit)' },
  { path: '/api/cron/aria-prospect',      label: 'Aria prospection email',         schedule: '0 9 * * *',    desc: 'Tous les jours 5h + cron-job.org aux 10 min' },
  { path: '/api/cron/deposit-watch',      label: 'Surveillance depots',            schedule: '0 9 * * *',    desc: 'Tous les jours 5h' },
  { path: '/api/cron/relance-facture',    label: 'Relance factures impayees',      schedule: '0 11 * * *',   desc: 'Tous les jours 7h' },
  { path: '/api/cron/rappels',            label: 'Rappels rendez-vous',            schedule: '0 12 * * *',   desc: 'Tous les jours 8h' },
  { path: '/api/cron/health-check',       label: 'Health check (Echo)',            schedule: '0 12 * * *',   desc: 'Tous les jours 8h + cron-job.org aux 15 min' },
  { path: '/api/cron/sync-submissions',   label: 'Sync soumissions CRM',          schedule: '30 12 * * *',  desc: 'Tous les jours 8h30' },
  { path: '/api/cron/relance',            label: 'Relance devis (48h + 5j)',       schedule: '0 13 * * *',   desc: 'Tous les jours 9h' },
  { path: '/api/cron/lead-followup',      label: 'Relance leads (Claude IA)',      schedule: '0 13 * * *',   desc: 'Tous les jours 9h' },
  { path: '/api/cron/iris-report',        label: 'Rapport Iris (finances)',        schedule: '0 13 * * *',   desc: 'Tous les jours 9h' },
  { path: '/api/cron/depot',              label: 'Rappel depot contrat',           schedule: '0 14 * * *',   desc: 'Tous les jours 10h' },
  { path: '/api/cron/relance-prospect',   label: 'Relance prospects (48h + 5j)',   schedule: '0 14 * * *',   desc: 'Tous les jours 10h' },
  { path: '/api/cron/prospect-followup',  label: 'Suivi prospects (desactive)',    schedule: '0 14 * * *',   desc: 'Fusionne dans relance-prospect' },
  { path: '/api/cron/avis',               label: 'Demande avis Google',            schedule: '0 15 * * *',   desc: 'Tous les jours 11h' },
  { path: '/api/cron/nurture-leads',      label: 'Nurture leads tiedes (5 etapes)',schedule: '0 15 * * *',   desc: 'Tous les jours 11h' },
  { path: '/api/cron/referral',           label: 'Programme referral (6 mois)',    schedule: '0 16 * * 1',   desc: 'Lundi 12h' },
  { path: '/api/cron/reviews',            label: 'Rappel avis Google (admin)',     schedule: '0 10 * * 1',   desc: 'Lundi 6h' },
];

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorise' }, { status: 401 });

  // All crons from vercel.json — they run automatically on Vercel's scheduler
  const crons = VERCEL_CRONS.map(c => ({
    path: c.path,
    label: c.label,
    schedule: c.desc,
    status: 'actif' as const,
  }));

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
