import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { SERVICES, formatMoney, type ServiceType } from '@/lib/pricing';
import { escapeHtml } from '@/lib/utils';
import { sendEmail } from '@/lib/send-email';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const rows = await query(
    `SELECT inv.*, c.nom AS client_nom, c.email AS client_email
     FROM invoices inv JOIN clients c ON c.id = inv.client_id WHERE inv.id = $1`,
    [parseInt(id)],
  );
  const inv = rows[0];
  if (!inv) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 });


  const service = SERVICES[inv.type_service as ServiceType];

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <h1 style="color:#1e293b;">Novus Epoxy</h1>
      <h2 style="color:#475569;">Facture ${inv.numero}</h2>
      <p>Bonjour ${escapeHtml(inv.client_nom as string)},</p>
      <p>Veuillez trouver ci-dessous le détail de votre facture :</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:8px 0;color:#64748b;">Service</td>
          <td style="padding:8px 0;text-align:right;font-weight:600;">${service.label}</td>
        </tr>
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:8px 0;color:#64748b;">Superficie</td>
          <td style="padding:8px 0;text-align:right;">${inv.superficie} pi²</td>
        </tr>
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:8px 0;color:#64748b;">Sous-total</td>
          <td style="padding:8px 0;text-align:right;">${formatMoney(Number(inv.sous_total))}</td>
        </tr>
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:8px 0;color:#64748b;">TPS (5%)</td>
          <td style="padding:8px 0;text-align:right;">${formatMoney(Number(inv.tps))}</td>
        </tr>
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:8px 0;color:#64748b;">TVQ (9,975%)</td>
          <td style="padding:8px 0;text-align:right;">${formatMoney(Number(inv.tvq))}</td>
        </tr>
        <tr style="border-bottom:2px solid #1e293b;">
          <td style="padding:12px 0;font-weight:700;font-size:18px;">Total</td>
          <td style="padding:12px 0;text-align:right;font-weight:700;font-size:18px;">${formatMoney(Number(inv.total))}</td>
        </tr>
      </table>
      <div style="background:#fffbeb;padding:16px;border-radius:8px;border-left:4px solid #f59e0b;margin:20px 0;">
        <p style="margin:0;font-weight:600;color:#92400e;">Dépôt requis : ${formatMoney(Number(inv.depot_montant))} (30%)</p>
        <p style="margin:4px 0 0;color:#92400e;">Solde à la fin des travaux : ${formatMoney(Number(inv.final_montant))} (70%)</p>
      </div>
      <p style="color:#64748b;font-size:14px;">Pour toute question, répondez à ce courriel.</p>
      <p style="margin-top:30px;">Merci de votre confiance,<br/><strong>Novus Epoxy</strong></p>
    </div>
  `;

  let emailData: { id: string };
  try {
    emailData = await sendEmail({
      to: inv.client_email as string,
      subject: `Facture ${inv.numero} — Novus Epoxy`,
      html,
    });
  } catch (err) {
    console.error('Gmail send error:', err);
    return NextResponse.json({ error: `Erreur envoi email: ${String(err)}` }, { status: 500 });
  }

  await query(
    `INSERT INTO email_logs (resend_id, destinataire, sujet, statut) VALUES ($1, $2, $3, $4)`,
    [emailData.id, inv.client_email, `Facture ${inv.numero} — Novus Epoxy`, 'sent'],
  );

  await query(`UPDATE invoices SET statut = 'envoyee' WHERE id = $1 AND statut = 'brouillon'`, [parseInt(id)]);

  return NextResponse.json({ success: true, email_id: emailData.id });
}
