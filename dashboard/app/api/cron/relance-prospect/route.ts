import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { sendProspectEmail } from '@/lib/send-prospect-email';

// Aria follow-up on Hunter prospect emails
// Relance 1: 48h after prospect sent
// Relance 2: 5 days after prospect sent
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  if (!cronSecret || !authHeader || cronSecret !== authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Relance 1: prospect sent 48h+ ago, still nouveau/contacte, no relance_1
  const r1 = await query(
    `SELECT id, nom, email, notes, service, type FROM crm_leads
     WHERE prospect_sent_at IS NOT NULL
       AND prospect_sent_at <= NOW() - INTERVAL '48 hours'
       AND prospect_relance_1_at IS NULL
       AND statut IN ('nouveau', 'contacte')
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
       AND statut IN ('nouveau', 'contacte')
       AND email IS NOT NULL AND email != ''`,
    [],
  );

  let sent1 = 0, sent2 = 0;

  for (const lead of r1) {
    const prenom = (lead.nom as string).split(' ')[0];
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;">
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
<p>Bonjour ${prenom},</p>
<p>On vous a envoye une presentation de nos services de planchers epoxy recemment. On voulait s'assurer que vous l'avez bien recue!</p>
<p>Si vous avez des questions sur votre projet ou si vous aimeriez une soumission gratuite, on peut vous en preparer une <strong>en moins d'une heure</strong>.</p>
<p>Repondez simplement a ce courriel ou appelez-nous:</p>
<p><strong>Luca</strong> — 581-307-5983<br/><strong>Jason</strong> — 581-307-2678</p>
<p>Bonne journee!<br/><strong>L'equipe Novus Epoxy</strong></p>
<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;" />
<p style="color:#94a3b8;font-size:12px;">Novus Epoxy — Planchers epoxy haut de gamme<br/>Licence RBQ 5861-8471-01 | novusepoxy.ca</p>
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
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;">
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
<p>Bonjour ${prenom},</p>
<p>C'est un dernier petit suivi de notre part. Notre calendrier se remplit vite pour les prochaines semaines!</p>
<p>Si votre projet est toujours d'actualite, on serait ravis de vous accompagner. Soumission gratuite, sans obligation.</p>
<div style="text-align:center;margin:20px 0;">
<a href="https://novusepoxy.ca/#contact" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:12px 30px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Demander ma soumission gratuite</a>
</div>
<p><strong>Luca</strong> — 581-307-5983<br/><strong>Jason</strong> — 581-307-2678</p>
<p>Au plaisir,<br/><strong>L'equipe Novus Epoxy</strong></p>
<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;" />
<p style="color:#94a3b8;font-size:12px;">Novus Epoxy — +1 000 projets en 15 ans<br/>Licence RBQ 5861-8471-01 | novusepoxy.ca</p>
</div></body></html>`;

    try {
      await sendProspectEmail({ to: lead.email as string, subject: `${prenom} — Derniere chance soumission gratuite`, html });
      await query(`UPDATE crm_leads SET prospect_relance_2_at = NOW(), updated_at = NOW() WHERE id = $1`, [lead.id]);
      sent2++;
    } catch (err) {
      console.error('Prospect relance 2 error:', err);
    }
  }

  return NextResponse.json({ ok: true, relance_1: { found: r1.length, sent: sent1 }, relance_2: { found: r2.length, sent: sent2 } });
}
