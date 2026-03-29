// Auto-heal system — runs on every major API call
// Checks critical systems and auto-repairs without waiting for daily cron
// Notifies Telegram GROUP when something is fixed

import { query } from '@/lib/db';

const BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN ?? '';
const GROUP_CHAT_ID = () => process.env.TELEGRAM_GROUP_CHAT_ID ?? '';
const ADMIN_CHAT_IDS = () =>
  (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

async function notifyRepair(message: string) {
  const token = BOT_TOKEN();
  if (!token) return;

  // Notify group if configured, otherwise admins
  const chatIds = GROUP_CHAT_ID() ? [GROUP_CHAT_ID()] : ADMIN_CHAT_IDS();
  for (const chatId of chatIds) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' }),
    }).catch(() => {});
  }
}

// Cooldown: don't check more than once every 2 minutes
let lastCheckTime = 0;
// Webhook check has its own faster cooldown (30s) — must stay alive
let lastWebhookCheck = 0;

export async function checkWebhookAlive(): Promise<void> {
  const now = Date.now();
  if (now - lastWebhookCheck < 30 * 1000) return; // 30s cooldown
  lastWebhookCheck = now;
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
    if (!token) return;
    const whRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const whData = await whRes.json();
    const expectedUrl = 'https://novus-epoxy.vercel.app/api/telegram/admin';
    const currentUrl = whData.result?.url ?? '';
    if (currentUrl !== expectedUrl) {
      const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
      await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: expectedUrl, secret_token: secret, allowed_updates: ['message', 'callback_query'] }),
      });
      await notifyRepair(`🔧 <b>Echo:</b> Webhook Telegram repare automatiquement. Tout est OK.`);
    }
  } catch { /* non-fatal */ }
}

export async function autoHeal(): Promise<void> {
  const now = Date.now();
  // Always check webhook first (fast, 30s cooldown)
  await checkWebhookAlive();
  if (now - lastCheckTime < 2 * 60 * 1000) return; // 2 min cooldown
  lastCheckTime = now;

  try {
    const repairs: string[] = [];

    // 1. Gmail watch — renew if > 5 days old
    try {
      const rows = await query(`SELECT value FROM kv_store WHERE key = 'last_gmail_watch'`);
      const lastWatch = rows?.[0]?.value as string | undefined;
      const daysSince = lastWatch ? (now - new Date(lastWatch).getTime()) / (1000 * 60 * 60 * 24) : 999;
      if (daysSince >= 5) {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://novus-epoxy.vercel.app';
        const adminKey = process.env.ADMIN_API_KEY ?? '';
        const res = await fetch(`${baseUrl}/api/gmail/watch`, { method: 'POST', headers: { Authorization: `Bearer ${adminKey}` } });
        if (res.ok) {
          await query(`INSERT INTO kv_store (key, value) VALUES ('last_gmail_watch', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [new Date().toISOString()]);
          repairs.push('Gmail watch renouvele (etait expire)');
        }
      }
    } catch { /* non-fatal */ }

    // 2. Telegram webhook — verify and re-register if broken
    try {
      const token = BOT_TOKEN();
      if (token) {
        const whRes = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
        const whData = await whRes.json();
        const expectedUrl = 'https://novus-epoxy.vercel.app/api/telegram/admin';
        const hasError = whData.result?.last_error_message;
        const wrongUrl = whData.result?.url !== expectedUrl;

        if (hasError || wrongUrl) {
          const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? '';
          await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: expectedUrl, secret_token: secret }),
          });
          repairs.push('Telegram webhook repare' + (hasError ? ` (erreur: ${hasError})` : ' (mauvaise URL)'));
        }
      }
    } catch { /* non-fatal */ }

    // 3. Check DB is alive (already working if we got here via query above)

    // 4. Check last email scan — if > 12h ago, trigger one
    try {
      const rows = await query(`SELECT value FROM kv_store WHERE key = 'last_email_scan'`);
      const lastScan = rows?.[0]?.value as string | undefined;
      const hoursSince = lastScan ? (now - new Date(lastScan).getTime()) / (1000 * 60 * 60) : 999;
      if (hoursSince >= 12) {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://novus-epoxy.vercel.app';
        const cronSecret = process.env.CRON_SECRET ?? '';
        await fetch(`${baseUrl}/api/cron/email-scan`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${cronSecret}` },
        });
        repairs.push(`Email scan relance (dernier scan il y a ${Math.round(hoursSince)}h)`);
      }
    } catch { /* non-fatal */ }

    // Notify if any repairs were made
    if (repairs.length > 0) {
      await notifyRepair(
        `🔧 <b>Echo — Auto-reparation</b>\n\n` +
        repairs.map(r => `✅ ${r}`).join('\n') +
        `\n\n<i>Systeme repare automatiquement. Aucune action requise.</i>`
      );
    }

    // Periodic status report — every 6 hours in the group
    try {
      const lastReportRows = await query(`SELECT value FROM kv_store WHERE key = 'last_echo_report'`);
      const lastReport = lastReportRows?.[0]?.value as string | undefined;
      const hoursSinceReport = lastReport ? (now - new Date(lastReport).getTime()) / (1000 * 60 * 60) : 999;

      if (hoursSinceReport >= 6) {
        // Gather system stats
        const [gmailRows, telegramCheck, leadCount, todayLeads, pendingQuotes, activeJobs, emailsSent] = await Promise.all([
          query(`SELECT value FROM kv_store WHERE key = 'last_email_scan'`),
          (async () => { try { const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN()}/getWebhookInfo`); return (await r.json()).result; } catch { return null; } })(),
          query(`SELECT COUNT(*)::int AS c FROM crm_leads`),
          query(`SELECT COUNT(*)::int AS c FROM crm_leads WHERE created_at >= CURRENT_DATE`),
          query(`SELECT COUNT(*)::int AS c FROM quotes WHERE statut IN ('brouillon', 'en_attente', 'envoye')`),
          query(`SELECT COUNT(*)::int AS c FROM quotes WHERE statut IN ('depot_paye', 'planifie')`),
          query(`SELECT COUNT(*)::int AS c FROM email_logs WHERE created_at >= CURRENT_DATE`),
        ]);

        const lastScanAgo = gmailRows[0]?.value ? Math.round((now - new Date(gmailRows[0].value as string).getTime()) / 60000) : -1;
        const telegramOk = telegramCheck && !telegramCheck.last_error_message;

        const statusEmoji = (ok: boolean) => ok ? '✅' : '❌';

        await notifyRepair(
          `📊 <b>Echo — Rapport systeme</b>\n\n` +
          `${statusEmoji(lastScanAgo >= 0 && lastScanAgo < 720)} Gmail scan: ${lastScanAgo >= 0 ? `il y a ${lastScanAgo} min` : 'jamais'}\n` +
          `${statusEmoji(!!telegramOk)} Telegram webhook: ${telegramOk ? 'OK' : 'ERREUR'}\n` +
          `${statusEmoji(true)} Base de donnees: OK\n\n` +
          `📈 <b>Activite aujourd'hui</b>\n` +
          `👥 ${todayLeads[0]?.c || 0} nouveaux leads (${leadCount[0]?.c || 0} total)\n` +
          `📝 ${pendingQuotes[0]?.c || 0} devis en attente\n` +
          `🔨 ${activeJobs[0]?.c || 0} travaux actifs\n` +
          `📧 ${emailsSent[0]?.c || 0} emails envoyes\n\n` +
          `<i>Prochain rapport dans 6h. Tout roule 24/7.</i>`
        );

        await query(
          `INSERT INTO kv_store (key, value) VALUES ('last_echo_report', $1) ON CONFLICT (key) DO UPDATE SET value = $1`,
          [new Date().toISOString()]
        );
      }
    } catch { /* report failed — non-fatal */ }
  } catch {
    // Auto-heal itself should never crash anything
  }
}
