import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { sendProspectEmail } from '@/lib/send-prospect-email';

// Vercel Cron — Aria follow-up on Hunter prospects
// Follow-up 1: 48h after prospect sent (gentle reminder)
// Follow-up 2: 5 days after prospect sent (last chance)
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  if (!cronSecret || !authHeader || cronSecret !== authHeader) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let sent1 = 0;
  let sent2 = 0;

  // Follow-up 1: 48h after prospect_sent_at, still nouveau/contacte
  const followup1 = await query(
    `SELECT id, nom, email, service, type, notes FROM crm_leads
     WHERE prospect_sent_at IS NOT NULL
       AND prospect_sent_at <= NOW() - INTERVAL '48 hours'
       AND prospect_sent_at > NOW() - INTERVAL '72 hours'
       AND prospect_followup1_at IS NULL
       AND statut IN ('nouveau', 'contacte')
       AND email IS NOT NULL AND email != ''`,
    []
  );

  for (const lead of followup1) {
    const prenom = (lead.nom as string).split(' ')[0];
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f8fafc;">
<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;">
<div style="background:#0f172a;padding:20px 24px;">
  <h2 style="color:#f59e0b;margin:0;font-size:18px;">Novus Epoxy</h2>
</div>
<div style="padding:24px;">
  <p style="color:#1e293b;font-size:15px;">Salut ${prenom},</p>
  <p style="color:#475569;font-size:14px;line-height:1.6;">C'est Jason de Novus Epoxy! Je t'ai envoye un message il y a quelques jours au sujet de ton projet. T'as eu la chance d'y jeter un coup d'oeil?</p>
  <p style="color:#475569;font-size:14px;line-height:1.6;">Si t'as des questions sur nos services ou si tu veux une soumission gratuite, n'hesite pas a me repondre ou m'appeler directement.</p>
  <div style="text-align:center;margin:20px 0;">
    <a href="https://novusepoxy.ca/#contact" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Demander ma soumission</a>
  </div>
  <p style="color:#475569;font-size:13px;margin-top:20px;">Bonne journee!<br/><strong>Jason</strong> — 581-709-5940</p>
</div>
</div></body></html>`;

    try {
      await sendProspectEmail({ to: lead.email as string, subject: `${prenom} — Petit suivi — Novus Epoxy`, html });
      await query(`UPDATE crm_leads SET prospect_followup1_at = NOW(), updated_at = NOW() WHERE id = $1`, [lead.id]);
      sent1++;
    } catch (err) { console.error('Prospect followup 1 error:', err); }
  }

  // Follow-up 2: 5 days after prospect_sent_at (last one)
  const followup2 = await query(
    `SELECT id, nom, email, service, type, telephone FROM crm_leads
     WHERE prospect_sent_at IS NOT NULL
       AND prospect_sent_at <= NOW() - INTERVAL '5 days'
       AND prospect_sent_at > NOW() - INTERVAL '7 days'
       AND prospect_followup1_at IS NOT NULL
       AND prospect_followup2_at IS NULL
       AND statut IN ('nouveau', 'contacte')
       AND email IS NOT NULL AND email != ''`,
    []
  );

  for (const lead of followup2) {
    const prenom = (lead.nom as string).split(' ')[0];
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f8fafc;">
<div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;">
<div style="background:#0f172a;padding:20px 24px;">
  <h2 style="color:#f59e0b;margin:0;font-size:18px;">Novus Epoxy</h2>
</div>
<div style="padding:24px;">
  <p style="color:#1e293b;font-size:15px;">Salut ${prenom},</p>
  <p style="color:#475569;font-size:14px;line-height:1.6;">Dernier petit suivi de ma part! Notre calendrier se remplit vite pour les prochaines semaines.</p>
  <p style="color:#475569;font-size:14px;line-height:1.6;">Si ton projet de plancher est encore d'actualite, on pourrait en jaser rapidement. Soumission gratuite, sans obligation.</p>
  <div style="text-align:center;margin:20px 0;">
    <a href="tel:5817095940" style="display:inline-block;background:#f59e0b;color:#0f172a;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;">Appeler Jason — 581-709-5940</a>
  </div>
  <p style="color:#475569;font-size:13px;margin-top:20px;">A bientot!<br/><strong>Jason</strong> — Novus Epoxy</p>
</div>
</div></body></html>`;

    try {
      await sendProspectEmail({ to: lead.email as string, subject: `${prenom} — Derniere chance soumission gratuite — Novus Epoxy`, html });
      await query(`UPDATE crm_leads SET prospect_followup2_at = NOW(), updated_at = NOW() WHERE id = $1`, [lead.id]);
      sent2++;
    } catch (err) { console.error('Prospect followup 2 error:', err); }
  }

  return NextResponse.json({ ok: true, followup1: { found: followup1.length, sent: sent1 }, followup2: { found: followup2.length, sent: sent2 } });
}
