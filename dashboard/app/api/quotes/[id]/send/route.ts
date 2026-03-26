import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { SERVICES, type ServiceType, formatMoney } from '@/lib/pricing';
import { escapeHtml } from '@/lib/utils';
import { sendEmail } from '@/lib/send-email';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const rows = await query('SELECT * FROM quotes WHERE id = $1', [parseInt(id)]);
  const quote = rows[0];
  if (!quote) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });

  const allowedStatuts = ['approuve', 'envoye', 'contrat_signe', 'depot_paye', 'planifie'];
  if (!allowedStatuts.includes(quote.statut as string)) {
    return NextResponse.json({ error: 'Statut invalide pour envoi email' }, { status: 400 });
  }

  // Anti-double-envoi: bloquer si envoyé dans les 60 dernières secondes
  if (quote.sent_at) {
    const secondsSince = (Date.now() - new Date(quote.sent_at as string).getTime()) / 1000;
    if (secondsSince < 60) {
      return NextResponse.json({ error: 'Email déjà envoyé il y a moins de 60 secondes' }, { status: 429 });
    }
  }

  const service = SERVICES[quote.type_service as ServiceType];
  const secretToken = quote.secret_token as string;

  const logoSrc = 'https://novus-epoxy.vercel.app/logo-email.jpg';

  const solde70 = formatMoney(Number(quote.total) - Number(quote.depot_requis));
  const ts = Date.now();

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#ffffff;">
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:16px;background:#ffffff;">
<table width="100%" cellpadding="0" cellspacing="0" style="border-bottom:2px solid #e2e8f0;margin-bottom:16px;"><tr>
<td style="padding:12px 0;text-align:center;">
<img src="${logoSrc}" alt="Novus Epoxy" width="100" height="100" style="border-radius:8px;" />
<p style="color:#64748b;margin:6px 0 0;font-size:13px;">Planchers époxy haut de gamme</p>
</td></tr></table>
<h2 style="color:#1e293b;margin:0 0 12px;font-size:20px;">Soumission #${quote.id}</h2>
<p style="margin:0 0 4px;">Bonjour ${escapeHtml(quote.client_nom as string)},</p>
<p style="margin:0 0 12px;color:#475569;">Voici votre soumission :</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;">
<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:6px 0;color:#64748b;font-size:14px;">Service</td><td style="padding:6px 0;text-align:right;font-weight:600;font-size:14px;">${service.label}</td></tr>
<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:6px 0;color:#64748b;font-size:14px;">Superficie</td><td style="padding:6px 0;text-align:right;font-size:14px;">${quote.superficie} pi²</td></tr>
<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:6px 0;color:#64748b;font-size:14px;">Prix/pi²</td><td style="padding:6px 0;text-align:right;font-size:14px;">${formatMoney(Number(quote.prix_pied_carre))}</td></tr>
${Number(quote.rabais_pct) > 0 ? `<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:6px 0;color:#16a34a;font-size:14px;font-weight:600;">Rabais Avril ${quote.rabais_pct}% 🎉</td><td style="padding:6px 0;text-align:right;font-size:14px;color:#16a34a;font-weight:600;">-${formatMoney(Number(quote.rabais_montant))}</td></tr>` : ''}
<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:6px 0;color:#64748b;font-size:14px;">Sous-total</td><td style="padding:6px 0;text-align:right;font-size:14px;">${formatMoney(Number(quote.sous_total))}</td></tr>
<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:6px 0;color:#64748b;font-size:14px;">TPS (5%)</td><td style="padding:6px 0;text-align:right;font-size:14px;">${formatMoney(Number(quote.tps))}</td></tr>
<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:6px 0;color:#64748b;font-size:14px;">TVQ (9,975%)</td><td style="padding:6px 0;text-align:right;font-size:14px;">${formatMoney(Number(quote.tvq))}</td></tr>
<tr style="border-bottom:2px solid #1e293b;"><td style="padding:10px 0;font-weight:700;font-size:17px;">Total</td><td style="padding:10px 0;text-align:right;font-weight:700;font-size:17px;">${formatMoney(Number(quote.total))}</td></tr>
</table>
<div style="background:#fffbeb;border:1px solid #f59e0b;border-radius:6px;padding:12px;margin:0 0 12px;">
<p style="margin:0 0 4px;color:#92400e;font-weight:700;font-size:15px;">Dépôt (30%) : ${formatMoney(Number(quote.depot_requis))}</p>
<p style="margin:0 0 6px;color:#78716c;font-size:12px;">Le dépôt confirme votre réservation. Nous vous contacterons pour planifier les travaux.</p>
<p style="margin:0;color:#64748b;font-size:13px;border-top:1px dashed #d6d3d1;padding-top:6px;">Solde (70%) à la fin des travaux : <strong>${solde70}</strong></p>
</div>
<div style="background:#f1f5f9;border-radius:8px;padding:16px;margin:0 0 12px;">
<p style="margin:0 0 8px;color:#1e293b;font-weight:700;font-size:14px;">Comment proceder :</p>
<p style="margin:0 0 4px;color:#475569;font-size:13px;">1. Choisissez vos dates de travaux</p>
<p style="margin:0 0 4px;color:#475569;font-size:13px;">2. Signez le contrat</p>
<p style="margin:0;color:#475569;font-size:13px;">3. Confirmez avec le depot (30%)</p>
<p style="margin:8px 0 0;color:#94a3b8;font-size:12px;">Tout se fait sur une seule page — suivez les etapes a votre rythme.</p>
</div>
<div style="text-align:center;margin:0 0 12px;">
<a href="https://novus-epoxy.vercel.app/paiement/${quote.id}?token=${encodeURIComponent(secretToken)}"
   style="display:inline-block;background:#f59e0b;color:#0f172a;padding:16px 40px;border-radius:8px;text-decoration:none;font-weight:700;font-size:17px;">
  Voir ma soumission
</a>
</div>
<div style="background:#f1f5f9;border-radius:6px;padding:10px;margin:0 0 12px;font-size:12px;color:#475569;">
<strong>Facturation / Soumission :</strong> Luca — <a href="tel:5813075983" style="color:#2563eb;">581-307-5983</a><br/>
<strong>Chantier / Soumission :</strong> Jason — <a href="tel:5813072678" style="color:#2563eb;">581-307-2678</a>
</div>
<p style="color:#94a3b8;font-size:11px;margin:0;">Valide 30 jours. Ref: ${ts}</p>
</div>
</body></html>`;

  let emailData: { id: string };
  try {
    emailData = await sendEmail({
      to: quote.client_email as string,
      subject: `Soumission Novus Epoxy #${quote.id}`,
      html,
    });
  } catch (err) {
    console.error('Gmail send error:', err);
    return NextResponse.json({ error: `Erreur envoi email: ${String(err)}` }, { status: 500 });
  }

  await query(
    `INSERT INTO email_logs (resend_id, destinataire, sujet, submission_id) VALUES ($1, $2, $3, $4)`,
    [emailData.id, quote.client_email, `Soumission Novus Epoxy #${quote.id}`, null],
  );

  await query(`UPDATE quotes SET statut = 'envoye', sent_at = NOW() WHERE id = $1`, [parseInt(id)]);

  return NextResponse.json({ success: true, email_id: emailData.id });
}
