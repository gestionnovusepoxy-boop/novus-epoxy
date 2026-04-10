import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorise' }, { status: 401 });

  // Cron activity from kv_store
  const cronKeys = await query(`
    SELECT key, value, updated_at FROM kv_store
    WHERE key IN ('echo_last_run', 'echo_last_report', 'last_email_scan', 'last_gmail_watch', 'last_ghl_sync')
    ORDER BY key
  `).catch(() => []);

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
    crons: cronKeys,
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
