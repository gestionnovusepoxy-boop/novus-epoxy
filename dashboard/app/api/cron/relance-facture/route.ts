import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { formatMoney } from '@/lib/pricing';
import { escapeHtml } from '@/lib/utils';
import { sendEmail } from '@/lib/send-email';
import { sendSMS } from '@/lib/sms';
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

function buildReminderEmail(clientNom: string, numero: string, finalMontant: number): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f8fafc;">
<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
<div style="background:#0f172a;padding:24px;text-align:center;border-radius:8px 8px 0 0;">
  <img src="https://novus-epoxy.vercel.app/logo-email.jpg" alt="Novus Epoxy" width="80" height="80" style="border-radius:12px;" />
  <h1 style="color:#f59e0b;margin:12px 0 0;font-size:22px;font-weight:700;">Novus Epoxy</h1>
  <p style="color:#94a3b8;margin:4px 0 0;font-size:13px;">Planchers époxy haut de gamme — Québec</p>
</div>
<div style="padding:24px;">
<h2 style="color:#1e293b;">Rappel de paiement — Facture ${escapeHtml(numero)}</h2>
<p>Bonjour ${escapeHtml(clientNom)},</p>
<p>Nous espérons que vous êtes satisfait de vos nouveaux planchers époxy!</p>
<p>Nous vous écrivons pour vous rappeler que le solde de votre facture <strong>${escapeHtml(numero)}</strong> est de <strong>${formatMoney(finalMontant)}</strong>.</p>
<div style="background:#fffbeb;border:1px solid #f59e0b;border-radius:8px;padding:16px;margin:16px 0;">
<p style="margin:0 0 4px;font-weight:700;color:#92400e;">Modes de paiement:</p>
<p style="margin:2px 0;color:#78716c;font-size:13px;">Virement Interac (0 frais): gestionnovusepoxy@gmail.com</p>
<p style="margin:2px 0;color:#78716c;font-size:13px;">Par téléphone: appelez Luca au 581-307-5983</p>
</div>
<p>N'hésitez pas à nous contacter si vous avez des questions.</p>
<p style="margin-top:20px;">Merci,<br/><strong>L'équipe Novus Epoxy</strong></p>
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
}

function buildUrgentReminderEmail(clientNom: string, numero: string, finalMontant: number): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f8fafc;">
<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
<div style="background:#0f172a;padding:24px;text-align:center;border-radius:8px 8px 0 0;">
  <img src="https://novus-epoxy.vercel.app/logo-email.jpg" alt="Novus Epoxy" width="80" height="80" style="border-radius:12px;" />
  <h1 style="color:#f59e0b;margin:12px 0 0;font-size:22px;font-weight:700;">Novus Epoxy</h1>
  <p style="color:#94a3b8;margin:4px 0 0;font-size:13px;">Planchers époxy haut de gamme — Québec</p>
</div>
<div style="padding:24px;">
<h2 style="color:#1e293b;">Rappel important — Facture ${escapeHtml(numero)}</h2>
<p>Bonjour ${escapeHtml(clientNom)},</p>
<p>Ceci est un rappel concernant le solde impayé de votre facture <strong>${escapeHtml(numero)}</strong> de <strong>${formatMoney(finalMontant)}</strong>.</p>
<p>Les travaux sur votre plancher époxy sont terminés depuis plus d'une semaine. Nous vous serions reconnaissants de procéder au paiement dans les meilleurs délais.</p>
<div style="background:#fef2f2;border:1px solid #ef4444;border-radius:8px;padding:16px;margin:16px 0;">
<p style="margin:0 0 4px;font-weight:700;color:#991b1b;">Paiement requis:</p>
<p style="margin:2px 0;color:#78716c;font-size:13px;">Virement Interac (0 frais): gestionnovusepoxy@gmail.com</p>
<p style="margin:2px 0;color:#78716c;font-size:13px;">Par téléphone: appelez Luca au 581-307-5983</p>
</div>
<p>Si vous avez déjà effectué le paiement, veuillez ignorer ce message.</p>
<p style="margin-top:20px;">Cordialement,<br/><strong>L'équipe Novus Epoxy</strong></p>
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
}

export const maxDuration = 60;

// Vercel Cron — runs daily at 11am UTC to send invoice payment reminders
// Stage 1: 3 days after jour2_date → email
// Stage 2: 7 days after jour2_date → email + SMS
// Stage 3: 14 days after jour2_date → Telegram alert to admins
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if (!authHeader || (authHeader !== cronSecret && authHeader !== adminKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (isQuietHours()) return NextResponse.json({ skipped: 'quiet hours' });

  let stage1Sent = 0;
  let stage2Sent = 0;
  let stage3Sent = 0;

  // Stage 1: 3+ days after jour2_date, no relance_facture_1_at yet
  const stage1 = await query(
    `SELECT inv.id, inv.numero, inv.final_montant, inv.quote_id,
            c.nom AS client_nom, c.email AS client_email, c.telephone AS client_tel
     FROM invoices inv
     JOIN clients c ON c.id = inv.client_id
     JOIN bookings b ON b.quote_id = inv.quote_id
     WHERE inv.depot_paye = true
       AND (inv.final_paye = false OR inv.final_paye IS NULL)
       AND inv.statut IN ('depot_recu', 'travaux_en_cours', 'en_cours')
       AND b.jour2_date <= NOW() - INTERVAL '3 days'
       AND inv.relance_facture_1_at IS NULL`,
    []
  );

  for (const inv of stage1) {
    const finalMontant = Number(inv.final_montant ?? 0);
    if (finalMontant <= 0) continue;

    try {
      if (inv.client_email) {
        await sendEmail({
          to: inv.client_email as string,
          subject: `Rappel de paiement — Facture Novus Epoxy ${inv.numero}`,
          html: buildReminderEmail(inv.client_nom as string, inv.numero as string, finalMontant),
        });
      }
      await query(`UPDATE invoices SET relance_facture_1_at = NOW() WHERE id = $1`, [inv.id]);
      stage1Sent++;
    } catch (err) {
      console.error(`relance-facture stage 1 error (invoice #${inv.id}):`, err);
    }
  }

  // Stage 2: 7+ days after jour2_date, stage 1 done, no relance_facture_2_at
  const stage2 = await query(
    `SELECT inv.id, inv.numero, inv.final_montant, inv.quote_id,
            c.nom AS client_nom, c.email AS client_email, c.telephone AS client_tel
     FROM invoices inv
     JOIN clients c ON c.id = inv.client_id
     JOIN bookings b ON b.quote_id = inv.quote_id
     WHERE inv.depot_paye = true
       AND (inv.final_paye = false OR inv.final_paye IS NULL)
       AND inv.statut IN ('depot_recu', 'travaux_en_cours', 'en_cours')
       AND b.jour2_date <= NOW() - INTERVAL '7 days'
       AND inv.relance_facture_1_at IS NOT NULL
       AND inv.relance_facture_2_at IS NULL`,
    []
  );

  for (const inv of stage2) {
    const finalMontant = Number(inv.final_montant ?? 0);
    if (finalMontant <= 0) continue;
    const prenom = (inv.client_nom as string).split(' ')[0];

    try {
      // Email
      if (inv.client_email) {
        await sendEmail({
          to: inv.client_email as string,
          subject: `Rappel important — Facture Novus Epoxy ${inv.numero}`,
          html: buildUrgentReminderEmail(inv.client_nom as string, inv.numero as string, finalMontant),
        });
      }

      // SMS
      if (inv.client_tel) {
        await sendSMS(
          inv.client_tel as string,
          `Bonjour ${prenom}, c'est Luca de Novus Epoxy. Petit rappel pour le solde de ${formatMoney(finalMontant)} sur ta facture ${inv.numero}. Virement Interac: gestionnovusepoxy@gmail.com ou appelle-moi au 581-307-5983. Merci!`
        ).catch(err => console.error(`relance-facture stage 2 SMS failed (invoice #${inv.id}):`, err));
      }

      await query(`UPDATE invoices SET relance_facture_2_at = NOW() WHERE id = $1`, [inv.id]);
      stage2Sent++;
    } catch (err) {
      console.error(`relance-facture stage 2 error (invoice #${inv.id}):`, err);
    }
  }

  // Stage 3: 14+ days after jour2_date, stage 2 done, no relance_facture_3_at
  const stage3 = await query(
    `SELECT inv.id, inv.numero, inv.final_montant, inv.quote_id,
            c.nom AS client_nom, c.email AS client_email, c.telephone AS client_tel
     FROM invoices inv
     JOIN clients c ON c.id = inv.client_id
     JOIN bookings b ON b.quote_id = inv.quote_id
     WHERE inv.depot_paye = true
       AND (inv.final_paye = false OR inv.final_paye IS NULL)
       AND inv.statut IN ('depot_recu', 'travaux_en_cours', 'en_cours')
       AND b.jour2_date <= NOW() - INTERVAL '14 days'
       AND inv.relance_facture_2_at IS NOT NULL
       AND inv.relance_facture_3_at IS NULL`,
    []
  );

  for (const inv of stage3) {
    const finalMontant = Number(inv.final_montant ?? 0);
    if (finalMontant <= 0) continue;

    try {
      const chatIds = ADMIN_CHAT_IDS();
      const msg = `FACTURE IMPAYEE — appeler le client\n\nFacture <b>${inv.numero}</b>\nClient: <b>${inv.client_nom}</b>\nTel: ${inv.client_tel ?? 'N/A'}\nEmail: ${inv.client_email ?? 'N/A'}\nSolde: <b>${formatMoney(finalMontant)}</b>\n\n14 jours depuis la fin des travaux. 2 relances envoyees sans reponse.`;
      for (const chatId of chatIds) {
        await sendTelegram(chatId, msg);
      }

      await query(`UPDATE invoices SET relance_facture_3_at = NOW() WHERE id = $1`, [inv.id]);
      stage3Sent++;
    } catch (err) {
      console.error(`relance-facture stage 3 error (invoice #${inv.id}):`, err);
    }
  }

  return NextResponse.json({
    ok: true,
    stage_1: { found: stage1.length, sent: stage1Sent },
    stage_2: { found: stage2.length, sent: stage2Sent },
    stage_3: { found: stage3.length, sent: stage3Sent },
  });
}
