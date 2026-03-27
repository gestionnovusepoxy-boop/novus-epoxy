import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { sendSMS } from '@/lib/sms';
import { formatMoney } from '@/lib/pricing';
import { escapeHtml } from '@/lib/utils';
import { sendEmail } from '@/lib/send-email';

// Vercel Cron — runs daily at 2PM UTC to send deposit reminders
// - 24h-48h after contract signed: send reminder
// - >48h after contract signed: send final warning
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  if (!cronSecret || !authHeader || cronSecret !== authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let remindersSent = 0;
  let warningsSent = 0;

  // Reminder: 24h-48h after contract signed — email seulement (pas de SMS, trop tôt)
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

    // Email only — no SMS at 24h
    if (q.client_email) {
      try {
        await sendEmail({
          to: q.client_email as string,
          subject: `Rappel: depot requis — Novus Epoxy #${q.id}`,
          html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
<h2 style="color:#1e293b;">Rappel: depot requis</h2>
<p>Bonjour ${escapeHtml(q.client_nom as string)},</p>
<p>Votre contrat est signe! Pour confirmer vos dates de travaux, veuillez effectuer le depot de <strong>${depot}</strong>.</p>
<div style="background:#fffbeb;border:1px solid #f59e0b;border-radius:8px;padding:16px;margin:16px 0;">
<p style="margin:0 0 4px;font-weight:700;color:#92400e;">Modes de paiement:</p>
<p style="margin:2px 0;color:#78716c;font-size:13px;">Virement Interac (0 frais): gestionnovusepoxy@gmail.com</p>
<p style="margin:2px 0;color:#78716c;font-size:13px;">Carte de credit via le lien dans votre espace client</p>
</div>
<p style="color:#64748b;font-size:13px;">Questions? Appelez Luca: 581-307-5983</p>
</div>`,
        });
      } catch (err) { console.error('Deposit reminder email failed:', err); }
    }

    remindersSent++;
  }

  // 48h+ after contract signed — 1 seul SMS + email (dernier rappel)
  const warnings = await query(
    `SELECT id, client_nom, client_email, client_tel, total, depot_requis
     FROM quotes
     WHERE statut = 'contrat_signe'
       AND contrat_signe_at <= NOW() - INTERVAL '48 hours'
       AND contrat_signe_at > NOW() - INTERVAL '96 hours'`,
    []
  );

  for (const q of warnings) {
    const depot = formatMoney(Number(q.depot_requis));
    const prenom = (q.client_nom as string).split(' ')[0];

    // 1 seul SMS de rappel dépôt — avec numéro Luca
    if (q.client_tel) {
      await sendSMS(
        q.client_tel as string,
        `Salut ${prenom}! C'est Luca de Novus Epoxy. Ton contrat est signe mais on attend encore le depot de ${depot} pour confirmer tes dates. Virement Interac: gestionnovusepoxy@gmail.com. Appelle-moi si t'as des questions: 581-307-5983`
      ).catch(() => {});
    }

    // Email dernier rappel
    if (q.client_email) {
      try {
        await sendEmail({
          to: q.client_email as string,
          subject: `Rappel: depot requis pour confirmer vos dates — Novus Epoxy #${q.id}`,
          html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
<h2 style="color:#1e293b;">Rappel: depot requis</h2>
<p>Bonjour ${escapeHtml(q.client_nom as string)},</p>
<p>Votre contrat #${q.id} est signe, mais on attend encore le depot de <strong>${depot}</strong> pour confirmer vos dates de travaux.</p>
<div style="background:#fffbeb;border:1px solid #f59e0b;border-radius:8px;padding:16px;margin:16px 0;">
<p style="margin:0 0 4px;font-weight:700;color:#92400e;">Modes de paiement:</p>
<p style="margin:2px 0;color:#78716c;font-size:13px;">Virement Interac (0 frais): gestionnovusepoxy@gmail.com</p>
<p style="margin:2px 0;color:#78716c;font-size:13px;">Carte de credit via votre espace client</p>
</div>
<p style="color:#64748b;font-size:13px;">Questions? Appelez Luca: 581-307-5983</p>
</div>`,
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
