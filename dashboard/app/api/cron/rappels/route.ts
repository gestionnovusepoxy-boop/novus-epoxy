import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { sendSMS } from '@/lib/sms';
import { escapeHtml } from '@/lib/utils';
import { sendEmail } from '@/lib/send-email';

// Vercel Cron — runs every 6 hours to send 24h reminders before work appointments
export async function GET(req: NextRequest) {
  // Verify cron secret (Vercel sets CRON_SECRET automatically for cron jobs)
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  if (!cronSecret || !authHeader || cronSecret !== authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let rappelsJour1 = 0;
  let rappelsJour2 = 0;

  // Reminder for Day 1: tomorrow morning
  const jour1Rows = await query(
    `SELECT b.id AS booking_id, b.jour1_date, q.client_nom, q.client_email, q.client_tel, q.client_adresse, q.id AS quote_id
     FROM bookings b
     JOIN quotes q ON q.id = b.quote_id
     WHERE b.statut = 'confirme'
       AND b.rappel_jour1_sent = FALSE
       AND b.jour1_date = CURRENT_DATE + INTERVAL '1 day'`,
    []
  );

  for (const r of jour1Rows) {
    // Email reminder
    {
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;">
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
<h2 style="color:#1e293b;margin:0 0 12px;">Rappel — Travaux demain matin!</h2>
<p>Bonjour ${escapeHtml(r.client_nom as string)},</p>
<p>Notre equipe sera chez vous <strong>demain matin a 8h</strong> pour la premiere etape de votre plancher epoxy.</p>
<div style="background:#fffbeb;border:1px solid #f59e0b;border-radius:8px;padding:16px;margin:16px 0;">
<p style="margin:0 0 8px;font-weight:700;color:#92400e;">Preparation de l'espace:</p>
<p style="margin:0;color:#78716c;">Veuillez vider et degager completement la surface de travail avant notre arrivee. Merci!</p>
</div>
<p style="color:#475569;">Si vous avez des questions:<br/>
<strong>Jason Lanthier</strong> — <a href="tel:5813072678" style="color:#2563eb;">581-307-2678</a></p>
<p>A demain!<br/><strong>L'equipe Novus Epoxy</strong></p>
</div></body></html>`;

      try {
        await sendEmail({ to: r.client_email as string, subject: `Rappel — Travaux demain matin — Novus Epoxy`, html });
      } catch (err) { console.error('Reminder jour1 email failed:', err); }
    }

    // SMS reminder jour 1 seulement
    if (r.client_tel) {
      const prenom = (r.client_nom as string).split(' ')[0];
      await sendSMS(
        r.client_tel as string,
        `Salut ${prenom}! C'est Luca de Novus Epoxy. L'equipe sera chez toi demain matin a 8h. Pense a vider la surface de travail avant notre arrivee. A demain! Questions: 581-307-5983`
      ).catch(err => console.error('Reminder jour1 SMS failed:', err));
    }

    await query(`UPDATE bookings SET rappel_jour1_sent = TRUE WHERE id = $1`, [r.booking_id]);
    rappelsJour1++;
  }

  // Reminder for Day 2: tomorrow
  const jour2Rows = await query(
    `SELECT b.id AS booking_id, b.jour2_date, b.jour2_slot, q.client_nom, q.client_email, q.client_tel, q.id AS quote_id
     FROM bookings b
     JOIN quotes q ON q.id = b.quote_id
     WHERE b.statut = 'confirme'
       AND b.rappel_jour2_sent = FALSE
       AND b.jour2_date = CURRENT_DATE + INTERVAL '1 day'`,
    []
  );

  for (const r of jour2Rows) {
    const heures = r.jour2_slot === 'matin' ? '8h' : '12h';
    const periode = r.jour2_slot === 'matin' ? 'demain matin' : 'demain apres-midi';

    {
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;">
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
<h2 style="color:#1e293b;margin:0 0 12px;">Rappel — Finition ${periode}!</h2>
<p>Bonjour ${escapeHtml(r.client_nom as string)},</p>
<p>Notre equipe revient <strong>${periode} a ${heures}</strong> pour la finition de votre plancher epoxy.</p>
<p style="color:#475569;">Si vous avez des questions:<br/>
<strong>Jason Lanthier</strong> — <a href="tel:5813072678" style="color:#2563eb;">581-307-2678</a></p>
<p>A demain!<br/><strong>L'equipe Novus Epoxy</strong></p>
</div></body></html>`;

      try {
        await sendEmail({ to: r.client_email as string, subject: `Rappel — Finition ${periode} — Novus Epoxy`, html });
      } catch (err) { console.error('Reminder jour2 email failed:', err); }
    }

    // Pas de SMS jour 2 — le client sait déjà, on évite le spam

    await query(`UPDATE bookings SET rappel_jour2_sent = TRUE WHERE id = $1`, [r.booking_id]);
    rappelsJour2++;
  }

  return NextResponse.json({
    ok: true,
    rappels_jour1: rappelsJour1,
    rappels_jour2: rappelsJour2,
  });
}
