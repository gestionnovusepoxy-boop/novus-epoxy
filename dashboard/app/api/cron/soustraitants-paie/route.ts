import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getAdminChatIds } from '@/lib/telegram-utils';
import { escapeHtml } from '@/lib/utils';

export const maxDuration = 60;

/**
 * Samedi 9h Quebec EDT (13:00 UTC) → résumé heures + $ à payer par sous-traitant
 * pour les 7 derniers jours. Telegram à Luca + Jason.
 *
 * Schedule via vercel.json:
 *   "/api/cron/soustraitants-paie" → "0 13 * * 6"   (samedi 13:00 UTC = 9am EDT)
 *
 * Aucun SMS aux sous-traitants automatique — Luca paye via Interac manuellement.
 * Mémoire feedback_soustraitants: pas de taxes, payés samedi, factures à l'heure.
 */
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  if (secret !== (process.env.CRON_SECRET ?? '') && secret !== (process.env.ADMIN_API_KEY ?? '')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Sum hours by sous-traitant for the past 7 days
  const rows = await query(
    `SELECT e.id, e.nom, e.telephone, e.taux_horaire,
            SUM(t.heures)::numeric(8,2) AS total_heures,
            COUNT(DISTINCT t.quote_id) AS nb_chantiers,
            MIN(t.date_travail) AS premier_jour,
            MAX(t.date_travail) AS dernier_jour
       FROM employees e
       JOIN time_entries t ON t.employee_id = e.id
      WHERE e.role = 'sous-traitant'
        AND e.actif = TRUE
        AND t.date_travail >= CURRENT_DATE - INTERVAL '7 days'
        AND t.heures IS NOT NULL
        AND t.heures > 0
      GROUP BY e.id, e.nom, e.telephone, e.taux_horaire
      HAVING SUM(t.heures) > 0
      ORDER BY total_heures DESC`,
  );

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, message: 'Aucune heure sous-traitant cette semaine', count: 0 });
  }

  // Build Telegram summary
  let totalDue = 0;
  let totalHours = 0;
  const lines: string[] = [
    `💰 <b>Paie sous-traitants — Semaine</b>`,
    `<i>${new Date().toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' })}</i>`,
    ``,
  ];

  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const heures = Number(r.total_heures ?? 0);
    const taux = Number(r.taux_horaire ?? 0);
    const nbChantiers = Number(r.nb_chantiers ?? 0);
    const nom = String(r.nom ?? 'Inconnu');
    const tel = r.telephone ? String(r.telephone) : '';
    const du = heures * taux;
    totalHours += heures;
    totalDue += du;

    const duStr = taux > 0 ? `<b>$${du.toFixed(2)}</b> (${heures}h × $${taux}/h)` : `<b>${heures}h</b> (taux non défini)`;

    lines.push(
      `👤 ${escapeHtml(nom)}`,
      `   ${duStr}`,
      `   ${nbChantiers} chantier${nbChantiers > 1 ? 's' : ''}`,
      tel ? `   📞 ${escapeHtml(tel)}` : '',
      ``,
    );
  }

  if (totalDue > 0) {
    lines.push(`━━━━━━━━━━`, `<b>Total à payer: $${totalDue.toFixed(2)}</b>`, `Total heures: ${totalHours.toFixed(1)}h`);
  } else {
    lines.push(`━━━━━━━━━━`, `<b>Total heures: ${totalHours.toFixed(1)}h</b>`, `<i>Définir taux_horaire dans /dashboard/equipe pour $</i>`);
  }
  lines.push('', '<i>Payer via Interac — voir /dashboard/equipe</i>');

  // Send Telegram to admins
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = getAdminChatIds();
  if (botToken && chatIds.length) {
    await Promise.all(
      chatIds.map((id) =>
        fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: id.trim(),
            text: lines.filter(Boolean).join('\n'),
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [
                [{ text: '👥 Voir équipe', url: `${process.env.NEXTAUTH_URL ?? 'https://novus-epoxy.vercel.app'}/dashboard/equipe` }],
              ],
            },
          }),
        }).catch(() => {})
      )
    );
  }

  return NextResponse.json({
    ok: true,
    count: rows.length,
    total_heures: Number(totalHours.toFixed(2)),
    total_du: Number(totalDue.toFixed(2)),
    sous_traitants: rows.map((row) => {
      const r = row as Record<string, unknown>;
      const heures = Number(r.total_heures ?? 0);
      const taux = Number(r.taux_horaire ?? 0);
      return {
        id: r.id,
        nom: r.nom,
        heures,
        du: Number((heures * taux).toFixed(2)),
        taux,
      };
    }),
  });
}
