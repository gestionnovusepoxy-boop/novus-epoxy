import { NextRequest, NextResponse } from 'next/server';
import { getAdminChatIds } from '@/lib/telegram-utils';
import { query } from '@/lib/db';
import { formatMoney } from '@/lib/pricing';
import { isQuietHours } from '@/lib/telegram-utils';
import { sendEmail } from '@/lib/send-email';

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

  if (isQuietHours()) return NextResponse.json({ skipped: 'quiet hours' });

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
     FROM bookings b JOIN quotes q ON b.quote_id = q.id
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

  // GHL sync runs as a separate cron — not duplicated here
  const ghlImported = 0;

  // NOTE: Auto-sending prospect offers removed — requires explicit approval from Luca
  // Prospect emails are handled by /api/cron/aria-prospect (daily at 9h UTC, capped at 5/batch)
  const pendingProspectSent = 0;

  // CRM stats
  const crmChauds = await query(
    `SELECT COUNT(*)::int AS count FROM crm_leads WHERE temperature = 'chaud' AND statut NOT IN ('ferme', 'perdu', 'converti')`,
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

  // Rex SMS stats — outbound SMS sent today
  const rexSmsToday = await query(
    `SELECT COUNT(*)::int AS count FROM sms_logs WHERE direction = 'outbound' AND created_at >= CURRENT_DATE`,
    []
  ).catch(() => [{ count: 0 }]);

  // Recent emails summary (last 12h for morning, last 12h for evening)
  const recentEmailLogs = await query(
    `SELECT destinataire, sujet, statut, direction, created_at FROM email_logs
     WHERE created_at > NOW() - INTERVAL '12 hours'
     ORDER BY created_at DESC LIMIT 15`,
  ).catch(() => []);

  // Pending payments (expenses marked as paiement reminders from email scan)
  const pendingPayments = await query(
    `SELECT fournisseur, montant_ttc, description, date_depense FROM expenses
     WHERE source = 'email-scan' AND paid_at IS NULL AND montant_ttc > 0
     ORDER BY date_depense ASC LIMIT 5`,
  ).catch(() => []);

  // Google review requests — jobs completed in last 24h with no review request sent
  let reviewRequestsSent = 0;
  try {
    const completedJobs = await query(
      `SELECT q.id, q.client_nom, q.client_email, q.client_telephone
       FROM quotes q
       WHERE q.statut = 'complete'
         AND q.updated_at > NOW() - INTERVAL '24 hours'
         AND (q.review_requested_at IS NULL)
       LIMIT 10`,
      []
    );

    const GOOGLE_REVIEW_URL = 'https://g.page/r/CeAd5U7pHvj_EBM/review';

    for (const job of completedJobs) {
      const clientNom = job.client_nom as string;
      const clientEmail = job.client_email as string | null;
      if (!clientEmail) continue;

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;"><div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;"><p>Bonjour ${clientNom},</p><p>Merci d'avoir choisi Novus Epoxy! Votre avis sur Google nous aide beaucoup:</p><p style="margin:24px 0;text-align:center;"><a href="${GOOGLE_REVIEW_URL}" style="background:#f59e0b;color:#0f172a;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block;">Laisser un avis &#11088;</a></p><p>${GOOGLE_REVIEW_URL}</p><p>Merci encore pour votre confiance!</p><p>Luca Lanthier, Novus Epoxy<br/>581-307-5983</p></div></body></html>`;

      try {
        await sendEmail({
          to: clientEmail,
          subject: 'Merci pour votre confiance — Donnez-nous votre avis ⭐',
          html,
        });
        reviewRequestsSent++;
      } catch (emailErr) {
        console.error('[morning-summary] Review email failed:', emailErr);
        continue;
      }

      try {
        await query(
          `UPDATE quotes SET review_requested_at = NOW() WHERE id = $1`,
          [job.id]
        );
      } catch { /* review_requested_at column may not exist yet */ }
    }
  } catch (reviewErr) {
    console.error('[morning-summary] Review requests error:', reviewErr);
  }

  // Build message
  const isEvening = req.nextUrl.searchParams.get('evening') === 'true';
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
  const rexSmsCount = (rexSmsToday[0] as { count: number }).count;

  const lines = [
    isEvening ? `🌙 <b>Aria — Résumé du soir</b>` : `☀️ <b>Aria — Résumé du matin</b>`,
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
  lines.push(`📱 Rex SMS aujourd'hui: ${rexSmsCount}`);
  if (ghlImported > 0) {
    lines.push(`📥 ${ghlImported} nouveaux leads importes de Champfields/Facebook`);
  }
  if (pendingProspectSent > 0) {
    lines.push(`🚀 ${pendingProspectSent} offres envoyees ce matin (en attente depuis hier)`);
  }
  // Aria email activity — show what Aria handled automatically
  const ariaSent = recentEmailLogs.filter((e: Record<string, unknown>) => e.statut === 'sent').length;
  const ariaFailed = recentEmailLogs.filter((e: Record<string, unknown>) => e.statut === 'error').length;
  const ariaSentEmails = recentEmailLogs.filter((e: Record<string, unknown>) => e.statut === 'sent').slice(0, 4);
  if (ariaSent > 0 || recentEmailLogs.length > 0) {
    lines.push('');
    lines.push(`📧 <b>Emails — Aria (12 dernieres heures):</b>`);
    if (ariaSent > 0) {
      lines.push(`✅ ${ariaSent} reponse${ariaSent !== 1 ? 's' : ''} envoyee${ariaSent !== 1 ? 's' : ''} automatiquement`);
      for (const e of ariaSentEmails) {
        const dest = (e.destinataire as string)?.split('@')[0]?.slice(0, 25) ?? '';
        const subj = (e.sujet as string)?.replace(/^Re:\s*/i, '').slice(0, 45) ?? '';
        lines.push(`  • ${dest}: ${subj}`);
      }
    }
    if (ariaFailed > 0) {
      lines.push(`⚠️ ${ariaFailed} reponse${ariaFailed !== 1 ? 's' : ''} echouee${ariaFailed !== 1 ? 's' : ''} — verifie manuellement`);
    }
  }

  // Pending payments
  if (pendingPayments.length > 0) {
    lines.push('');
    lines.push(`💳 <b>Factures a payer:</b>`);
    for (const p of pendingPayments) {
      lines.push(`• ${p.fournisseur} — ${formatMoney(Number(p.montant_ttc))} (${p.description ?? ''})`);
    }
  }

  if (reviewRequestsSent > 0) {
    lines.push('');
    lines.push(`⭐ ${reviewRequestsSent} demande${reviewRequestsSent !== 1 ? 's' : ''} d'avis Google envoyee${reviewRequestsSent !== 1 ? 's' : ''}`);
  }

  lines.push('');
  lines.push(`💰 <b>Revenus ce mois:</b> ${formatMoney(monthDep + monthBal)}`);

  // Twilio balance alert — flag when < $20 so SMS doesn't go dark
  try {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const auth = process.env.TWILIO_AUTH_TOKEN;
    if (sid && auth) {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Balance.json`, {
        headers: { Authorization: `Basic ${Buffer.from(`${sid}:${auth}`).toString('base64')}` },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const j = await res.json() as { balance?: string; currency?: string };
        const bal = parseFloat(j.balance ?? '0');
        const cur = j.currency ?? 'USD';
        if (Number.isFinite(bal) && bal < 20) {
          lines.push('');
          lines.push(`⚠️ <b>Twilio balance basse:</b> ${bal.toFixed(2)} ${cur} — top up bientot sinon SMS coupe.`);
        }
      }
    }
  } catch { /* never block the summary on Twilio check */ }

  lines.push('');
  lines.push(`<a href="https://novus-epoxy.vercel.app/dashboard">Ouvrir le dashboard</a>`);

  const msg = lines.join('\n');

  // Send to all admins
  const chatIds = getAdminChatIds();
  for (const chatId of chatIds) {
    await sendTelegram(chatId.trim(), msg);
  }

  return NextResponse.json({ ok: true, sent_to: chatIds.length });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
