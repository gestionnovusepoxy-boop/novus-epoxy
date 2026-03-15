import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { SERVICES, type ServiceType, formatMoney } from '@/lib/pricing';

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

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <h1 style="color:#1e293b;">Novus Epoxy</h1>
      <h2 style="color:#475569;">Votre soumission #${quote.id}</h2>
      <p>Bonjour ${quote.client_nom},</p>
      <p>Voici le détail de votre soumission pour un plancher époxy :</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:8px 0;color:#64748b;">Service</td>
          <td style="padding:8px 0;text-align:right;font-weight:600;">${service.label}</td>
        </tr>
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:8px 0;color:#64748b;">Superficie</td>
          <td style="padding:8px 0;text-align:right;">${quote.superficie} pi²</td>
        </tr>
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:8px 0;color:#64748b;">Prix / pi²</td>
          <td style="padding:8px 0;text-align:right;">${formatMoney(Number(quote.prix_pied_carre))}</td>
        </tr>
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:8px 0;color:#64748b;">Sous-total</td>
          <td style="padding:8px 0;text-align:right;">${formatMoney(Number(quote.sous_total))}</td>
        </tr>
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:8px 0;color:#64748b;">TPS (5%)</td>
          <td style="padding:8px 0;text-align:right;">${formatMoney(Number(quote.tps))}</td>
        </tr>
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:8px 0;color:#64748b;">TVQ (9,975%)</td>
          <td style="padding:8px 0;text-align:right;">${formatMoney(Number(quote.tvq))}</td>
        </tr>
        <tr style="border-bottom:2px solid #1e293b;">
          <td style="padding:12px 0;font-weight:700;font-size:18px;">Total</td>
          <td style="padding:12px 0;text-align:right;font-weight:700;font-size:18px;">${formatMoney(Number(quote.total))}</td>
        </tr>
        <tr>
          <td style="padding:8px 0;color:#f59e0b;font-weight:600;">Dépôt requis (30%)</td>
          <td style="padding:8px 0;text-align:right;color:#f59e0b;font-weight:600;">${formatMoney(Number(quote.depot_requis))}</td>
        </tr>
      </table>
      <p style="color:#64748b;font-size:14px;">Cette soumission est valide pour 30 jours. Pour toute question, répondez à ce courriel.</p>
      <p style="margin-top:30px;">Merci de votre confiance,<br/><strong>Novus Epoxy</strong></p>
    </div>
  `;

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [quote.client_email as string],
      subject: `Soumission Novus Epoxy #${quote.id}`,
      html,
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
