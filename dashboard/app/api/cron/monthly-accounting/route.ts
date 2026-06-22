import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { sendEmail } from '@/lib/send-email';
import { getAdminChatIds } from '@/lib/telegram-utils';

export const maxDuration = 60;

/**
 * 1er du mois 9h Quebec EDT (13:00 UTC) → résumé comptable du mois précédent
 * envoyé par email à Luca + Telegram.
 *
 * Schedule via vercel.json:
 *   "/api/cron/monthly-accounting" → "0 13 1 * *"
 */
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  if (!secret || (secret !== (process.env.CRON_SECRET ?? '') && secret !== (process.env.ADMIN_API_KEY ?? ''))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const firstOfThisMonthMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const lastOfPrevMonth = new Date(firstOfThisMonthMs - 1);
  const firstOfPrevMonth = new Date(Date.UTC(lastOfPrevMonth.getUTCFullYear(), lastOfPrevMonth.getUTCMonth(), 1));
  const start = firstOfPrevMonth.toISOString().slice(0, 10);
  const end = lastOfPrevMonth.toISOString().slice(0, 10);
  const monthName = firstOfPrevMonth.toLocaleDateString('fr-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  // Revenus (invoices complétées) + dépenses + heures sous-traitants
  const [revRows, expRows, hrsRows, depotRows] = await Promise.all([
    query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(total),0)::numeric(12,2) AS total,
              COALESCE(SUM(tps),0)::numeric(12,2) AS tps, COALESCE(SUM(tvq),0)::numeric(12,2) AS tvq
         FROM invoices WHERE statut = 'completee' AND date_emission BETWEEN $1 AND $2`,
      [start, end]
    ),
    query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(montant_ttc),0)::numeric(12,2) AS total,
              COALESCE(SUM(tps),0)::numeric(12,2) AS tps, COALESCE(SUM(tvq),0)::numeric(12,2) AS tvq
         FROM expenses WHERE date_depense BETWEEN $1 AND $2`,
      [start, end]
    ),
    query(
      `SELECT e.nom, SUM(t.heures)::numeric(8,2) AS heures, e.taux_horaire
         FROM employees e JOIN time_entries t ON t.employee_id = e.id
        WHERE e.role = 'sous-traitant' AND t.date_travail BETWEEN $1 AND $2
        GROUP BY e.id, e.nom, e.taux_horaire ORDER BY heures DESC`,
      [start, end]
    ),
    query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(montant),0)::numeric(12,2) AS total
         FROM payments WHERE type = 'depot' AND paid_at::date BETWEEN $1 AND $2`,
      [start, end]
    ),
  ]);

  const rev = revRows[0] as Record<string, unknown>;
  const exp = expRows[0] as Record<string, unknown>;
  const dep = depotRows[0] as Record<string, unknown>;
  const revenuTotal = Number(rev.total ?? 0);
  const depensesTotal = Number(exp.total ?? 0);
  const profit = revenuTotal - depensesTotal;
  const tpsPercu = Number(rev.tps ?? 0);
  const tvqPercu = Number(rev.tvq ?? 0);
  const tpsPaye = Number(exp.tps ?? 0);
  const tvqPaye = Number(exp.tvq ?? 0);
  const tpsNet = tpsPercu - tpsPaye;
  const tvqNet = tvqPercu - tvqPaye;

  // Email HTML
  const fmt = (n: number) => n.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' });
  const stHtml = hrsRows.length
    ? `<table style="width:100%;border-collapse:collapse;margin:8px 0;"><tr style="background:#f1f5f9;"><th style="text-align:left;padding:6px;border:1px solid #e2e8f0;">Sous-traitant</th><th style="text-align:right;padding:6px;border:1px solid #e2e8f0;">Heures</th><th style="text-align:right;padding:6px;border:1px solid #e2e8f0;">$ (si taux défini)</th></tr>${hrsRows.map(rr => {
      const r = rr as Record<string, unknown>;
      const h = Number(r.heures ?? 0);
      const t = Number(r.taux_horaire ?? 0);
      return `<tr><td style="padding:6px;border:1px solid #e2e8f0;">${String(r.nom ?? '')}</td><td style="text-align:right;padding:6px;border:1px solid #e2e8f0;">${h.toFixed(1)} h</td><td style="text-align:right;padding:6px;border:1px solid #e2e8f0;">${t > 0 ? fmt(h * t) : '—'}</td></tr>`;
    }).join('')}</table>`
    : `<p style="color:#64748b;font-style:italic;">Aucune heure sous-traitant ce mois-ci.</p>`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;background:#f8fafc;margin:0;padding:24px;">
<div style="max-width:680px;margin:0 auto;background:#fff;border-radius:8px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
  <h1 style="color:#0f172a;margin:0 0 4px;font-size:24px;">Sommaire comptable — ${monthName}</h1>
  <p style="color:#64748b;margin:0 0 24px;font-size:14px;">Période: ${start} → ${end}</p>

  <h2 style="color:#0f172a;font-size:18px;border-bottom:2px solid #f59e0b;padding-bottom:6px;">Revenus & dépenses</h2>
  <table style="width:100%;border-collapse:collapse;margin:8px 0;">
    <tr><td style="padding:6px;color:#475569;">Factures complétées</td><td style="text-align:right;padding:6px;"><b>${rev.n} · ${fmt(revenuTotal)}</b></td></tr>
    <tr><td style="padding:6px;color:#475569;">Dépenses</td><td style="text-align:right;padding:6px;"><b style="color:#dc2626;">${exp.n} · ${fmt(depensesTotal)}</b></td></tr>
    <tr style="border-top:2px solid #0f172a;"><td style="padding:8px 6px;color:#0f172a;font-weight:700;">Profit brut</td><td style="text-align:right;padding:8px 6px;font-weight:700;color:${profit >= 0 ? '#16a34a' : '#dc2626'};">${fmt(profit)}</td></tr>
    <tr><td style="padding:6px;color:#475569;">Dépôts reçus</td><td style="text-align:right;padding:6px;">${dep.n} · ${fmt(Number(dep.total ?? 0))}</td></tr>
  </table>

  <h2 style="color:#0f172a;font-size:18px;border-bottom:2px solid #f59e0b;padding-bottom:6px;">Taxes</h2>
  <table style="width:100%;border-collapse:collapse;margin:8px 0;">
    <tr style="background:#f1f5f9;"><th style="text-align:left;padding:6px;border:1px solid #e2e8f0;">Taxe</th><th style="text-align:right;padding:6px;border:1px solid #e2e8f0;">Perçue</th><th style="text-align:right;padding:6px;border:1px solid #e2e8f0;">Payée</th><th style="text-align:right;padding:6px;border:1px solid #e2e8f0;">À remettre</th></tr>
    <tr><td style="padding:6px;border:1px solid #e2e8f0;">TPS</td><td style="text-align:right;padding:6px;border:1px solid #e2e8f0;">${fmt(tpsPercu)}</td><td style="text-align:right;padding:6px;border:1px solid #e2e8f0;">${fmt(tpsPaye)}</td><td style="text-align:right;padding:6px;border:1px solid #e2e8f0;"><b>${fmt(tpsNet)}</b></td></tr>
    <tr><td style="padding:6px;border:1px solid #e2e8f0;">TVQ</td><td style="text-align:right;padding:6px;border:1px solid #e2e8f0;">${fmt(tvqPercu)}</td><td style="text-align:right;padding:6px;border:1px solid #e2e8f0;">${fmt(tvqPaye)}</td><td style="text-align:right;padding:6px;border:1px solid #e2e8f0;"><b>${fmt(tvqNet)}</b></td></tr>
  </table>

  <h2 style="color:#0f172a;font-size:18px;border-bottom:2px solid #f59e0b;padding-bottom:6px;">Sous-traitants — heures du mois</h2>
  ${stHtml}

  <p style="margin-top:32px;text-align:center;">
    <a href="${process.env.NEXTAUTH_URL ?? 'https://novus-epoxy.vercel.app'}/dashboard/comptabilite" style="background:#f59e0b;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:700;">Voir le dashboard comptabilité</a>
  </p>
  <p style="text-align:center;color:#94a3b8;font-size:12px;margin-top:24px;">Généré automatiquement le 1er du mois — Novus Epoxy</p>
</div></body></html>`;

  // Send email
  const adminEmail = process.env.ADMIN_EMAIL ?? 'gestionnovusepoxy@gmail.com';
  try {
    await sendEmail({ to: adminEmail, subject: `Sommaire comptable ${monthName} — ${fmt(profit)} profit`, html });
  } catch (err) {
    console.error('Monthly accounting email failed:', err);
  }

  // Telegram summary
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = getAdminChatIds();
  if (botToken && chatIds.length) {
    const msg = [
      `📊 <b>Sommaire ${monthName}</b>`,
      ``,
      `Revenus: <b>${fmt(revenuTotal)}</b> (${rev.n} factures)`,
      `Dépenses: <b>${fmt(depensesTotal)}</b>`,
      `<b>Profit: ${fmt(profit)}</b>`,
      ``,
      `TPS à remettre: ${fmt(tpsNet)}`,
      `TVQ à remettre: ${fmt(tvqNet)}`,
    ].join('\n');
    await Promise.all(
      chatIds.map(id =>
        fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: id.trim(), text: msg, parse_mode: 'HTML' }),
        }).catch(() => {})
      )
    );
  }

  return NextResponse.json({
    ok: true,
    month: monthName,
    period: { start, end },
    revenus: { count: rev.n, total: revenuTotal },
    depenses: { count: exp.n, total: depensesTotal },
    profit,
    taxes: { tps_net: tpsNet, tvq_net: tvqNet },
    sous_traitants: hrsRows.length,
  });
}
