import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { formatMoney } from '@/lib/pricing';
import { sendFollowUpSMS } from '@/lib/sms';
import { escapeHtml } from '@/lib/utils';
import { sendEmail } from '@/lib/send-email';

export const maxDuration = 60;

// Vercel Cron — runs every 6 hours to send follow-ups on unanswered quotes
// Relance 1: 48h after sent
// Relance 2: 5 days after sent (SMS + email)
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if (!authHeader || (authHeader !== cronSecret && authHeader !== adminKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Find quotes sent but not responded to, with no relance or relance due
  // Relance 1: sent >= 48h ago, no relance_1_at
  const relance1 = await query(
    `SELECT id, client_nom, client_email, client_tel, total, depot_requis, sent_at
     FROM quotes
     WHERE statut = 'envoye'
       AND sent_at <= NOW() - INTERVAL '48 hours'
       AND relance_1_at IS NULL`,
    []
  );

  // Relance 2: sent >= 5 days ago, relance_1 done, no relance_2_at
  const relance2 = await query(
    `SELECT id, client_nom, client_email, client_tel, total, depot_requis, sent_at
     FROM quotes
     WHERE statut = 'envoye'
       AND sent_at <= NOW() - INTERVAL '5 days'
       AND relance_1_at IS NOT NULL
       AND relance_2_at IS NULL`,
    []
  );

  let sent1 = 0;
  let sent2 = 0;

  // Send relance 1 — gentle email reminder
  for (const q of relance1) {
    const html =`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;">
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
<p>Bonjour ${escapeHtml(q.client_nom as string)},</p>
<p>On voulait s'assurer que vous avez bien recu notre soumission #${q.id} pour votre projet de plancher epoxy.</p>
<p>Le total est de <strong>${formatMoney(Number(q.total))}</strong> avec un depot de ${formatMoney(Number(q.depot_requis))} pour confirmer la reservation.</p>
<p>Si vous avez des questions ou souhaitez ajuster quelque chose, n'hesitez pas a nous repondre directement a ce courriel!</p>
<p style="margin-top:20px;">Bonne journee,<br/><strong>L'equipe Novus Epoxy</strong></p>
<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;" />
<p style="color:#94a3b8;font-size:12px;">Novus Epoxy — Planchers epoxy haut de gamme<br/>novusepoxy.ca</p>
</div></body></html>`;

    try {
      await sendEmail({ to: q.client_email as string, subject: `Suivi — Soumission Novus Epoxy #${q.id}`, html });
      await query(`UPDATE quotes SET relance_1_at = NOW() WHERE id = $1`, [q.id]);
      sent1++;
    } catch (err) {
      console.error('Relance 1 error:', err);
    }
  }

  // Send relance 2 — email + SMS
  for (const q of relance2) {
    const html =`<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;">
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
<p>Bonjour ${escapeHtml(q.client_nom as string)},</p>
<p>C'est un dernier rappel concernant votre soumission #${q.id} de <strong>${formatMoney(Number(q.total))}</strong>.</p>
<p>Notre calendrier se remplit vite — si vous souhaitez planifier vos travaux prochainement, c'est le bon moment pour confirmer!</p>
<p>Pour toute question:<br/>
<strong>Facturation:</strong> Luca — <a href="tel:5813075983">581-307-5983</a><br/>
<strong>Travaux:</strong> Jason Lanthier — <a href="tel:5813072678">581-307-2678</a></p>
<p>Au plaisir,<br/><strong>L'equipe Novus Epoxy</strong></p>
<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;" />
<p style="color:#94a3b8;font-size:12px;">Novus Epoxy — Planchers epoxy haut de gamme<br/>novusepoxy.ca</p>
</div></body></html>`;

    try {
      await sendEmail({ to: q.client_email as string, subject: `Rappel — Votre soumission Novus Epoxy #${q.id}`, html });
      await query(`UPDATE quotes SET relance_2_at = NOW() WHERE id = $1`, [q.id]);
      sent2++;

      // SMS relance — 1 seul SMS avec numéro Luca
      if (q.client_tel) {
        await sendFollowUpSMS(q.client_tel as string, q.client_nom as string, q.id as number)
          .catch(err => console.error('Relance 2 SMS failed:', err));
      }
    } catch (err) {
      console.error('Relance 2 error:', err);
    }
  }

  return NextResponse.json({
    ok: true,
    relance_1: { found: relance1.length, sent: sent1 },
    relance_2: { found: relance2.length, sent: sent2 },
  });
}
