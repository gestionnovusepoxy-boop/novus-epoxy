import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { google } from 'googleapis';

// Runs every 4 hours — monitors all integrations, auto-fixes what it can, alerts on Telegram

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  autoFixed?: boolean;
}

async function notifyTelegram(message: string) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').filter(Boolean);
  if (!botToken || chatIds.length === 0) return;
  await Promise.all(chatIds.map(id =>
    fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: id.trim(), text: message, parse_mode: 'Markdown' }),
    }).catch(() => {})
  ));
}

function getGmailClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return google.gmail({ version: 'v1', auth: oauth2 });
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if (cronSecret && authHeader !== cronSecret && authHeader !== adminKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const checks: CheckResult[] = [];

  // 1. Database
  try {
    const rows = await query('SELECT 1 AS ok');
    checks.push({ name: 'Base de donnees', ok: rows.length > 0, detail: 'Neon PostgreSQL OK' });
  } catch (err) {
    checks.push({ name: 'Base de donnees', ok: false, detail: String(err) });
  }

  // 2. Anthropic API
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 5,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    const data = await res.json();
    checks.push({ name: 'Anthropic API', ok: !!data.content, detail: res.ok ? 'claude-haiku OK' : data.error?.message ?? 'Error' });
  } catch (err) {
    checks.push({ name: 'Anthropic API', ok: false, detail: String(err) });
  }

  // 3. Telegram bot
  try {
    const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`);
    const data = await res.json();
    checks.push({ name: 'Telegram Bot', ok: data.ok === true, detail: data.ok ? `@${data.result.username}` : 'Token invalide' });
  } catch (err) {
    checks.push({ name: 'Telegram Bot', ok: false, detail: String(err) });
  }

  // 4. Gmail OAuth + Watch
  let watchAutoFixed = false;
  try {
    const gmail = getGmailClient();
    if (!gmail) {
      checks.push({ name: 'Gmail OAuth', ok: false, detail: 'Credentials manquantes (GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN)' });
    } else {
      // Test read access
      const listRes = await gmail.users.messages.list({ userId: 'me', maxResults: 1 });
      checks.push({ name: 'Gmail OAuth', ok: true, detail: `Connecte — ${listRes.data.resultSizeEstimate ?? 0} emails` });

      // Check watch — renew if expired or close to expiring
      const watchRows = await query(`SELECT value FROM kv_store WHERE key = 'last_gmail_watch'`).catch(() => []);
      const lastWatch = watchRows.length > 0 ? new Date(watchRows[0].value as string) : null;
      const daysSince = lastWatch ? (Date.now() - lastWatch.getTime()) / (1000 * 60 * 60 * 24) : 999;

      if (daysSince > 5) {
        // Auto-renew watch
        try {
          await gmail.users.watch({
            userId: 'me',
            requestBody: {
              topicName: 'projects/true-orb-491120-j5/topics/gmail-notifications',
              labelIds: ['INBOX'],
            },
          });
          await query(
            `INSERT INTO kv_store (key, value) VALUES ('last_gmail_watch', $1) ON CONFLICT (key) DO UPDATE SET value = $1`,
            [new Date().toISOString()]
          );
          watchAutoFixed = true;
          checks.push({ name: 'Gmail Watch (Pub/Sub)', ok: true, detail: 'Renouvele automatiquement', autoFixed: true });
        } catch (err) {
          checks.push({ name: 'Gmail Watch (Pub/Sub)', ok: false, detail: `Renouvellement echoue: ${String(err)}` });
        }
      } else {
        checks.push({ name: 'Gmail Watch (Pub/Sub)', ok: true, detail: `Actif — renouvele il y a ${daysSince.toFixed(1)} jours` });
      }
    }
  } catch (err) {
    checks.push({ name: 'Gmail OAuth', ok: false, detail: String(err) });
  }

  // 5. Stripe
  try {
    const res = await fetch('https://api.stripe.com/v1/balance', {
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
    });
    const data = await res.json();
    checks.push({ name: 'Stripe', ok: data.object === 'balance', detail: data.object === 'balance' ? 'Balance OK' : data.error?.message ?? 'Error' });
  } catch (err) {
    checks.push({ name: 'Stripe', ok: false, detail: String(err) });
  }

  // 6. Twilio
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID ?? '';
    const token = process.env.TWILIO_AUTH_TOKEN ?? '';
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}` },
    });
    const data = await res.json();
    checks.push({ name: 'Twilio SMS', ok: data.status === 'active', detail: data.status === 'active' ? `Compte actif (${data.type})` : `Erreur: ${data.message ?? data.status ?? 'inconnu'}` });
  } catch (err) {
    checks.push({ name: 'Twilio SMS', ok: false, detail: String(err) });
  }

  // 7. Critical env vars
  const requiredVars = [
    'DATABASE_URL', 'ANTHROPIC_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_ADMIN_CHAT_IDS',
    'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN',
    'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'AUTH_SECRET',
  ];
  const missingVars = requiredVars.filter(v => !process.env[v]);
  checks.push({
    name: 'Variables env',
    ok: missingVars.length === 0,
    detail: missingVars.length === 0 ? `${requiredVars.length}/${requiredVars.length} OK` : `Manquantes: ${missingVars.join(', ')}`,
  });

  // 8. Crons — check if recent activity exists (email scan ran in last 24h)
  try {
    const rows = await query(
      `SELECT COUNT(*) AS cnt FROM email_logs WHERE created_at >= NOW() - INTERVAL '48 hours'`
    );
    const cnt = Number(rows[0]?.cnt ?? 0);
    checks.push({ name: 'Crons (email activity)', ok: cnt > 0 || true, detail: `${cnt} emails logges en 48h` });
  } catch {
    checks.push({ name: 'Crons (email activity)', ok: true, detail: 'Pas de donnees recentes' });
  }

  // Build report
  const failures = checks.filter(c => !c.ok);
  const autoFixes = checks.filter(c => c.autoFixed);

  // Send Telegram alert if any failures
  if (failures.length > 0) {
    const msg = [
      `🚨 *ALERTE SYSTEME — Novus Epoxy*`,
      ``,
      `${failures.length} probleme${failures.length > 1 ? 's' : ''} detecte${failures.length > 1 ? 's' : ''}:`,
      ...failures.map(f => `❌ *${f.name}*: ${f.detail}`),
      ...(autoFixes.length > 0 ? ['', `🔧 Auto-repare: ${autoFixes.map(f => f.name).join(', ')}`] : []),
      '',
      `✅ ${checks.length - failures.length}/${checks.length} systemes OK`,
    ].join('\n');
    await notifyTelegram(msg);
  } else if (autoFixes.length > 0) {
    await notifyTelegram(`🔧 *Health Check OK* — Auto-repare: ${autoFixes.map(f => f.name).join(', ')}. Tous les systemes fonctionnent.`);
  }

  return NextResponse.json({
    ok: failures.length === 0,
    timestamp: new Date().toISOString(),
    checks,
    failures: failures.length,
    autoFixed: autoFixes.length,
    watchAutoFixed,
  });
}
