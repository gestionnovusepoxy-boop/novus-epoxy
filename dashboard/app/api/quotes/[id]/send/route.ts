import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { SERVICES, type ServiceType, formatMoney } from '@/lib/pricing';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const rows = await query('SELECT * FROM quotes WHERE id = $1', [parseInt(id)]);
  const quote = rows[0];
  if (!quote) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });

  if (quote.statut !== 'approuve') {
    return NextResponse.json({ error: 'Le devis doit être approuvé avant envoi' }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? 'onboarding@resend.dev';

  if (!apiKey) {
    return NextResponse.json({ error: 'RESEND_API_KEY manquant' }, { status: 500 });
  }

  const service = SERVICES[quote.type_service as ServiceType];

  // Logo en CID pour affichage direct (sans cliquer "Afficher les images")
  let logoBase64 = '';
  try {
    logoBase64 = readFileSync(join(process.cwd(), 'public', 'logo-email.jpg')).toString('base64');
  } catch { /* fallback to hosted URL */ }

  const logoSrc = logoBase64 ? 'cid:logo@novusepoxy' : 'https://novus-epoxy.vercel.app/logo-email.jpg';

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
<p style="margin:0 0 4px;">Bonjour ${quote.client_nom},</p>
<p style="margin:0 0 12px;color:#475569;">Voici votre soumission :</p>
<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;">
<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:6px 0;color:#64748b;font-size:14px;">Service</td><td style="padding:6px 0;text-align:right;font-weight:600;font-size:14px;">${service.label}</td></tr>
<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:6px 0;color:#64748b;font-size:14px;">Superficie</td><td style="padding:6px 0;text-align:right;font-size:14px;">${quote.superficie} pi²</td></tr>
<tr style="border-bottom:1px solid #e2e8f0;"><td style="padding:6px 0;color:#64748b;font-size:14px;">Prix/pi²</td><td style="padding:6px 0;text-align:right;font-size:14px;">${formatMoney(Number(quote.prix_pied_carre))}</td></tr>
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
<div style="background:#f1f5f9;border-radius:6px;padding:10px;margin:0 0 12px;font-size:12px;color:#475569;">
<strong>Facturation :</strong> Luca — <a href="tel:5813075983" style="color:#2563eb;">581-307-5983</a><br/>
<strong>Travaux :</strong> Jason Lanthier — <a href="tel:5813072678" style="color:#2563eb;">581-307-2678</a>
</div>
<p style="color:#94a3b8;font-size:11px;margin:0;">Valide 30 jours. Ref: ${ts}</p>
</div>
</body></html>`;

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [quote.client_email as string],
      subject: `Soumission Novus Epoxy #${quote.id}`,
      html,
      ...(logoBase64 ? {
        attachments: [{
          content: logoBase64,
          filename: 'logo.jpg',
          content_type: 'image/jpeg',
          content_id: 'logo@novusepoxy',
        }],
      } : {}),
    }),
  });

  if (!emailRes.ok) {
    const err = await emailRes.text();
    console.error('Resend error:', err, 'from:', from, 'to:', quote.client_email);
    return NextResponse.json({ error: `Erreur Resend: ${err}` }, { status: 500 });
  }

  const emailData = await emailRes.json();

  await query(
    `INSERT INTO email_logs (resend_id, destinataire, sujet, submission_id) VALUES ($1, $2, $3, $4)`,
    [emailData.id, quote.client_email, `Soumission Novus Epoxy #${quote.id}`, null],
  );

  await query(`UPDATE quotes SET statut = 'envoye', sent_at = NOW() WHERE id = $1`, [parseInt(id)]);

  return NextResponse.json({ success: true, email_id: emailData.id });
}
