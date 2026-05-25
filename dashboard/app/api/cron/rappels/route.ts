import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { sendSMS } from '@/lib/sms';
import { escapeHtml } from '@/lib/utils';
import { sendEmail } from '@/lib/send-email';

export const maxDuration = 60;

// Vercel Cron — runs every 6 hours to send 24h reminders before work appointments
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if (!authHeader || (authHeader !== cronSecret && authHeader !== adminKey)) {
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
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f8fafc;">
<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
<div style="background:#0f172a;padding:24px;text-align:center;border-radius:8px 8px 0 0;">
  <img src="https://novus-epoxy.vercel.app/logo-email.jpg" alt="Novus Epoxy" width="80" height="80" style="border-radius:12px;" />
  <h1 style="color:#f59e0b;margin:12px 0 0;font-size:22px;font-weight:700;">Novus Epoxy</h1>
  <p style="color:#94a3b8;margin:4px 0 0;font-size:13px;">Planchers époxy haut de gamme — Québec</p>
</div>
<div style="padding:24px;">
<h2 style="color:#1e293b;margin:0 0 12px;">Rappel — Travaux demain matin!</h2>
<p>Bonjour ${escapeHtml(r.client_nom as string)},</p>
<p>Notre équipe sera chez vous <strong>demain matin à 8h</strong> pour la première étape de votre plancher époxy.</p>
<div style="background:#fffbeb;border:1px solid #f59e0b;border-radius:8px;padding:16px;margin:16px 0;">
<p style="margin:0 0 8px;font-weight:700;color:#92400e;">Préparation de l'espace:</p>
<p style="margin:0;color:#78716c;">Veuillez vider et dégager complètement la surface de travail avant notre arrivée. Merci!</p>
</div>
<p style="color:#475569;">Si vous avez des questions:<br/>
<strong>Jason Lanthier</strong> — <a href="tel:5813072678" style="color:#2563eb;">581-307-2678</a></p>
<p>À demain!<br/><strong>L'équipe Novus Epoxy</strong></p>
<div style="border-top:1px solid #e2e8f0;padding:16px 0 0;margin-top:20px;">
  <p style="color:#1e293b;font-weight:700;font-size:13px;margin:0 0 6px;">Une question? On est là pour vous.</p>
  <p style="color:#475569;font-size:13px;margin:0 0 2px;"><strong>Luca</strong> — Facturation / Soumission — <a href="tel:5813075983" style="color:#2563eb;">581-307-5983</a></p>
  <p style="color:#475569;font-size:13px;margin:0;"><strong>Jason</strong> — Chantier / Soumission — <a href="tel:5813072678" style="color:#2563eb;">581-307-2678</a></p>
</div>
</div>
<div style="background:#f1f5f9;padding:12px 24px;text-align:center;border-radius:0 0 8px 8px;">
  <p style="color:#94a3b8;font-size:11px;margin:0;">Novus Epoxy — 44 rue de la Polyvalente, Québec, G2N 1G8</p>
</div>
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
        `Salut ${prenom}! C'est Luca de Novus Epoxy. L'équipe sera chez toi demain matin à 8h. Pense à vider la surface de travail avant notre arrivée. À demain! Questions: 581-307-5983`
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
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f8fafc;">
<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
<div style="background:#0f172a;padding:24px;text-align:center;border-radius:8px 8px 0 0;">
  <img src="https://novus-epoxy.vercel.app/logo-email.jpg" alt="Novus Epoxy" width="80" height="80" style="border-radius:12px;" />
  <h1 style="color:#f59e0b;margin:12px 0 0;font-size:22px;font-weight:700;">Novus Epoxy</h1>
  <p style="color:#94a3b8;margin:4px 0 0;font-size:13px;">Planchers époxy haut de gamme — Québec</p>
</div>
<div style="padding:24px;">
<h2 style="color:#1e293b;margin:0 0 12px;">Rappel — Finition ${periode}!</h2>
<p>Bonjour ${escapeHtml(r.client_nom as string)},</p>
<p>Notre équipe revient <strong>${periode} à ${heures}</strong> pour la finition de votre plancher époxy.</p>
<p style="color:#475569;">Si vous avez des questions:<br/>
<strong>Jason Lanthier</strong> — <a href="tel:5813072678" style="color:#2563eb;">581-307-2678</a></p>
<p>À demain!<br/><strong>L'équipe Novus Epoxy</strong></p>
<div style="border-top:1px solid #e2e8f0;padding:16px 0 0;margin-top:20px;">
  <p style="color:#1e293b;font-weight:700;font-size:13px;margin:0 0 6px;">Une question? On est là pour vous.</p>
  <p style="color:#475569;font-size:13px;margin:0 0 2px;"><strong>Luca</strong> — Facturation / Soumission — <a href="tel:5813075983" style="color:#2563eb;">581-307-5983</a></p>
  <p style="color:#475569;font-size:13px;margin:0;"><strong>Jason</strong> — Chantier / Soumission — <a href="tel:5813072678" style="color:#2563eb;">581-307-2678</a></p>
</div>
</div>
<div style="background:#f1f5f9;padding:12px 24px;text-align:center;border-radius:0 0 8px 8px;">
  <p style="color:#94a3b8;font-size:11px;margin:0;">Novus Epoxy — 44 rue de la Polyvalente, Québec, G2N 1G8</p>
</div>
</div></body></html>`;

      try {
        await sendEmail({ to: r.client_email as string, subject: `Rappel — Finition ${periode} — Novus Epoxy`, html });
      } catch (err) { console.error('Reminder jour2 email failed:', err); }
    }

    // SMS jour 2 — important: client doit être à la maison pour la finition + 72h d'éviction
    if (r.client_tel) {
      const prenom = (r.client_nom as string).split(' ')[0];
      await sendSMS(
        r.client_tel as string,
        `Salut ${prenom}! C'est Luca de Novus Epoxy. L'équipe arrive ${periode} à ${heures} pour la finition de ton plancher. Important: prévoir 72h avant de marcher dessus après les travaux. Questions: 581-307-5983`
      ).catch(err => console.error('Reminder jour2 SMS failed:', err));
    }

    await query(`UPDATE bookings SET rappel_jour2_sent = TRUE WHERE id = $1`, [r.booking_id]);
    rappelsJour2++;
  }

  return NextResponse.json({
    ok: true,
    rappels_jour1: rappelsJour1,
    rappels_jour2: rappelsJour2,
  });
}
