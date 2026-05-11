import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { sendProspectEmail } from '@/lib/send-prospect-email';

export const maxDuration = 60;

// Aria follow-up on Hunter prospect emails
// Relance 1: 48h after prospect sent
// Relance 2: 5 days after prospect sent
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if (!authHeader || (authHeader !== cronSecret && authHeader !== adminKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Relance 1: prospect sent 48h+ ago, still nouveau/contacte, no relance_1
  const r1 = await query(
    `SELECT id, nom, email, notes, service, type FROM crm_leads
     WHERE prospect_sent_at IS NOT NULL
       AND prospect_sent_at <= NOW() - INTERVAL '48 hours'
       AND prospect_relance_1_at IS NULL
       AND prospect_followup1_at IS NULL
       AND statut IN ('nouveau', 'contacte', 'offre_envoyee')
       AND email IS NOT NULL AND email != ''`,
    [],
  );

  // Relance 2: prospect sent 5d+ ago, relance_1 done, no relance_2
  const r2 = await query(
    `SELECT id, nom, email, notes, service, type FROM crm_leads
     WHERE prospect_sent_at IS NOT NULL
       AND prospect_sent_at <= NOW() - INTERVAL '5 days'
       AND prospect_relance_1_at IS NOT NULL
       AND prospect_relance_2_at IS NULL
       AND prospect_followup2_at IS NULL
       AND statut IN ('nouveau', 'contacte', 'offre_envoyee')
       AND email IS NOT NULL AND email != ''`,
    [],
  );

  let sent1 = 0, sent2 = 0;

  for (const lead of r1) {
    const prenom = (lead.nom as string).split(' ')[0];
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f8fafc;">
<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
<div style="background:#0f172a;padding:24px;text-align:center;border-radius:8px 8px 0 0;">
  <img src="https://novus-epoxy.vercel.app/logo-email.jpg" alt="Novus Epoxy" width="80" height="80" style="border-radius:12px;" />
  <h1 style="color:#f59e0b;margin:12px 0 0;font-size:22px;font-weight:700;">Novus Epoxy</h1>
  <p style="color:#94a3b8;margin:4px 0 0;font-size:13px;">Planchers époxy haut de gamme — Québec</p>
</div>
<div style="padding:24px;">
<p>Bonjour ${prenom},</p>
<p>On vous a envoyé une présentation de nos services de planchers époxy récemment. On voulait s'assurer que vous l'avez bien reçue!</p>
<p>Si vous avez des questions sur votre projet ou si vous aimeriez une soumission gratuite, on peut vous en préparer une <strong>en moins d'une heure</strong>.</p>
<p>Répondez simplement à ce courriel ou appelez-nous:</p>
<div style="border-top:1px solid #e2e8f0;padding:16px 0 0;margin-top:20px;">
  <p style="color:#1e293b;font-weight:700;font-size:13px;margin:0 0 6px;">Une question? On est là pour vous.</p>
  <p style="color:#475569;font-size:13px;margin:0 0 2px;"><strong>Luca</strong> — Facturation / Soumission — <a href="tel:5813075983" style="color:#2563eb;">581-307-5983</a></p>
  <p style="color:#475569;font-size:13px;margin:0;"><strong>Jason</strong> — Chantier / Soumission — <a href="tel:5813072678" style="color:#2563eb;">581-307-2678</a></p>
</div>
<p>Bonne journée!<br/><strong>L'équipe Novus Epoxy</strong></p>
</div>
<div style="background:#f1f5f9;padding:12px 24px;text-align:center;border-radius:0 0 8px 8px;">
  <p style="color:#94a3b8;font-size:11px;margin:0;">Novus Epoxy — 44 rue de la Polyvalente, Québec, G2N 1G8</p>
</div>
</div></body></html>`;

    try {
      await sendProspectEmail({ to: lead.email as string, subject: `${prenom}, on peut vous aider avec votre projet?`, html });
      await query(`UPDATE crm_leads SET prospect_relance_1_at = NOW(), updated_at = NOW() WHERE id = $1`, [lead.id]);
      sent1++;
    } catch (err) {
      console.error('Prospect relance 1 error:', err);
    }
  }

  for (const lead of r2) {
    const prenom = (lead.nom as string).split(' ')[0];
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f8fafc;">
<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
<div style="background:#0f172a;padding:24px;text-align:center;border-radius:8px 8px 0 0;">
  <img src="https://novus-epoxy.vercel.app/logo-email.jpg" alt="Novus Epoxy" width="80" height="80" style="border-radius:12px;" />
  <h1 style="color:#f59e0b;margin:12px 0 0;font-size:22px;font-weight:700;">Novus Epoxy</h1>
  <p style="color:#94a3b8;margin:4px 0 0;font-size:13px;">Planchers époxy haut de gamme — Québec</p>
</div>
<div style="padding:24px;">
<p>Bonjour ${prenom},</p>
<p>C'est un dernier petit suivi de notre part. Notre calendrier se remplit vite pour les prochaines semaines!</p>
<p>Si votre projet est toujours d'actualité, on serait ravis de vous accompagner. Soumission gratuite, sans obligation.</p>
<div style="text-align:center;margin:20px 0;">
<a href="https://novusepoxy.ca/#contact" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:12px 30px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Demander ma soumission gratuite</a>
</div>
<div style="border-top:1px solid #e2e8f0;padding:16px 0 0;margin-top:20px;">
  <p style="color:#1e293b;font-weight:700;font-size:13px;margin:0 0 6px;">Une question? On est là pour vous.</p>
  <p style="color:#475569;font-size:13px;margin:0 0 2px;"><strong>Luca</strong> — Facturation / Soumission — <a href="tel:5813075983" style="color:#2563eb;">581-307-5983</a></p>
  <p style="color:#475569;font-size:13px;margin:0;"><strong>Jason</strong> — Chantier / Soumission — <a href="tel:5813072678" style="color:#2563eb;">581-307-2678</a></p>
</div>
<p>Au plaisir,<br/><strong>L'équipe Novus Epoxy</strong></p>
</div>
<div style="background:#f1f5f9;padding:12px 24px;text-align:center;border-radius:0 0 8px 8px;">
  <p style="color:#94a3b8;font-size:11px;margin:0;">Novus Epoxy — 44 rue de la Polyvalente, Québec, G2N 1G8</p>
</div>
</div></body></html>`;

    try {
      await sendProspectEmail({ to: lead.email as string, subject: `${prenom} — Dernière chance soumission gratuite`, html });
      await query(`UPDATE crm_leads SET prospect_relance_2_at = NOW(), updated_at = NOW() WHERE id = $1`, [lead.id]);
      sent2++;
    } catch (err) {
      console.error('Prospect relance 2 error:', err);
    }
  }

  return NextResponse.json({ ok: true, relance_1: { found: r1.length, sent: sent1 }, relance_2: { found: r2.length, sent: sent2 } });
}
