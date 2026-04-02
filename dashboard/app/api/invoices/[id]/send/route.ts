import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { SERVICES, formatMoney, type ServiceType } from '@/lib/pricing';
import { escapeHtml } from '@/lib/utils';
import { sendEmail } from '@/lib/send-email';
import { sendSMS } from '@/lib/sms';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // Auth: session OR API key (for internal auto-send from deposit confirmation)
  const session = await auth();
  const apiKey = _req.headers.get('x-api-key') ?? '';
  const validApiKey = process.env.ADMIN_API_KEY ?? '';
  if (!session && (!validApiKey || apiKey !== validApiKey)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const { id } = await params;
  const body = _req.headers.get('content-type')?.includes('json') ? await _req.json().catch(() => ({})) : {};
  const overrideEmail = (body as Record<string, unknown>).override_email as string ?? null;
  const smsOnly = !!(body as Record<string, unknown>).sms_only;

  const rows = await query(
    `SELECT inv.*, c.nom AS client_nom, c.email AS client_email,
            q.secret_token AS quote_token, q.id AS quote_id
     FROM invoices inv
     JOIN clients c ON c.id = inv.client_id
     LEFT JOIN quotes q ON q.id = inv.quote_id
     WHERE inv.id = $1`,
    [parseInt(id)],
  );
  const inv = rows[0];
  if (!inv) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 });

  const service = SERVICES[inv.type_service as ServiceType];
  const logoSrc = 'https://novus-epoxy.vercel.app/logo-email.jpg';
  const ts = Date.now();
  const depositPaid = !!inv.depot_paye;
  const solde = Number(inv.final_montant);

  // Build payment link via quote page if available
  const paymentLink = inv.quote_token
    ? `https://novus-epoxy.vercel.app/paiement/${inv.quote_id}?token=${encodeURIComponent(inv.quote_token as string)}`
    : null;

  let subject: string;
  let html: string;

  if (depositPaid && paymentLink) {
    // Balance payment email with Stripe link
    subject = `Novus Epoxy — Solde à payer ${formatMoney(solde)} (Facture ${inv.numero})`;
    html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#ffffff;">
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:16px;background:#ffffff;">
<table width="100%" cellpadding="0" cellspacing="0" style="border-bottom:2px solid #e2e8f0;margin-bottom:16px;"><tr>
<td style="padding:12px 0;text-align:center;">
<img src="${logoSrc}" alt="Novus Epoxy" width="100" height="100" style="border-radius:8px;" />
<p style="color:#64748b;margin:6px 0 0;font-size:13px;">Planchers époxy haut de gamme</p>
</td></tr></table>
<h2 style="color:#1e293b;margin:0 0 12px;font-size:20px;">Solde à payer — Facture ${escapeHtml(inv.numero as string)}</h2>
<p style="margin:0 0 4px;">Bonjour ${escapeHtml(inv.client_nom as string)},</p>
<p style="margin:0 0 16px;color:#475569;">Merci pour votre dépôt confirmé. Voici le récapitulatif de votre solde final :</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:8px 0;color:#64748b;font-size:14px;">Service</td><td style="padding:8px 0;text-align:right;font-weight:600;font-size:14px;">${service.label}</td></tr>
<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:8px 0;color:#64748b;font-size:14px;">Total du projet</td><td style="padding:8px 0;text-align:right;font-size:14px;">${formatMoney(Number(inv.total))}</td></tr>
<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:8px 0;color:#16a34a;font-size:14px;">Dépôt reçu ✓</td><td style="padding:8px 0;text-align:right;font-size:14px;color:#16a34a;">-${formatMoney(Number(inv.depot_montant))}</td></tr>
<tr style="border-bottom:2px solid #1e293b;"><td style="padding:10px 0;font-weight:700;font-size:17px;">Solde à payer</td><td style="padding:10px 0;text-align:right;font-weight:700;font-size:17px;color:#dc2626;">${formatMoney(solde)}</td></tr>
</table>
<div style="text-align:center;margin:0 0 12px;">
<a href="${paymentLink}" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:16px 40px;border-radius:8px;text-decoration:none;font-weight:700;font-size:17px;">
  Payer mon solde — ${formatMoney(solde)}
</a>
</div>
<p style="text-align:center;color:#64748b;font-size:12px;margin:0 0 16px;">Virement Interac (0$ de frais) ou carte de crédit (3% frais) — votre choix sur la page de paiement.</p>
<div style="background:#f1f5f9;border-radius:6px;padding:10px;font-size:12px;color:#475569;">
<strong>Facturation :</strong> Luca — <a href="tel:5813075983" style="color:#2563eb;">581-307-5983</a><br/>
<strong>Chantier :</strong> Jason — <a href="tel:5813072678" style="color:#2563eb;">581-307-2678</a>
</div>
<p style="color:#94a3b8;font-size:11px;margin:8px 0 0;">Ref: ${ts}</p>
</div>
</body></html>`;
  } else {
    // Initial invoice email (deposit not yet paid)
    subject = `Facture ${inv.numero} — Novus Epoxy`;
    html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#ffffff;">
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:16px;background:#ffffff;">
<table width="100%" cellpadding="0" cellspacing="0" style="border-bottom:2px solid #e2e8f0;margin-bottom:16px;"><tr>
<td style="padding:12px 0;text-align:center;">
<img src="${logoSrc}" alt="Novus Epoxy" width="100" height="100" style="border-radius:8px;" />
<p style="color:#64748b;margin:6px 0 0;font-size:13px;">Planchers époxy haut de gamme</p>
</td></tr></table>
<h2 style="color:#1e293b;margin:0 0 12px;font-size:20px;">Facture ${escapeHtml(inv.numero as string)}</h2>
<p style="margin:0 0 4px;">Bonjour ${escapeHtml(inv.client_nom as string)},</p>
<p style="margin:0 0 16px;color:#475569;">Veuillez trouver ci-dessous le détail de votre facture :</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:8px 0;color:#64748b;font-size:14px;">Service</td><td style="padding:8px 0;text-align:right;font-weight:600;font-size:14px;">${service.label}</td></tr>
<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:8px 0;color:#64748b;font-size:14px;">Superficie</td><td style="padding:8px 0;text-align:right;font-size:14px;">${inv.superficie} pi²</td></tr>
<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:8px 0;color:#64748b;font-size:14px;">Sous-total</td><td style="padding:8px 0;text-align:right;font-size:14px;">${formatMoney(Number(inv.sous_total))}</td></tr>
<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:8px 0;color:#64748b;font-size:14px;">TPS (5%)</td><td style="padding:8px 0;text-align:right;font-size:14px;">${formatMoney(Number(inv.tps))}</td></tr>
<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:8px 0;color:#64748b;font-size:14px;">TVQ (9,975%)</td><td style="padding:8px 0;text-align:right;font-size:14px;">${formatMoney(Number(inv.tvq))}</td></tr>
<tr style="border-bottom:2px solid #1e293b;"><td style="padding:10px 0;font-weight:700;font-size:17px;">Total</td><td style="padding:10px 0;text-align:right;font-weight:700;font-size:17px;">${formatMoney(Number(inv.total))}</td></tr>
</table>
<div style="background:#fffbeb;border:1px solid #f59e0b;border-radius:6px;padding:12px;margin:0 0 16px;">
<p style="margin:0 0 4px;color:#92400e;font-weight:700;">Dépôt (30%) : ${formatMoney(Number(inv.depot_montant))}</p>
<p style="margin:0;color:#64748b;font-size:13px;">Solde à la fin des travaux : ${formatMoney(Number(inv.final_montant))}</p>
</div>
${paymentLink ? `<div style="text-align:center;margin:0 0 16px;"><a href="${paymentLink}" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:16px 40px;border-radius:8px;text-decoration:none;font-weight:700;font-size:17px;">Voir ma facture et payer</a></div>` : ''}
<div style="background:#f1f5f9;border-radius:6px;padding:10px;font-size:12px;color:#475569;">
<strong>Facturation :</strong> Luca — <a href="tel:5813075983" style="color:#2563eb;">581-307-5983</a><br/>
<strong>Chantier :</strong> Jason — <a href="tel:5813072678" style="color:#2563eb;">581-307-2678</a>
</div>
<p style="color:#94a3b8;font-size:11px;margin:8px 0 0;">Ref: ${ts}</p>
</div>
</body></html>`;
  }

  const sendTo = overrideEmail ?? (inv.client_email as string);
  const clientTel = inv.client_tel as string | null;

  // Build SMS body (used for sms_only and alongside email)
  const prenom = (inv.client_nom as string).split(' ')[0];
  const smsBody = depositPaid && paymentLink
    ? `${prenom}, c'est Luca de Novus Epoxy! Les travaux sont termines. Voici votre lien pour payer le solde de ${formatMoney(solde)}: ${paymentLink}`
    : paymentLink
    ? `${prenom}, c'est Luca de Novus Epoxy! Votre facture est prete. Consultez-la et payez votre depot ici: ${paymentLink}`
    : `${prenom}, c'est Luca de Novus Epoxy! Votre facture ${inv.numero} est prete. Questions? 581-307-5983`;

  // SMS only — skip email
  if (smsOnly) {
    if (!clientTel) return NextResponse.json({ error: 'Pas de numero de telephone pour ce client' }, { status: 400 });
    const smsSent = await sendSMS(clientTel, smsBody);
    return NextResponse.json({ success: smsSent, sms_sent: smsSent });
  }

  let emailData: { id: string };
  try {
    emailData = await sendEmail({
      to: sendTo,
      subject,
      html,
      via: 'gmail',
    });
  } catch (err) {
    console.error('Gmail send error:', err);
    return NextResponse.json({ error: `Erreur envoi email: ${String(err)}` }, { status: 500 });
  }

  await query(
    `INSERT INTO email_logs (resend_id, destinataire, sujet, statut) VALUES ($1, $2, $3, $4)`,
    [emailData.id, sendTo, subject, 'sent'],
  );

  await query(`UPDATE invoices SET statut = 'envoyee' WHERE id = $1 AND statut = 'brouillon'`, [parseInt(id)]);

  // Also send SMS if client has a phone (not for test override emails)
  let smsSent = false;
  if (clientTel && !overrideEmail) {
    smsSent = await sendSMS(clientTel, smsBody);
  }

  return NextResponse.json({ success: true, email_id: emailData.id, sms_sent: smsSent, type: depositPaid ? 'balance' : 'invoice' });
}
