import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const ADMIN_API_KEY = () => process.env.ADMIN_API_KEY ?? '';
const BASE_URL = () => process.env.NEXTAUTH_URL ?? process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';

async function internalCall(path: string, method: 'GET' | 'POST' = 'GET'): Promise<{ ok: boolean; detail: string }> {
  const key = ADMIN_API_KEY();
  const base = BASE_URL();
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => 'No response body');
      return { ok: false, detail: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    return { ok: true, detail: 'OK' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'Erreur inconnue' };
  }
}

async function restartAgent(agentId: string): Promise<{ ok: boolean; message: string }> {
  switch (agentId) {
    case 'aria': {
      const r = await internalCall('/api/cron/email-scan', 'GET');
      return { ok: r.ok, message: r.ok ? 'Scan email lance' : `Erreur: ${r.detail}` };
    }
    case 'echo': {
      const r = await internalCall('/api/cron/health-check', 'GET');
      return { ok: r.ok, message: r.ok ? 'Health-check lance' : `Erreur: ${r.detail}` };
    }
    case 'marcel': {
      // Re-register Telegram webhook
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const base = BASE_URL();
      if (!botToken) return { ok: false, message: 'TELEGRAM_BOT_TOKEN manquant' };
      try {
        const webhookUrl = `${base}/api/telegram/admin`;
        const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: webhookUrl, secret_token: process.env.TELEGRAM_WEBHOOK_SECRET ?? '', allowed_updates: ['message', 'callback_query'] }),
          signal: AbortSignal.timeout(5000),
        });
        const data = await res.json() as { ok: boolean; description?: string };
        return { ok: data.ok, message: data.ok ? 'Webhook Telegram re-enregistre' : `Erreur: ${data.description ?? 'inconnu'}` };
      } catch {
        return { ok: false, message: 'Timeout re-enregistrement webhook' };
      }
    }
    case 'iris': {
      const r = await internalCall('/api/cron/iris-report', 'GET');
      return { ok: r.ok, message: r.ok ? 'Rapport Iris lance' : `Erreur: ${r.detail}` };
    }
    case 'denis':
    case 'jason': {
      const r = await internalCall('/api/cron/prospect-followup', 'GET');
      return { ok: r.ok, message: r.ok ? 'Verification prospection lancee' : `Erreur: ${r.detail}` };
    }
    case 'hunter': {
      const r = await internalCall('/api/cron/lead-followup', 'GET');
      return { ok: r.ok, message: r.ok ? 'Verification leads lancee' : `Erreur: ${r.detail}` };
    }
    case 'bolt': {
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const chatIds = (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').filter(Boolean);
      if (!botToken || chatIds.length === 0) return { ok: false, message: 'Config Telegram manquante' };
      try {
        const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatIds[0].trim(),
            text: '🧪 Test Mission Control — Bolt est operationnel!',
          }),
          signal: AbortSignal.timeout(5000),
        });
        const data = await res.json() as { ok: boolean };
        return { ok: data.ok, message: data.ok ? 'Message test envoye sur Telegram' : 'Erreur envoi Telegram' };
      } catch {
        return { ok: false, message: 'Timeout envoi Telegram' };
      }
    }
    case 'nova': {
      // Test chat endpoint accessibility
      try {
        const base = BASE_URL();
        const res = await fetch(`${base}/api/chat`, {
          method: 'OPTIONS',
          signal: AbortSignal.timeout(5000),
        });
        // Any response (even 405) means the endpoint is up
        return { ok: true, message: `Chatbot accessible (HTTP ${res.status})` };
      } catch {
        return { ok: false, message: 'Chatbot non joignable' };
      }
    }
    case 'zara': {
      const r = await internalCall('/api/cron/rappels', 'GET');
      return { ok: r.ok, message: r.ok ? 'Verification rappels lancee' : `Erreur: ${r.detail}` };
    }
    case 'rex': {
      // Test Twilio connection
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const token = process.env.TWILIO_AUTH_TOKEN;
      if (!sid || !token) return { ok: false, message: 'Credentials Twilio manquants' };
      try {
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
          headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64') },
          signal: AbortSignal.timeout(5000),
        });
        return { ok: res.ok, message: res.ok ? 'Twilio connecte et operationnel' : `Twilio erreur HTTP ${res.status}` };
      } catch {
        return { ok: false, message: 'Timeout verification Twilio' };
      }
    }
    case 'sage': {
      // Check portfolio count
      try {
        const { query: dbQuery } = await import('@/lib/db');
        const rows = await dbQuery(`SELECT COUNT(*) as total FROM portfolio`);
        const total = Number(rows[0]?.total ?? 0);
        return { ok: true, message: `Portfolio: ${total} item(s)` };
      } catch {
        return { ok: false, message: 'Erreur acces portfolio' };
      }
    }
    default:
      return { ok: false, message: 'Agent inconnu' };
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return new NextResponse('Non autorise', { status: 401 });

  let body: { agentId?: string };
  try {
    body = await req.json() as { agentId?: string };
  } catch {
    return NextResponse.json({ ok: false, message: 'Body JSON invalide' }, { status: 400 });
  }

  const { agentId } = body;
  if (!agentId) return NextResponse.json({ ok: false, message: 'agentId requis' }, { status: 400 });

  const result = await restartAgent(agentId);
  return NextResponse.json(result);
}
