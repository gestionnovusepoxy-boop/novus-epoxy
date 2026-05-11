import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { formatMoney } from '@/lib/pricing';
import { isQuietHours } from '@/lib/telegram-utils';

const BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN ?? '';
const ADMIN_CHAT_IDS = () =>
  (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

async function sendTelegram(chatId: string, text: string) {
  const token = BOT_TOKEN();
  if (!token) return;
  const chunks = text.match(/[\s\S]{1,4000}/g) ?? [text];
  for (const chunk of chunks) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: 'HTML' }),
    });
  }
}

export const maxDuration = 60;

// Vercel Cron — Iris daily financial report
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if (!authHeader || (authHeader !== cronSecret && authHeader !== adminKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (isQuietHours()) return NextResponse.json({ skipped: 'quiet hours' });

  // --- Revenue ---
  const revenueRows = await query(`
    SELECT
      COALESCE(SUM(CASE WHEN p.paid_at::date = CURRENT_DATE THEN p.montant ELSE 0 END), 0) AS rev_today,
      COALESCE(SUM(CASE WHEN p.paid_at >= DATE_TRUNC('week', CURRENT_DATE) THEN p.montant ELSE 0 END), 0) AS rev_week,
      COALESCE(SUM(CASE WHEN p.paid_at >= DATE_TRUNC('month', CURRENT_DATE) THEN p.montant ELSE 0 END), 0) AS rev_month
    FROM payments p
  `);
  const rev = revenueRows[0] as { rev_today: string; rev_week: string; rev_month: string };

  // --- Expenses ---
  const expenseRows = await query(`
    SELECT
      COALESCE(SUM(CASE WHEN date_depense = CURRENT_DATE THEN montant_ttc ELSE 0 END), 0) AS exp_today,
      COALESCE(SUM(CASE WHEN date_depense >= DATE_TRUNC('week', CURRENT_DATE) THEN montant_ttc ELSE 0 END), 0) AS exp_week,
      COALESCE(SUM(CASE WHEN date_depense >= DATE_TRUNC('month', CURRENT_DATE) THEN montant_ttc ELSE 0 END), 0) AS exp_month
    FROM expenses
  `);
  const exp = expenseRows[0] as { exp_today: string; exp_week: string; exp_month: string };

  // --- Pending deposits (contract signed, no deposit yet) ---
  const pendingDeposits = await query(`
    SELECT id, client_nom, total, depot_requis
    FROM quotes
    WHERE statut = 'contrat_signe'
    ORDER BY created_at DESC
    LIMIT 15
  `);
  const pendingDepositTotal = pendingDeposits.reduce(
    (sum, q) => sum + Number(q.depot_requis ?? 0), 0
  );

  // --- Stale quotes (sent > 7 days, no response) ---
  const staleQuotes = await query(`
    SELECT id, client_nom, total, created_at
    FROM quotes
    WHERE statut = 'envoye'
      AND created_at < NOW() - INTERVAL '7 days'
    ORDER BY created_at ASC
    LIMIT 15
  `);

  // --- Upcoming bookings this week ---
  const bookings = await query(`
    SELECT b.jour1_date, b.jour2_date, q.client_nom, q.type_service, q.total
    FROM bookings b
    JOIN quotes q ON q.id = b.quote_id
    WHERE b.jour1_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7
      AND b.statut = 'confirme'
    ORDER BY b.jour1_date ASC
  `);

  // --- Pending expenses (upcoming recurring not yet created) ---
  const pendingExpenses = await query(`
    SELECT COALESCE(SUM(montant_ttc), 0) AS total
    FROM expenses
    WHERE date_depense > CURRENT_DATE
      AND date_depense <= CURRENT_DATE + 30
  `);
  const pendingExpTotal = Number((pendingExpenses[0] as { total: string }).total);

  // --- Cash flow projection ---
  const cashFlow = pendingDepositTotal - pendingExpTotal;

  // --- Build Telegram message ---
  const lines: string[] = [];
  lines.push(`<b>Iris -- Rapport Financier Quotidien</b>`);
  lines.push(``);

  lines.push(`<b>Revenus</b>`);
  lines.push(`Aujourd'hui: ${formatMoney(Number(rev.rev_today))}`);
  lines.push(`Cette semaine: ${formatMoney(Number(rev.rev_week))}`);
  lines.push(`Ce mois: ${formatMoney(Number(rev.rev_month))}`);
  lines.push(``);

  lines.push(`<b>Depenses</b>`);
  lines.push(`Aujourd'hui: ${formatMoney(Number(exp.exp_today))}`);
  lines.push(`Cette semaine: ${formatMoney(Number(exp.exp_week))}`);
  lines.push(`Ce mois: ${formatMoney(Number(exp.exp_month))}`);
  lines.push(``);

  if (pendingDeposits.length > 0) {
    lines.push(`<b>Depots en attente (${pendingDeposits.length})</b>`);
    for (const q of pendingDeposits) {
      lines.push(`  #${q.id} ${q.client_nom} -- ${formatMoney(Number(q.depot_requis))}`);
    }
    lines.push(`  Total: ${formatMoney(pendingDepositTotal)}`);
    lines.push(``);
  }

  if (staleQuotes.length > 0) {
    lines.push(`<b>Devis sans reponse &gt;7 jours (${staleQuotes.length})</b>`);
    for (const q of staleQuotes) {
      const d = new Date(String(q.created_at));
      const days = Math.floor((Date.now() - d.getTime()) / 86400000);
      lines.push(`  #${q.id} ${q.client_nom} -- ${formatMoney(Number(q.total))} (${days}j)`);
    }
    lines.push(``);
  }

  if (bookings.length > 0) {
    lines.push(`<b>Travaux cette semaine (${bookings.length})</b>`);
    for (const b of bookings) {
      const d = b.jour1_date instanceof Date ? b.jour1_date : new Date(String(b.jour1_date));
      const dayName = d.toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' });
      lines.push(`  ${dayName} -- ${b.client_nom} (${b.type_service}) ${formatMoney(Number(b.total))}`);
    }
    lines.push(``);
  }

  lines.push(`<b>Projection tresorerie</b>`);
  lines.push(`Depots en attente: +${formatMoney(pendingDepositTotal)}`);
  lines.push(`Depenses a venir (30j): -${formatMoney(pendingExpTotal)}`);
  lines.push(`Flux net: ${cashFlow >= 0 ? '+' : ''}${formatMoney(cashFlow)}`);
  lines.push(``);
  lines.push(`<a href="https://novus-epoxy.vercel.app/dashboard">Ouvrir le dashboard</a>`);

  const msg = lines.join('\n');

  // Envoyer seulement s'il y a quelque chose d'important
  const hasAction = pendingDeposits.length > 0 || staleQuotes.length > 0 || Number(rev.rev_today) > 0 || bookings.length > 0;
  const chatIds = ADMIN_CHAT_IDS();
  if (hasAction) {
    for (const chatId of chatIds) {
      await sendTelegram(chatId, msg);
    }
  }

  return NextResponse.json({
    ok: true,
    sent_to: hasAction ? chatIds.length : 0,
    revenue: { today: Number(rev.rev_today), week: Number(rev.rev_week), month: Number(rev.rev_month) },
    expenses: { today: Number(exp.exp_today), week: Number(exp.exp_week), month: Number(exp.exp_month) },
    pending_deposits: pendingDeposits.length,
    stale_quotes: staleQuotes.length,
    bookings: bookings.length,
    cash_flow: cashFlow,
  });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
