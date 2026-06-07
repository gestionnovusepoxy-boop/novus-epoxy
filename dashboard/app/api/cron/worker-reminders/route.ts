import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { sendSMS } from '@/lib/sms';
import { getAdminChatIds } from '@/lib/telegram-utils';

export const maxDuration = 60;

/**
 * Daily 18:00 Quebec EDT (22:00 UTC) → SMS sous-traitants assignés pour
 * chantiers demain. Mémoire feedback_sms_hours: pas avant 8h ni après 21h.
 * 22:00 UTC = 18:00 EDT (Quebec daylight time), donc OK.
 *
 * Schedule via vercel.json:
 *   "/api/cron/worker-reminders" → "0 22 * * *"
 *
 * Bookings.employees_assignes (int[]) lists employee_ids assigned to the job.
 */
export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  if (!secret || (secret !== (process.env.CRON_SECRET ?? '') && secret !== (process.env.ADMIN_API_KEY ?? ''))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Hard guard against accidental SMS outside business hours (memory feedback_sms_hours)
  const utcHour = new Date().getUTCHours();
  // Quebec EDT (UTC-4 May-Nov) → 8h-21h = 12h-01h UTC. EST (UTC-5 Nov-Mar) → 13h-02h UTC.
  // Conservative: only run between 12:00 and 01:00 UTC.
  if (utcHour < 12 && utcHour > 1) {
    return NextResponse.json({ skipped: 'quiet hours guard' });
  }

  const rows = await query(
    `SELECT b.id AS booking_id, b.jour1_date, b.jour1_slot, b.employees_assignes,
            q.id AS quote_id, q.client_nom, q.client_adresse, q.type_service, q.superficie
       FROM bookings b
       JOIN quotes q ON q.id = b.quote_id
      WHERE b.statut = 'confirme'
        AND b.jour1_date = CURRENT_DATE + INTERVAL '1 day'
        AND b.rappel_workers_sent = FALSE
        AND COALESCE(array_length(b.employees_assignes, 1), 0) > 0`,
    []
  );

  let smsSent = 0;
  let bookingsProcessed = 0;

  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const employeeIds = (r.employees_assignes ?? []) as number[];
    if (!employeeIds.length) continue;

    // Élargi: pas seulement 'sous-traitant' — un worker assigné avec un autre rôle recevait rien.
    // Requiert seulement: actif + un téléphone valide.
    const empRows = await query(
      `SELECT id, nom, telephone, role FROM employees
        WHERE id = ANY($1::int[]) AND actif = TRUE
          AND role IN ('sous-traitant','installateur','aide')
          AND telephone IS NOT NULL AND TRIM(telephone) != ''`,
      [employeeIds]
    );
    if (!empRows.length) {
      console.warn(`[worker-reminders] booking #${r.booking_id} a des assignés mais aucun employé actif avec téléphone+rôle valide`);
      continue;
    }

    const client = String(r.client_nom ?? 'Client');
    const adresse = String(r.client_adresse ?? 'adresse à confirmer');
    const service = String(r.type_service ?? '');
    const sf = r.superficie ? `${r.superficie} pi²` : '';
    const slot = String(r.jour1_slot ?? 'matin');
    const slotLabel = slot === 'matin' ? '8h' : '13h';

    for (const emp of empRows) {
      const e = emp as Record<string, unknown>;
      const tel = String(e.telephone ?? '').replace(/\D/g, '');
      if (tel.length < 10) continue;
      const nom = String(e.nom ?? '').split(' ')[0];
      const msg = `Salut ${nom}! Rappel chantier demain ${slotLabel} chez ${client} — ${adresse}. Service: ${service} ${sf}. Tout le matériel prêt? — Luca/Jason`;
      try {
        await sendSMS(tel, msg, undefined, true);
        smsSent++;
      } catch (err) {
        console.error('Worker reminder SMS failed:', err);
      }
    }

    await query(`UPDATE bookings SET rappel_workers_sent = TRUE WHERE id = $1`, [r.booking_id]);
    bookingsProcessed++;
  }

  // Telegram summary
  if (bookingsProcessed > 0) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatIds = getAdminChatIds();
    if (botToken && chatIds.length) {
      const msg = `📋 <b>Rappels sous-traitants envoyés</b>\n\n${bookingsProcessed} chantier(s) demain — ${smsSent} SMS expédiés.`;
      await Promise.all(chatIds.map(id =>
        fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: id.trim(), text: msg, parse_mode: 'HTML' }),
        }).catch(() => {})
      ));
    }
  }

  return NextResponse.json({ ok: true, bookings: bookingsProcessed, sms_sent: smsSent });
}
