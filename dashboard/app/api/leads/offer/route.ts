import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { sendProspectEmail } from '@/lib/send-prospect-email';

const OFFER_HTML = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Offre de service — Novus Epoxy</title>
</head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Arial,sans-serif;background:#f5f5f5;color:#1a1a1a;line-height:1.6;">
<div style="max-width:640px;margin:0 auto;background:#ffffff;">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#111827 0%,#1e3a5f 100%);padding:40px 40px 35px;text-align:center;">
    <h1 style="color:#ffffff;font-size:28px;font-weight:700;letter-spacing:-0.5px;margin:0;">NOVUS EPOXY</h1>
    <p style="color:#94a3b8;font-size:14px;margin:6px 0 0;">Planchers haut de gamme au Qu&eacute;bec</p>
  </div>
  <div style="height:4px;background:linear-gradient(90deg,#d4a853,#f0c674,#d4a853);"></div>

  <!-- Body -->
  <div style="padding:40px;">

    <p style="font-size:16px;margin-bottom:20px;">Bonjour <strong>{{PRENOM}}</strong>,</p>

    <p style="font-size:15px;color:#374151;margin-bottom:30px;">
      Je me pr&eacute;sente, <strong>Luca Hayes</strong>, copropri&eacute;taire de Novus Epoxy.
      On travaille d&eacute;j&agrave; avec plusieurs entrepreneurs en construction et r&eacute;novation,
      et on cherche &agrave; b&acirc;tir des <strong>partenariats solides</strong> avec des entreprises comme la v&ocirc;tre.
    </p>

    <!-- Services -->
    <h2 style="font-size:18px;font-weight:700;color:#111827;margin-bottom:16px;padding-bottom:8px;border-bottom:2px solid #d4a853;display:inline-block;">Nos services</h2>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:35px;">
      <tr>
        <td width="50%" style="padding:6px;">
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px;text-align:center;">
            <div style="font-size:28px;margin-bottom:8px;">&#127968;</div>
            <h3 style="font-size:14px;font-weight:600;color:#1e293b;margin:0;">R&eacute;sidentiel</h3>
            <p style="font-size:12px;color:#64748b;margin:4px 0 0;">Garage, sous-sol, cuisine</p>
          </div>
        </td>
        <td width="50%" style="padding:6px;">
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px;text-align:center;">
            <div style="font-size:28px;margin-bottom:8px;">&#127970;</div>
            <h3 style="font-size:14px;font-weight:600;color:#1e293b;margin:0;">Commercial</h3>
            <p style="font-size:12px;color:#64748b;margin:4px 0 0;">Bureau, commerce, showroom</p>
          </div>
        </td>
      </tr>
      <tr>
        <td width="50%" style="padding:6px;">
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px;text-align:center;">
            <div style="font-size:28px;margin-bottom:8px;">&#127981;</div>
            <h3 style="font-size:14px;font-weight:600;color:#1e293b;margin:0;">Industriel</h3>
            <p style="font-size:12px;color:#64748b;margin:4px 0 0;">Entrep&ocirc;t, usine, atelier</p>
          </div>
        </td>
        <td width="50%" style="padding:6px;">
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px;text-align:center;">
            <div style="font-size:28px;margin-bottom:8px;">&#128737;</div>
            <h3 style="font-size:14px;font-weight:600;color:#1e293b;margin:0;">Antid&eacute;rapant</h3>
            <p style="font-size:12px;color:#64748b;margin:4px 0 0;">R&eacute;sistant aux produits chimiques</p>
          </div>
        </td>
      </tr>
    </table>

    <p style="font-size:15px;color:#374151;margin-bottom:10px;">
      <strong>Service cl&eacute; en main</strong> &mdash; soumission rapide, installation professionnelle, garantie 10 ans incluse.
    </p>

    <!-- Partner Program -->
    <div style="background:linear-gradient(135deg,#111827 0%,#1e3a5f 100%);border-radius:12px;padding:30px;margin:30px 0;color:#ffffff;">
      <h2 style="font-size:20px;font-weight:700;margin:0 0 18px;color:#f0c674;">Programme Partenaire</h2>

      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td width="36" valign="top" style="padding-bottom:14px;">
            <div style="background:#d4a853;color:#111827;width:24px;height:24px;border-radius:50%;text-align:center;line-height:24px;font-weight:700;font-size:14px;">&#10003;</div>
          </td>
          <td style="padding-bottom:14px;">
            <strong style="font-size:15px;">Commission de 5%</strong><br>
            <span style="font-size:13px;color:#cbd5e1;">Sur chaque projet r&eacute;f&eacute;r&eacute; et compl&eacute;t&eacute;</span>
          </td>
        </tr>
        <tr>
          <td width="36" valign="top" style="padding-bottom:14px;">
            <div style="background:#d4a853;color:#111827;width:24px;height:24px;border-radius:50%;text-align:center;line-height:24px;font-weight:700;font-size:14px;">&#10003;</div>
          </td>
          <td style="padding-bottom:14px;">
            <strong style="font-size:15px;">Prix partenaire pr&eacute;f&eacute;rentiel</strong><br>
            <span style="font-size:13px;color:#cbd5e1;">Tarifs exclusifs sur vos propres projets</span>
          </td>
        </tr>
        <tr>
          <td width="36" valign="top" style="padding-bottom:14px;">
            <div style="background:#d4a853;color:#111827;width:24px;height:24px;border-radius:50%;text-align:center;line-height:24px;font-weight:700;font-size:14px;">&#10003;</div>
          </td>
          <td style="padding-bottom:14px;">
            <strong style="font-size:15px;">Priorit&eacute; de planification</strong><br>
            <span style="font-size:13px;color:#cbd5e1;">On s'adapte &agrave; votre calendrier de chantier</span>
          </td>
        </tr>
        <tr>
          <td width="36" valign="top">
            <div style="background:#d4a853;color:#111827;width:24px;height:24px;border-radius:50%;text-align:center;line-height:24px;font-weight:700;font-size:14px;">&#10003;</div>
          </td>
          <td>
            <strong style="font-size:15px;">Soumission en 24h</strong><br>
            <span style="font-size:13px;color:#cbd5e1;">R&eacute;ponse rapide pour vos clients</span>
          </td>
        </tr>
      </table>
    </div>

    <p style="font-size:15px;color:#374151;">
      C'est simple : vous r&eacute;f&eacute;rez un client, on s'occupe du reste, et vous recevez votre commission une fois le projet compl&eacute;t&eacute;.
    </p>

    <!-- CTA -->
    <div style="text-align:center;margin:35px 0 20px;">
      <a href="tel:+15813075983" style="display:inline-block;background:linear-gradient(135deg,#d4a853,#c49b45);color:#111827;text-decoration:none;padding:16px 40px;border-radius:8px;font-weight:700;font-size:16px;">Parlons-en &#8594; 581-307-5983</a>
      <p style="font-size:13px;color:#94a3b8;margin-top:10px;">Appel ou texto, on r&eacute;pond rapidement</p>
    </div>

    <!-- Signature -->
    <div style="border-top:1px solid #e2e8f0;padding-top:25px;margin-top:30px;">
      <div style="font-size:17px;font-weight:700;color:#111827;">Luca Hayes</div>
      <div style="font-size:13px;color:#64748b;margin-top:2px;">Copropri&eacute;taire &mdash; Novus Epoxy</div>
      <div style="margin-top:12px;font-size:13px;color:#374151;line-height:1.8;">
        &#128222; <a href="tel:+15813075983" style="color:#d4a853;text-decoration:none;font-weight:500;">581-307-5983</a><br>
        &#9993; <a href="mailto:gestionnovusepoxy@gmail.com" style="color:#d4a853;text-decoration:none;font-weight:500;">gestionnovusepoxy@gmail.com</a><br>
        &#127760; <a href="https://novusepoxy.ca" style="color:#d4a853;text-decoration:none;font-weight:500;">novusepoxy.ca</a>
      </div>
    </div>

  </div>

  <!-- Footer -->
  <div style="background:#f8fafc;padding:20px 40px;text-align:center;border-top:1px solid #e2e8f0;">
    <p style="font-size:12px;color:#94a3b8;margin:0;">Novus Epoxy &mdash; Planchers &eacute;poxy haut de gamme au Qu&eacute;bec</p>
  </div>

</div>
</body>
</html>`;

export { OFFER_HTML };

// GET: preview the offer template
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  return NextResponse.json({ html: OFFER_HTML });
}

// POST: send offer to specific recipients (MANUAL ONLY — never auto-triggered)
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const body = await req.json();
  const { recipients } = body as { recipients?: { email: string; prenom: string; entreprise?: string }[] };

  if (!recipients || recipients.length === 0) {
    return NextResponse.json({ error: 'Au moins un destinataire requis' }, { status: 400 });
  }

  if (recipients.length > 50) {
    return NextResponse.json({ error: 'Maximum 50 destinataires par envoi' }, { status: 400 });
  }

  const results: { email: string; success: boolean; error?: string }[] = [];

  for (const r of recipients) {
    const html = OFFER_HTML.replace(/\{\{PRENOM\}\}/g, r.prenom || 'Bonjour');
    try {
      const data = await sendProspectEmail({ to: r.email, subject: 'Partenariat planchers epoxy — Novus Epoxy', html });
      await query(
        `INSERT INTO email_logs (resend_id, destinataire, sujet, statut) VALUES ($1, $2, $3, $4)`,
        [data.id ?? '', r.email, 'Offre de service — Partenariat Novus Epoxy', 'sent'],
      );
      results.push({ email: r.email, success: true });
    } catch (e: unknown) {
      results.push({ email: r.email, success: false, error: String(e) });
    }
  }

  // Save campaign log
  const nbSent = results.filter(r => r.success).length;
  await query(
    `INSERT INTO lead_campaigns (action, details, result) VALUES ($1, $2, $3)`,
    [
      'offre_service',
      `Envoi à ${recipients.length} destinataire(s)`,
      `${nbSent}/${recipients.length} envoyé(s) avec succès`,
    ],
  );

  return NextResponse.json({ sent: nbSent, total: recipients.length, results });
}
