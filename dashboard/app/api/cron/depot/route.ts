import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { sendSMS } from '@/lib/sms';
import { formatMoney } from '@/lib/pricing';

// Vercel Cron — runs daily at 2PM UTC to send deposit reminders
// - 24h-48h after contract signed: send reminder
// - >48h after contract signed: send final warning
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  if (!cronSecret || !authHeader || cronSecret !== authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? 'onboarding@resend.dev';

  let remindersSent = 0;
  let warningsSent = 0;

  // Reminder: 24h-48h after contract signed, still no deposit
  const reminders = await query(
    `SELECT id, client_nom, client_email, client_tel, total, depot_requis
     FROM quotes
     WHERE statut = 'contrat_signe'
       AND contrat_signe_at <= NOW() - INTERVAL '24 hours'
       AND contrat_signe_at > NOW() - INTERVAL '48 hours'`,
    []
  );

  for (const q of reminders) {
    const depot = formatMoney(Number(q.depot_requis));

    // Send reminder SMS
    if (q.client_tel) {
      await sendSMS(
        q.client_tel as string,
        `Novus Epoxy: Rappel! Votre contrat #${q.id} est signe. Veuillez effectuer le depot de ${depot} dans les prochaines 24h pour confirmer vos dates. Virement Interac: gestionnovusepoxy@gmail.com`
      ).catch(() => {});
    }

    // Send reminder email
    if (apiKey && q.client_email) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from,
            to: [q.client_email as string],
            subject: `Rappel: depot requis — Novus Epoxy #${q.id}`,
            html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
<h2 style="color:#1e293b;">Rappel: depot requis</h2>
<p>Bonjour ${q.client_nom},</p>
<p>Votre contrat est signe! Pour confirmer vos dates de travaux, veuillez effectuer le depot de <strong>${depot}</strong> dans les prochaines 24 heures.</p>
<div style="background:#fffbeb;border:1px solid #f59e0b;border-radius:8px;padding:16px;margin:16px 0;">
<p style="margin:0 0 4px;font-weight:700;color:#92400e;">Modes de paiement:</p>
<p style="margin:2px 0;color:#78716c;font-size:13px;">Virement Interac: gestionnovusepoxy@gmail.com</p>
<p style="margin:2px 0;color:#78716c;font-size:13px;">Cheque a l'ordre de Novus Epoxy</p>
</div>
<p style="color:#64748b;font-size:13px;">Questions? Appelez-nous: 581-307-2678</p>
</div>`,
          }),
        });
      } catch (err) { console.error('Deposit reminder email failed:', err); }
    }

    remindersSent++;
  }

  // Final warning: >48h after contract signed, still no deposit
  const warnings = await query(
    `SELECT id, client_nom, client_email, client_tel, total, depot_requis
     FROM quotes
     WHERE statut = 'contrat_signe'
       AND contrat_signe_at <= NOW() - INTERVAL '48 hours'`,
    []
  );

  for (const q of warnings) {
    const depot = formatMoney(Number(q.depot_requis));

    // Send warning SMS
    if (q.client_tel) {
      await sendSMS(
        q.client_tel as string,
        `Novus Epoxy: Dernier rappel pour le devis #${q.id}. Le delai de 48h est depasse. Vos dates pourraient etre attribuees a un autre client. Depot requis: ${depot}. Virement Interac: gestionnovusepoxy@gmail.com ou appelez 581-307-2678`
      ).catch(() => {});
    }

    // Send warning email
    if (apiKey && q.client_email) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from,
            to: [q.client_email as string],
            subject: `Dernier rappel: vos dates pourraient etre attribuees — Novus Epoxy #${q.id}`,
            html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
<h2 style="color:#dc2626;">Dernier rappel: depot requis</h2>
<p>Bonjour ${q.client_nom},</p>
<p>Le delai de 48 heures pour le depot de votre devis #${q.id} est depasse. <strong>Vos dates de travaux pourraient etre attribuees a un autre client</strong> si le depot de ${depot} n'est pas recu rapidement.</p>
<div style="background:#fef2f2;border:1px solid #dc2626;border-radius:8px;padding:16px;margin:16px 0;">
<p style="margin:0 0 4px;font-weight:700;color:#991b1b;">Pour conserver vos dates:</p>
<p style="margin:2px 0;color:#78716c;font-size:13px;">Virement Interac: gestionnovusepoxy@gmail.com</p>
<p style="margin:2px 0;color:#78716c;font-size:13px;">Cheque a l'ordre de Novus Epoxy</p>
</div>
<p style="color:#64748b;font-size:13px;">Questions? Appelez-nous: 581-307-2678</p>
</div>`,
          }),
        });
      } catch (err) { console.error('Deposit warning email failed:', err); }
    }

    warningsSent++;
  }

  return NextResponse.json({
    ok: true,
    reminders_sent: remindersSent,
    warnings_sent: warningsSent,
  });
}
