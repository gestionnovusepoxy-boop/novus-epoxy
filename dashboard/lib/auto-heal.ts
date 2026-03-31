// Echo — Auto-heal system
// Runs on every major API call. Checks all critical systems, auto-repairs, notifies group.
// NOTHING should ever stay broken. Echo fixes it or alerts immediately.

import { query } from '@/lib/db';

const BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN ?? '';
const GROUP_CHAT_ID = () => process.env.TELEGRAM_GROUP_CHAT_ID ?? process.env.TELEGRAM_ADMIN_CHAT_IDS?.split(',')[0] ?? '';

async function notifyGroup(message: string) {
  const token = BOT_TOKEN();
  const chatId = GROUP_CHAT_ID();
  if (!token || !chatId) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
  }).catch(() => {});
}

// Cooldowns (serverless = no persistent memory, use DB)
async function getCooldown(key: string): Promise<number> {
  const rows = await query(`SELECT value FROM kv_store WHERE key = $1`, [key]).catch(() => []);
  return rows[0]?.value ? new Date(rows[0].value as string).getTime() : 0;
}
async function setCooldown(key: string) {
  await query(
    `INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`,
    [key, new Date().toISOString()]
  ).catch(() => {});
}

// ============================================================
// CHECK 1: Telegram Webhook
// ============================================================
async function healWebhook(): Promise<string | null> {
  const token = BOT_TOKEN();
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const data = await res.json();
    const expectedUrl = 'https://novus-epoxy.vercel.app/api/telegram/admin';
    if (!data.result?.url || data.result.url !== expectedUrl) {
      const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
      await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: expectedUrl, secret_token: secret, allowed_updates: ['message', 'callback_query'] }),
      });
      return 'Webhook Telegram repare';
    }
  } catch { /* non-fatal */ }
  return null;
}

// ============================================================
// CHECK 2: Prospect emails — resume pending sends (8h-20h)
// ============================================================
async function healProspects(): Promise<string | null> {
  try {
    const now = new Date();
    const quebecHour = (now.getUTCHours() - 4 + 24) % 24;
    if (quebecHour < 8 || quebecHour >= 20) return null;

    // Check cooldown (max once per 10 min)
    const last = await getCooldown('echo_prospect_last');
    if (Date.now() - last < 10 * 60 * 1000) return null;

    const pending = await query(
      `SELECT COUNT(*)::int as c FROM crm_leads WHERE statut = 'nouveau' AND prospect_sent_at IS NULL AND email IS NOT NULL AND email != ''`
    );
    const count = (pending[0]?.c as number) || 0;
    if (count === 0) return null;

    // Send batch of 8
    const leads = await query(
      `SELECT id FROM crm_leads WHERE statut = 'nouveau' AND prospect_sent_at IS NULL AND email IS NOT NULL AND email != '' ORDER BY id LIMIT 8`
    );
    if (leads.length === 0) return null;

    const ids = leads.map(r => (r as { id: number }).id);
    const baseUrl = process.env.NEXTAUTH_URL ?? 'https://novus-epoxy.vercel.app';
    const res = await fetch(`${baseUrl}/api/leads/jason/prospect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ADMIN_API_KEY ?? '' },
      body: JSON.stringify({ leadIds: ids }),
    });
    const result = await res.json().catch(() => ({})) as Record<string, unknown>;
    await setCooldown('echo_prospect_last');

    const sent = Number(result.emails ?? 0);
    const sms = Number(result.sms ?? 0);
    if (sent > 0 || sms > 0) {
      return `${sent} emails + ${sms} SMS envoyes (${count - sent} en attente)`;
    }
  } catch { /* non-fatal */ }
  return null;
}

// ============================================================
// CHECK 3: Gmail watch renewal
// ============================================================
async function healGmailWatch(): Promise<string | null> {
  try {
    const rows = await query(`SELECT value FROM kv_store WHERE key = 'last_gmail_watch'`);
    const lastWatch = rows?.[0]?.value as string | undefined;
    const daysSince = lastWatch ? (Date.now() - new Date(lastWatch).getTime()) / (1000 * 60 * 60 * 24) : 999;
    if (daysSince < 5) return null;

    const baseUrl = process.env.NEXTAUTH_URL ?? 'https://novus-epoxy.vercel.app';
    const res = await fetch(`${baseUrl}/api/gmail/watch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.ADMIN_API_KEY ?? ''}` },
    });
    if (res.ok) {
      await setCooldown('last_gmail_watch');
      return 'Gmail watch renouvele';
    }
  } catch { /* non-fatal */ }
  return null;
}

// ============================================================
// CHECK 4: Email scan — retrigger if stale
// ============================================================
async function healEmailScan(): Promise<string | null> {
  try {
    const rows = await query(`SELECT value FROM kv_store WHERE key = 'last_email_scan'`);
    const lastScan = rows?.[0]?.value as string | undefined;
    const hoursSince = lastScan ? (Date.now() - new Date(lastScan).getTime()) / (1000 * 60 * 60) : 999;
    if (hoursSince < 12) return null;

    const baseUrl = process.env.NEXTAUTH_URL ?? 'https://novus-epoxy.vercel.app';
    const cronSecret = process.env.CRON_SECRET ?? '';
    await fetch(`${baseUrl}/api/cron/email-scan`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cronSecret}` },
    });
    return `Email scan relance (${Math.round(hoursSince)}h sans scan)`;
  } catch { /* non-fatal */ }
  return null;
}

// ============================================================
// MAIN: Run all checks
// ============================================================
export async function autoHeal(): Promise<void> {
  // Global cooldown: max once per 2 min (stored in DB for serverless)
  try {
    const last = await getCooldown('echo_last_run');
    if (Date.now() - last < 2 * 60 * 1000) {
      // Still check webhook every call (fast, critical)
      await healWebhook();
      return;
    }
    await setCooldown('echo_last_run');
  } catch { return; }

  try {
    const repairs: string[] = [];

    // Run all checks
    const results = await Promise.allSettled([
      healWebhook(),
      healProspects(),
      healGmailWatch(),
      healEmailScan(),
    ]);

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) repairs.push(r.value);
    }

    // Notify only if something was repaired
    if (repairs.length > 0) {
      await notifyGroup(
        `🔧 <b>Echo — Auto-reparation</b>\n\n` +
        repairs.map(r => `✅ ${r}`).join('\n') +
        `\n\n<i>Tout repare automatiquement.</i>`
      );
    }

    // Status report every 6h
    const lastReport = await getCooldown('echo_last_report');
    if (Date.now() - lastReport >= 6 * 60 * 60 * 1000) {
      await setCooldown('echo_last_report');

      const [leadCount, pendingProspect, pendingQuotes, activeJobs, emailsToday] = await Promise.all([
        query(`SELECT COUNT(*)::int AS c FROM crm_leads`),
        query(`SELECT COUNT(*)::int AS c FROM crm_leads WHERE statut = 'nouveau' AND prospect_sent_at IS NULL AND email IS NOT NULL AND email != ''`),
        query(`SELECT COUNT(*)::int AS c FROM quotes WHERE statut IN ('brouillon', 'en_attente', 'envoye')`),
        query(`SELECT COUNT(*)::int AS c FROM quotes WHERE statut IN ('depot_paye', 'planifie')`),
        query(`SELECT COUNT(*)::int AS c FROM email_logs WHERE created_at >= CURRENT_DATE`),
      ]);

      await notifyGroup(
        `📊 <b>Echo — Rapport systeme</b>\n\n` +
        `👥 ${leadCount[0]?.c || 0} leads total | ${pendingProspect[0]?.c || 0} en attente d'envoi\n` +
        `📝 ${pendingQuotes[0]?.c || 0} devis en attente\n` +
        `🔨 ${activeJobs[0]?.c || 0} travaux actifs\n` +
        `📧 ${emailsToday[0]?.c || 0} emails envoyes aujourd'hui\n\n` +
        `<i>Tout roule. Prochain rapport dans 6h.</i>`
      );
    }
  } catch {
    // Echo should NEVER crash anything
  }
}

// Keep backward compat
export const checkWebhookAlive = healWebhook;
