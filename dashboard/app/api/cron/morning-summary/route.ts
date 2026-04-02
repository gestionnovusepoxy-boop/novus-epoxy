import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { formatMoney } from '@/lib/pricing';

export const maxDuration = 60;

async function sendTelegram(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  }).catch(err => console.error('Telegram error:', err));
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  const cronSecret = process.env.CRON_SECRET ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if (!token || (token !== cronSecret && token !== adminKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // New submissions last 24h
  const newSubs = await query(
    `SELECT COUNT(*)::int AS count FROM submissions WHERE created_at > NOW() - INTERVAL '24 hours'`,
    []
  );

  // Pending quotes (brouillon)
  const pendingQuotes = await query(
    `SELECT COUNT(*)::int AS count FROM quotes WHERE statut = 'brouillon'`,
    []
  );

  // Quotes awaiting signature
  const awaitingSign = await query(
    `SELECT COUNT(*)::int AS count FROM quotes WHERE statut = 'envoye'`,
    []
  );

  // Contracts signed but deposit not paid
  const awaitingDeposit = await query(
    `SELECT COUNT(*)::int AS count FROM quotes WHERE statut = 'contrat_signe'`,
    []
  );

  // Deposits received last 24h
  const recentDeposits = await query(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(depot_requis), 0) AS total
     FROM quotes WHERE statut IN ('depot_paye', 'planifie', 'complete') AND deposit_paid_at > NOW() - INTERVAL '24 hours'`,
    []
  );

  // Upcoming bookings (next 7 days)
  const upcomingBookings = await query(
    `SELECT b.jour1_date, b.jour2_date, b.jour2_slot, q.client_nom, q.type_service
     FROM bookings b JOIN quotes q ON q.booking_id = b.id
     WHERE b.statut = 'confirme' AND b.jour1_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
     ORDER BY b.jour1_date ASC`,
    []
  );

  // Unread emails
  const unreadEmails = await query(
    `SELECT COUNT(*)::int AS count FROM email_logs WHERE replied = false AND created_at > NOW() - INTERVAL '48 hours'`,
    []
  ).catch(() => [{ count: 0 }]);

  // Revenue this month
  const monthRevenue = await query(
    `SELECT COALESCE(SUM(depot_requis), 0) AS deposits, COALESCE(SUM(total - depot_requis), 0) AS balances
     FROM quotes WHERE statut IN ('depot_paye', 'planifie', 'complete')
     AND deposit_paid_at >= DATE_TRUNC('month', CURRENT_DATE)`,
    []
  );

  // Sync new GHL/Champfields contacts before prospect emails
  let ghlImported = 0;
  try {
    const base = process.env.NEXTAUTH_URL ?? 'https://novus-epoxy.vercel.app';
    const syncRes = await fetch(`${base}/api/crm/leads/sync-ghl`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.ADMIN_API_KEY ?? ''}` },
    });
    if (syncRes.ok) {
      const syncData = await syncRes.json() as Record<string, unknown>;
      ghlImported = Number(syncData.imported ?? 0);
    }
  } catch { /* non-fatal */ }

  // Auto-send offers to leads that were blocked by 21h cutoff
  let pendingProspectSent = 0;
  try {
    const pendingProspects = await query(
      `SELECT id FROM crm_leads WHERE prospect_sent_at IS NULL AND email IS NOT NULL AND email != '' AND statut = 'nouveau'`,
    );
    if (pendingProspects.length > 0) {
      const ids = pendingProspects.map((r: Record<string, unknown>) => r.id as number);
      const base = process.env.NEXTAUTH_URL ?? 'https://novus-epoxy.vercel.app';
      const res = await fetch(`${base}/api/leads/jason/prospect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ADMIN_API_KEY ?? '' },
        body: JSON.stringify({ leadIds: ids }),
      });
      if (res.ok) {
        const result = await res.json() as Record<string, unknown>;
        pendingProspectSent = Number(result.sent ?? 0);
      }
    }
  } catch { /* non-fatal */ }

  // CRM stats
  const crmChauds = await query(
    `SELECT COUNT(*)::int AS count FROM crm_leads WHERE temperature = 'chaud' AND statut NOT IN ('ferme', 'froid')`,
    []
  ).catch(() => [{ count: 0 }]);

  const crmConversations = await query(
    `SELECT COUNT(*)::int AS count FROM crm_leads WHERE statut = 'contacte'`,
    []
  ).catch(() => [{ count: 0 }]);

  const crmQuotesToday = await query(
    `SELECT COUNT(*)::int AS count FROM quotes
     WHERE notes LIKE 'Lead CRM%' AND created_at::date = CURRENT_DATE`,
    []
  ).catch(() => [{ count: 0 }]);

  const crmFroidsToday = await query(
    `SELECT COUNT(*)::int AS count FROM crm_leads
     WHERE statut = 'froid' AND updated_at::date = CURRENT_DATE`,
    []
  ).catch(() => [{ count: 0 }]);

  // Build message
  const subCount = (newSubs[0] as { count: number }).count;
  const pendingCount = (pendingQuotes[0] as { count: number }).count;
  const signCount = (awaitingSign[0] as { count: number }).count;
  const depositCount = (awaitingDeposit[0] as { count: number }).count;
  const recentDepCount = (recentDeposits[0] as { count: number }).count;
  const recentDepTotal = Number((recentDeposits[0] as { total: number }).total);
  const unreadCount = (unreadEmails[0] as { count: number }).count;
  const monthDep = Number((monthRevenue[0] as { deposits: number }).deposits);
  const monthBal = Number((monthRevenue[0] as { balances: number }).balances);
  const crmChaudsCount = (crmChauds[0] as { count: number }).count;
  const crmConvCount = (crmConversations[0] as { count: number }).count;
  const crmQuotesCount = (crmQuotesToday[0] as { count: number }).count;
  const crmFroidsCount = (crmFroidsToday[0] as { count: number }).count;

  const lines = [
    `☀️ <b>Aria — Résumé du matin</b>`,
    ``,
    `📊 <b>Dernières 24h:</b>`,
    `• ${subCount} nouvelle${subCount !== 1 ? 's' : ''} soumission${subCount !== 1 ? 's' : ''}`,
    recentDepCount > 0 ? `• ${recentDepCount} depot${recentDepCount !== 1 ? 's' : ''} recu${recentDepCount !== 1 ? 's' : ''} (${formatMoney(recentDepTotal)})` : '• Aucun depot recu',
    ``,
    `📋 <b>A faire:</b>`,
    pendingCount > 0 ? `• ${pendingCount} devis a approuver` : '',
    signCount > 0 ? `• ${signCount} devis en attente de signature` : '',
    depositCount > 0 ? `• ${depositCount} contrat${depositCount !== 1 ? 's' : ''} signe${depositCount !== 1 ? 's' : ''} — depot en attente` : '',
    unreadCount > 0 ? `• ${unreadCount} email${unreadCount !== 1 ? 's' : ''} non repondu${unreadCount !== 1 ? 's' : ''}` : '',
    (!pendingCount && !signCount && !depositCount && !unreadCount) ? '• Rien en attente! 👌' : '',
  ].filter(Boolean);

  if (upcomingBookings.length > 0) {
    lines.push('');
    lines.push(`📅 <b>Travaux cette semaine:</b>`);
    for (const b of upcomingBookings) {
      const d = b.jour1_date instanceof Date ? b.jour1_date : new Date(String(b.jour1_date));
      const dayName = d.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'short' });
      lines.push(`• ${dayName} — ${b.client_nom} (${b.type_service})`);
    }
  }

  lines.push('');
  lines.push(`📊 <b>CRM Leads</b>`);
  lines.push(`🔥 Chauds: ${crmChaudsCount} | 🟡 En conversation: ${crmConvCount} | 🔵 Froids aujourd'hui: ${crmFroidsCount}`);
  lines.push(`Devis crees (CRM): ${crmQuotesCount}`);
  if (ghlImported > 0) {
    lines.push(`📥 ${ghlImported} nouveaux leads importes de Champfields/Facebook`);
  }
  if (pendingProspectSent > 0) {
    lines.push(`🚀 ${pendingProspectSent} offres envoyees ce matin (en attente depuis hier)`);
  }
  lines.push('');
  lines.push(`💰 <b>Revenus ce mois:</b> ${formatMoney(monthDep + monthBal)}`);
  lines.push('');
  lines.push(`<a href="https://novus-epoxy.vercel.app/dashboard">Ouvrir le dashboard</a>`);

  const msg = lines.join('\n');

  // Send to all admins
  const chatIds = (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').filter(Boolean);
  for (const chatId of chatIds) {
    await sendTelegram(chatId.trim(), msg);
  }

  return NextResponse.json({ ok: true, sent_to: chatIds.length });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
