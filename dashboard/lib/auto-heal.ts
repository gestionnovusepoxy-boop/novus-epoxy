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

// CHECK 2: Prospect emails — Aria s'en occupe via le cron morning-summary
// Echo ne touche PAS aux leads/emails. Il verifie juste que le systeme tourne.

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
    // Don't try to fix email scan if Google token is broken — needs manual re-auth
    // Auto-clear the flag after 24h to allow retry (token may have been refreshed)
    const tokenBroken = await query(`SELECT value, updated_at FROM kv_store WHERE key = 'google_token_broken'`).catch(() => []);
    if (tokenBroken.length > 0 && tokenBroken[0]?.value === 'true') {
      const brokenAge = tokenBroken[0]?.updated_at
        ? (Date.now() - new Date(tokenBroken[0].updated_at as string).getTime()) / 3600000
        : 999;
      if (brokenAge < 24) return null; // Still within cooldown
      // Clear the flag and retry
      await query(`DELETE FROM kv_store WHERE key = 'google_token_broken'`).catch(() => {});
    }

    const rows = await query(`SELECT value FROM kv_store WHERE key = 'last_email_scan'`);
    const lastScan = rows?.[0]?.value as string | undefined;
    const hoursSince = lastScan ? (Date.now() - new Date(lastScan).getTime()) / (1000 * 60 * 60) : 999;
    if (hoursSince < 12) return null;

    const baseUrl = process.env.NEXTAUTH_URL ?? 'https://novus-epoxy.vercel.app';
    const cronSecret = process.env.CRON_SECRET ?? '';
    const res = await fetch(`${baseUrl}/api/cron/email-scan`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cronSecret}` },
    });

    // If email scan returns 500 (likely invalid_grant), mark token as broken
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (body.includes('invalid_grant')) {
        await query(
          `INSERT INTO kv_store (key, value, updated_at) VALUES ('google_token_broken', 'true', NOW()) ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = NOW()`
        ).catch(() => {});
        return 'Google OAuth expire — email scan desactive. Faut re-connecter Gmail.';
      }
    }

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

    // Full system health report every 6h
    const lastReport = await getCooldown('echo_last_report');
    if (Date.now() - lastReport >= 6 * 60 * 60 * 1000) {
      await setCooldown('echo_last_report');

      const checks: string[] = [];
      const issues: string[] = [];

      // 1. Database health
      try {
        await query(`SELECT 1`);
        checks.push('✅ Base de donnees OK');
      } catch { issues.push('❌ Base de donnees DOWN'); }

      // 2. Twilio SMS
      const twilioOk = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);
      checks.push(twilioOk ? '✅ Twilio SMS configure' : '⚠️ Twilio non configure');

      // 3. Gmail API
      const gmailOk = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_REFRESH_TOKEN);
      checks.push(gmailOk ? '✅ Gmail API configure' : '⚠️ Gmail non configure');

      // 4. Telegram bot
      try {
        const tRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN()}/getMe`);
        checks.push(tRes.ok ? '✅ Telegram bot actif' : '❌ Telegram bot erreur');
        if (!tRes.ok) issues.push('Telegram bot ne repond pas');
      } catch { issues.push('❌ Telegram bot injoignable'); }

      // 5. GHL/Champfields sync
      const ghlOk = !!process.env.GHL_API_KEY;
      checks.push(ghlOk ? '✅ GHL sync configure' : '⚠️ GHL non configure');

      // 6. Vercel Blob (photos)
      const blobOk = !!process.env.BLOB_READ_WRITE_TOKEN;
      checks.push(blobOk ? '✅ Vercel Blob (photos) OK' : '⚠️ Blob non configure');

      // 7. Claude AI
      const aiOk = !!process.env.ANTHROPIC_API_KEY;
      checks.push(aiOk ? '✅ Claude AI configure' : '⚠️ IA non configuree');

      // 8. Business metrics
      const [leadCount, pendingProspect, pendingQuotes, activeJobs, emailsToday, smsToday, recentErrors] = await Promise.all([
        query(`SELECT COUNT(*)::int AS c FROM crm_leads`),
        query(`SELECT COUNT(*)::int AS c FROM crm_leads WHERE statut = 'nouveau' AND prospect_sent_at IS NULL AND email IS NOT NULL AND email != ''`),
        query(`SELECT COUNT(*)::int AS c FROM quotes WHERE statut IN ('brouillon', 'en_attente', 'envoye')`),
        query(`SELECT COUNT(*)::int AS c FROM quotes WHERE statut IN ('depot_paye', 'planifie')`),
        query(`SELECT COUNT(*)::int AS c FROM email_logs WHERE created_at >= CURRENT_DATE`),
        query(`SELECT COUNT(*)::int AS c FROM sms_logs WHERE created_at >= CURRENT_DATE`).catch(() => [{ c: 0 }]),
        query(`SELECT COUNT(*)::int AS c FROM email_logs WHERE statut = 'error' AND created_at >= CURRENT_DATE - INTERVAL '1 day'`).catch(() => [{ c: 0 }]),
      ]);

      // 9. Check cron health — last Aria run
      const lastAria = await query(`SELECT value FROM kv_store WHERE key = 'aria_last_run'`).catch(() => []);
      const ariaAge = lastAria[0]?.value ? Math.round((Date.now() - new Date(lastAria[0].value as string).getTime()) / 3600000) : -1;
      if (ariaAge >= 0 && ariaAge <= 24) {
        checks.push(`✅ Aria actif (dernier run: ${ariaAge}h)`);
      } else if (ariaAge > 24) {
        issues.push(`⚠️ Aria inactif depuis ${ariaAge}h`);
      }

      // 10. Revenue check
      const revenue = await query(`SELECT COALESCE(SUM(CASE WHEN depot_paye THEN depot_montant ELSE 0 END) + SUM(CASE WHEN final_paye THEN final_montant ELSE 0 END), 0)::numeric AS total FROM invoices`);

      const errorCount = Number(recentErrors[0]?.c || 0);
      if (errorCount > 0) issues.push(`⚠️ ${errorCount} erreur(s) email dans les 24h`);

      const status = issues.length === 0 ? '🟢 Tout fonctionne a 100%' : `🟡 ${issues.length} point(s) a verifier`;

      await notifyGroup(
        `📊 <b>Echo — Rapport systeme complet</b>\n\n` +
        `<b>${status}</b>\n\n` +
        `<b>Infrastructure:</b>\n${checks.join('\n')}\n` +
        (issues.length > 0 ? `\n<b>Problemes:</b>\n${issues.join('\n')}\n` : '') +
        `\n<b>Business:</b>\n` +
        `👥 ${leadCount[0]?.c || 0} leads | ${pendingProspect[0]?.c || 0} en attente Aria\n` +
        `📝 ${pendingQuotes[0]?.c || 0} devis en attente\n` +
        `🔨 ${activeJobs[0]?.c || 0} travaux actifs\n` +
        `💰 ${Number(revenue[0]?.total || 0).toFixed(0)}$ encaisse total\n` +
        `📧 ${emailsToday[0]?.c || 0} emails | 📱 ${smsToday[0]?.c || 0} SMS aujourd'hui\n\n` +
        `<i>Prochain rapport dans 6h.</i>`
      );
    }
  } catch {
    // Echo should NEVER crash anything
  }
}

// Keep backward compat
export const checkWebhookAlive = healWebhook;
