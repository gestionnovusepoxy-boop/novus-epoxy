import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

type AgentStatus = 'running' | 'veille' | 'erreur';

interface StatusResult {
  status: AgentStatus;
  detail: string;
  lastCheck?: string;
}

// Helper: check if a date is within a given number of hours
function withinHours(date: string | null | undefined, hours: number): boolean {
  if (!date) return false;
  const diff = Date.now() - new Date(date).getTime();
  return diff < hours * 3600000;
}

function withinDays(date: string | null | undefined, days: number): boolean {
  if (!date) return false;
  const diff = Date.now() - new Date(date).getTime();
  return diff < days * 86400000;
}

async function checkNova(): Promise<StatusResult> {
  try {
    // Check if conversations table is accessible and chatbot has recent activity
    const rows = await query(
      `SELECT created_at FROM conversations ORDER BY created_at DESC LIMIT 1`
    );
    const last = rows[0]?.created_at as string | undefined;
    if (!last) return { status: 'veille', detail: 'Aucune conversation enregistree' };
    if (withinHours(last, 24)) return { status: 'running', detail: 'Conversations actives', lastCheck: last };
    return { status: 'veille', detail: 'Aucune conversation recente', lastCheck: last };
  } catch {
    return { status: 'erreur', detail: 'Impossible de verifier le chatbot' };
  }
}

async function checkMarcel(): Promise<StatusResult> {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return { status: 'erreur', detail: 'TELEGRAM_BOT_TOKEN manquant' };
    // Check webhook info
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { status: 'erreur', detail: 'Telegram API non joignable' };
    const data = await res.json() as { ok: boolean; result?: { url?: string; last_error_message?: string } };
    if (!data.ok) return { status: 'erreur', detail: 'Telegram webhook erreur' };
    const wh = data.result;
    if (!wh?.url) return { status: 'veille', detail: 'Webhook non configure' };
    if (wh.last_error_message) return { status: 'erreur', detail: `Webhook erreur: ${wh.last_error_message}` };
    return { status: 'running', detail: 'Webhook actif' };
  } catch {
    return { status: 'erreur', detail: 'Timeout verification Telegram' };
  }
}

async function checkAria(): Promise<StatusResult> {
  try {
    const rows = await query(
      `SELECT created_at FROM email_logs ORDER BY created_at DESC LIMIT 1`
    );
    const last = rows[0]?.created_at as string | undefined;
    if (!last) return { status: 'veille', detail: 'Aucun email dans les logs' };
    if (withinHours(last, 12)) return { status: 'running', detail: 'Emails traites recemment', lastCheck: last };
    if (withinHours(last, 48)) return { status: 'veille', detail: 'Pas de scan depuis 12h+', lastCheck: last };
    return { status: 'erreur', detail: 'Aucun scan depuis 48h+', lastCheck: last };
  } catch {
    return { status: 'erreur', detail: 'Impossible de verifier email_logs' };
  }
}

async function checkEcho(): Promise<StatusResult> {
  try {
    // Check if health-check has results stored
    const rows = await query(
      `SELECT value, updated_at FROM kv_store WHERE key = 'last_health_check'`
    );
    const last = rows[0]?.updated_at as string | undefined;
    if (!last) return { status: 'veille', detail: 'Aucun health-check enregistre' };
    if (withinHours(last, 24)) return { status: 'running', detail: 'Health-check recent', lastCheck: last };
    return { status: 'erreur', detail: 'Health-check pas lance depuis 24h+', lastCheck: last };
  } catch {
    // kv_store might not have health check entry — that's OK, try env check
    const envVars = ['ANTHROPIC_API_KEY', 'DATABASE_URL', 'TELEGRAM_BOT_TOKEN', 'TWILIO_ACCOUNT_SID', 'GOOGLE_CLIENT_ID', 'STRIPE_SECRET_KEY'];
    const ok = envVars.filter(v => !!process.env[v]).length;
    if (ok === envVars.length) return { status: 'running', detail: `${ok}/${envVars.length} env vars OK` };
    return { status: 'veille', detail: `${ok}/${envVars.length} env vars configurees` };
  }
}

async function checkDenis(): Promise<StatusResult> {
  try {
    const rows = await query(
      `SELECT prospect_sent_at, created_at FROM crm_leads WHERE source = 'jason' ORDER BY prospect_sent_at DESC NULLS LAST LIMIT 1`
    );
    if (rows.length === 0) return { status: 'veille', detail: 'Aucun lead de prospection' };
    const lastSent = rows[0]?.prospect_sent_at as string | undefined;
    if (!lastSent) return { status: 'veille', detail: 'Leads importes mais pas de prospection envoyee' };
    if (withinDays(lastSent, 7)) return { status: 'running', detail: 'Prospection active', lastCheck: lastSent };
    return { status: 'veille', detail: 'Pas de prospection depuis 7j+', lastCheck: lastSent };
  } catch {
    return { status: 'erreur', detail: 'Impossible de verifier les leads' };
  }
}

async function checkIris(): Promise<StatusResult> {
  try {
    const rows = await query(
      `SELECT value, updated_at FROM kv_store WHERE key = 'last_iris_report'`
    );
    const last = rows[0]?.updated_at as string | undefined;
    if (!last) {
      // Fall back: check if quotes table is accessible
      await query(`SELECT COUNT(*) FROM quotes`);
      return { status: 'veille', detail: 'Systeme financier accessible, pas de rapport recent' };
    }
    if (withinHours(last, 24)) return { status: 'running', detail: 'Rapport recent', lastCheck: last };
    return { status: 'veille', detail: 'Pas de rapport depuis 24h+', lastCheck: last };
  } catch {
    return { status: 'erreur', detail: 'Impossible de verifier le systeme financier' };
  }
}

async function checkZara(): Promise<StatusResult> {
  try {
    const rows = await query(
      `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE jour1_date >= CURRENT_DATE AND statut = 'confirme') as upcoming FROM bookings`
    );
    const r = rows[0] as Record<string, string | number>;
    const total = Number(r.total ?? 0);
    const upcoming = Number(r.upcoming ?? 0);
    if (total === 0) return { status: 'veille', detail: 'Aucune reservation en base' };
    return { status: 'running', detail: `${upcoming} reservation(s) a venir sur ${total} total` };
  } catch {
    return { status: 'erreur', detail: 'Impossible de verifier les reservations' };
  }
}

async function checkSage(): Promise<StatusResult> {
  try {
    const rows = await query(
      `SELECT COUNT(*) as total FROM portfolio`
    );
    const total = Number(rows[0]?.total ?? 0);
    if (total === 0) return { status: 'veille', detail: 'Portfolio vide' };
    return { status: 'running', detail: `${total} item(s) au portfolio` };
  } catch {
    return { status: 'erreur', detail: 'Impossible de verifier le portfolio' };
  }
}

async function checkRex(): Promise<StatusResult> {
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) return { status: 'erreur', detail: 'Credentials Twilio manquants' };
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
      headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64') },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 401) return { status: 'erreur', detail: 'Token Twilio invalide — regenerer sur console.twilio.com' };
    if (!res.ok) return { status: 'erreur', detail: `Twilio erreur HTTP ${res.status}` };
    return { status: 'running', detail: 'Twilio connecte' };
  } catch {
    return { status: 'erreur', detail: 'Timeout verification Twilio' };
  }
}

async function checkBolt(): Promise<StatusResult> {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return { status: 'erreur', detail: 'TELEGRAM_BOT_TOKEN manquant' };
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { status: 'erreur', detail: 'Telegram bot non joignable' };
    const data = await res.json() as { ok: boolean };
    if (!data.ok) return { status: 'erreur', detail: 'Telegram bot erreur' };
    return { status: 'running', detail: 'Telegram bot actif' };
  } catch {
    return { status: 'erreur', detail: 'Timeout verification Telegram bot' };
  }
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return new NextResponse('Non autorise', { status: 401 });

  // Support checking a single agent via query param
  const agentId = req.nextUrl.searchParams.get('agent');

  const checkers: Record<string, () => Promise<StatusResult>> = {
    nova: checkNova,
    marcel: checkMarcel,
    aria: checkAria,
    echo: checkEcho,
    denis: checkDenis,
    jason: checkDenis, // jason = denis
    iris: checkIris,
    zara: checkZara,
    sage: checkSage,
    rex: checkRex,
    bolt: checkBolt,
    hunter: checkDenis, // hunter uses same lead system
  };

  if (agentId) {
    const checker = checkers[agentId];
    if (!checker) return NextResponse.json({ error: 'Agent inconnu' }, { status: 400 });
    const result = await checker();
    return NextResponse.json({ [agentId]: result });
  }

  // Check all agents in parallel
  const entries = Object.entries(checkers);
  const results = await Promise.allSettled(entries.map(([, fn]) => fn()));

  const statuses: Record<string, StatusResult> = {};
  entries.forEach(([key], i) => {
    const r = results[i];
    statuses[key] = r.status === 'fulfilled'
      ? r.value
      : { status: 'erreur', detail: 'Verification echouee' };
  });

  return NextResponse.json(statuses);
}
