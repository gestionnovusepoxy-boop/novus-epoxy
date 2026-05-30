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

  // Pull quote_items + quote_extras + payments so the email is a TRUE invoice
  // (full breakdown + payments received + actual remaining — never the stale static final_montant).
  const [itemRows, extraRows, paymentRows] = await Promise.all([
    inv.quote_id ? query(
      `SELECT type_service, superficie, prix_pied_carre, sous_total, description FROM quote_items WHERE quote_id = $1 ORDER BY sort_order, id`,
      [inv.quote_id]
    ).catch(() => []) : Promise.resolve([]),
    inv.quote_id ? query(
      `SELECT description, quantite, prix_unitaire, sous_total FROM quote_extras WHERE quote_id = $1 ORDER BY sort_order, id`,
      [inv.quote_id]
    ).catch(() => []) : Promise.resolve([]),
    query(
      `SELECT type, montant, methode, paid_at FROM payments WHERE invoice_id = $1 ORDER BY paid_at`,
      [parseInt(id)]
    ).catch(() => []),
  ]) as [Array<Record<string, unknown>>, Array<Record<string, unknown>>, Array<{ type: string; montant: string | number; methode: string | null; paid_at: Date }>];

  const service = SERVICES[inv.type_service as ServiceType];
  const logoSrc = 'https://novus-epoxy.vercel.app/logo-email.jpg';
  const ts = Date.now();
  const totalPaid = paymentRows.reduce((s, p) => s + Number(p.montant), 0);
  const remaining = Math.max(0, Number(inv.total) - totalPaid);
  const fullyPaid = remaining < 0.01;
  const TAX_NUMBERS_FOOTER = 'RBQ : 5861-8471-01  ·  No TPS : 704712017 RT0001  ·  No TVQ : 1231257078 TQ0001';
  const isForfait = Number(inv.prix_pied_carre) === 0 && Number(inv.superficie) === 0;
  const PAY_LABEL: Record<string, string> = { depot: 'Dépôt', partial: 'Paiement partiel', partiel: 'Paiement partiel', final: 'Solde final' };
  const METHOD_LABEL: Record<string, string> = { virement: 'Virement Interac', cheque: 'Chèque', comptant: 'Comptant', autre: 'Autre' };
  const formatDateFr = (d: Date) => d.toISOString().slice(0, 10);

  // Build payment link via quote page if available
  const paymentLink = inv.quote_token
    ? `https://novus-epoxy.vercel.app/paiement/${inv.quote_id}?token=${encodeURIComponent(inv.quote_token as string)}`
    : null;

  // Single unified template: real invoice with full breakdown + payments + remaining/paid badge.
  const subject = fullyPaid
    ? `Facture ${inv.numero} — PAYÉE — Novus Epoxy`
    : `Facture ${inv.numero} — Novus Epoxy`;
  const paymentsHtml = paymentRows.length > 0
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border:1px solid #e2e8f0;border-radius:6px;">
<tr><td colspan="2" style="padding:10px 12px;background:#f1f5f9;font-weight:700;color:#1e293b;font-size:14px;">Paiements reçus</td></tr>
${paymentRows.map(p => `<tr style="border-top:1px solid #e2e8f0;"><td style="padding:8px 12px;color:#1e293b;font-size:13px;">${PAY_LABEL[p.type] ?? p.type} <span style="color:#94a3b8;">— ${METHOD_LABEL[p.methode ?? ''] ?? (p.methode ?? '')} · ${formatDateFr(p.paid_at)}</span></td><td style="padding:8px 12px;text-align:right;color:#16a34a;font-weight:600;font-size:13px;">✓ ${formatMoney(Number(p.montant))}</td></tr>`).join('')}
<tr style="border-top:2px solid #1e293b;"><td style="padding:10px 12px;font-weight:700;color:#1e293b;font-size:14px;">Total payé</td><td style="padding:10px 12px;text-align:right;font-weight:700;color:#16a34a;font-size:14px;">${formatMoney(totalPaid)}</td></tr>
</table>`
    : '';
  const statusBlock = fullyPaid
    ? `<div style="background:#dcfce7;border:2px solid #16a34a;border-radius:8px;padding:16px;text-align:center;margin:0 0 16px;">
<p style="margin:0;color:#166534;font-weight:700;font-size:18px;">✓ Facture payée en entier</p>
<p style="margin:4px 0 0;color:#15803d;font-size:13px;">Merci ${escapeHtml((inv.client_nom as string).split(' ')[0])}!</p>
</div>`
    : `<div style="background:#fffbeb;border:2px solid #f59e0b;border-radius:8px;padding:14px;text-align:center;margin:0 0 16px;">
<p style="margin:0;color:#92400e;font-weight:700;font-size:17px;">Reste à payer : ${formatMoney(remaining)}</p>
${paymentLink ? `<p style="margin:8px 0 0;"><a href="${paymentLink}" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:700;font-size:15px;">Payer maintenant</a></p>` : ''}
<p style="margin:8px 0 0;color:#64748b;font-size:11px;">Virement Interac (0$ frais), chèque ou comptant.</p>
</div>`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#ffffff;">
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:16px;background:#ffffff;">
<table width="100%" cellpadding="0" cellspacing="0" style="border-bottom:2px solid #e2e8f0;margin-bottom:16px;"><tr>
<td style="padding:12px 0;text-align:center;">
<img src="${logoSrc}" alt="Novus Epoxy" width="100" height="100" style="border-radius:8px;" />
<p style="color:#64748b;margin:6px 0 0;font-size:13px;">Planchers époxy haut de gamme</p>
</td></tr></table>
<h2 style="color:#1e293b;margin:0 0 12px;font-size:20px;">Facture ${escapeHtml(inv.numero as string)}</h2>
<p style="margin:0 0 4px;">Bonjour ${escapeHtml(inv.client_nom as string)},</p>
<p style="margin:0 0 16px;color:#475569;">Veuillez trouver le détail de votre facture :</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-collapse:collapse;">
${(() => {
  const rowsHtml: string[] = [];
  if (itemRows.length > 0) {
    for (const it of itemRows as Array<{ type_service: string; superficie: number; prix_pied_carre: number; sous_total: number; description: string | null }>) {
      const lbl = SERVICES[it.type_service as ServiceType]?.label ?? it.type_service;
      const qty = Number(it.superficie) > 0 ? `${it.superficie} pi² × ${formatMoney(Number(it.prix_pied_carre))}` : 'Forfait';
      rowsHtml.push(`<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:8px 0;color:#1e293b;font-size:14px;"><strong>${escapeHtml(lbl)}</strong>${it.description ? `<br/><span style="color:#64748b;font-size:12px;">${escapeHtml(it.description)}</span>` : ''}<br/><span style="color:#94a3b8;font-size:12px;">${qty}</span></td><td style="padding:8px 0;text-align:right;font-size:14px;vertical-align:top;">${formatMoney(Number(it.sous_total))}</td></tr>`);
    }
  } else {
    const qtyTxt = isForfait ? 'Forfait' : `${inv.superficie} pi² × ${formatMoney(Number(inv.prix_pied_carre))}`;
    rowsHtml.push(`<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:8px 0;color:#1e293b;font-size:14px;"><strong>${escapeHtml(service?.label ?? 'Travaux')}</strong><br/><span style="color:#94a3b8;font-size:12px;">${qtyTxt}</span></td><td style="padding:8px 0;text-align:right;font-size:14px;">${formatMoney(Number(inv.sous_total) + (Number(inv.rabais_montant) || 0))}</td></tr>`);
  }
  for (const ex of extraRows as Array<{ description: string; quantite: number; prix_unitaire: number; sous_total: number }>) {
    const qty = ex.quantite && Number(ex.quantite) !== 1 ? `${ex.quantite} × ${formatMoney(Number(ex.prix_unitaire))}` : '';
    rowsHtml.push(`<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:8px 0;color:#1e293b;font-size:14px;">${escapeHtml(ex.description)}${qty ? `<br/><span style="color:#94a3b8;font-size:12px;">${qty}</span>` : ''}</td><td style="padding:8px 0;text-align:right;font-size:14px;">${formatMoney(Number(ex.sous_total))}</td></tr>`);
  }
  return rowsHtml.join('');
})()}
${Number(inv.rabais_pct) > 0 ? `<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:8px 0;color:#16a34a;font-size:14px;font-weight:600;">Rabais ${inv.rabais_pct}%</td><td style="padding:8px 0;text-align:right;font-size:14px;color:#16a34a;font-weight:600;">-${formatMoney(Number(inv.rabais_montant))}</td></tr>` : ''}
<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:8px 0;color:#64748b;font-size:14px;">Sous-total</td><td style="padding:8px 0;text-align:right;font-size:14px;">${formatMoney(Number(inv.sous_total))}</td></tr>
<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:8px 0;color:#64748b;font-size:14px;">TPS (5%) <span style="color:#94a3b8;font-size:11px;">— No 704712017 RT0001</span></td><td style="padding:8px 0;text-align:right;font-size:14px;">${formatMoney(Number(inv.tps))}</td></tr>
<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:8px 0;color:#64748b;font-size:14px;">TVQ (9,975%) <span style="color:#94a3b8;font-size:11px;">— No 1231257078 TQ0001</span></td><td style="padding:8px 0;text-align:right;font-size:14px;">${formatMoney(Number(inv.tvq))}</td></tr>
<tr style="border-bottom:2px solid #1e293b;"><td style="padding:10px 0;font-weight:700;font-size:17px;">Total</td><td style="padding:10px 0;text-align:right;font-weight:700;font-size:17px;">${formatMoney(Number(inv.total))}</td></tr>
</table>
${paymentsHtml}
${statusBlock}
<div style="background:#f1f5f9;border-radius:6px;padding:10px;font-size:12px;color:#475569;">
<strong>Facturation :</strong> Luca — <a href="tel:5813075983" style="color:#2563eb;">581-307-5983</a><br/>
<strong>Chantier :</strong> Jason — <a href="tel:5813072678" style="color:#2563eb;">581-307-2678</a>
</div>
<p style="color:#94a3b8;font-size:11px;margin:8px 0 4px;text-align:center;">${TAX_NUMBERS_FOOTER}</p>
<p style="color:#94a3b8;font-size:11px;margin:0;">Ref: ${ts}</p>
</div>
</body></html>`;


  const sendTo = overrideEmail ?? (inv.client_email as string);
  const clientTel = inv.client_tel as string | null;

  // Build SMS body (used for sms_only and alongside email)
  const prenom = (inv.client_nom as string).split(' ')[0];
  const smsBody = fullyPaid
    ? `${prenom}, votre facture ${inv.numero} est payee en entier. Merci beaucoup! — Luca, Novus Epoxy`
    : paymentLink
    ? `${prenom}, c'est Luca de Novus Epoxy! Facture ${inv.numero} — reste a payer ${formatMoney(remaining)}: ${paymentLink}`
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
    `INSERT INTO email_logs (resend_id, destinataire, sujet, statut, html_body, direction) VALUES ($1, $2, $3, $4, $5, 'outbound')`,
    [emailData.id, sendTo, subject, 'sent', html],
  );

  await query(`UPDATE invoices SET statut = 'envoyee' WHERE id = $1 AND statut = 'brouillon'`, [parseInt(id)]);

  // Also send SMS if client has a phone (not for test override emails)
  let smsSent = false;
  if (clientTel && !overrideEmail) {
    smsSent = await sendSMS(clientTel, smsBody);
  }

  return NextResponse.json({ success: true, email_id: emailData.id, sms_sent: smsSent, type: fullyPaid ? 'paid_in_full' : 'invoice' });
}
