import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { formatMoney } from '@/lib/pricing';

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
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  if (adminKey && token !== adminKey && token !== cronSecret) {
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

  const lines = [
    `☀️ <b>Résumé du matin — Novus Epoxy</b>`,
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
