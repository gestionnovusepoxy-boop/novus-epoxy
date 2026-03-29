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

// Cooldown: don't check more than once every 5 minutes
let lastCheckTime = 0;

export async function autoHeal(): Promise<void> {
  const now = Date.now();
  if (now - lastCheckTime < 5 * 60 * 1000) return; // 5 min cooldown
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
        `🔧 <b>Aria — Auto-reparation</b>\n\n` +
        repairs.map(r => `✅ ${r}`).join('\n') +
        `\n\n<i>Systeme repare automatiquement. Aucune action requise.</i>`
      );
    }
  } catch {
    // Auto-heal itself should never crash anything
  }
}
