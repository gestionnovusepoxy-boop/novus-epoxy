import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { sendEmail } from '@/lib/send-email';

const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 2000;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const rows = await query(
    `SELECT c.*, p.nom as promo_nom, p.rabais_pct
     FROM campaigns c
     LEFT JOIN promotions p ON p.id = c.promotion_id
     ORDER BY c.sent_at DESC
     LIMIT 50`
  );

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const body = await req.json();
  const { promotion_id, audience, custom_message } = body;

  if (!audience || !custom_message) {
    return NextResponse.json({ error: 'Audience et message requis' }, { status: 400 });
  }

  // Fetch promotion info if provided
  let promoNom = 'Campagne sans promotion';
  if (promotion_id) {
    const promoRows = await query('SELECT nom FROM promotions WHERE id = $1', [promotion_id]);
    if (promoRows.length > 0) promoNom = promoRows[0].nom as string;
  }

  // Fetch recipients based on audience
  let recipients: { email: string; nom: string }[] = [];

  switch (audience) {
    case 'tous_leads': {
      const rows = await query(
        `SELECT DISTINCT visitor_email as email, visitor_name as nom
         FROM conversations
         WHERE visitor_email IS NOT NULL AND visitor_email != ''
         UNION
         SELECT DISTINCT email, nom
         FROM submissions
         WHERE email IS NOT NULL AND email != ''`
      );
      recipients = rows.map(r => ({ email: r.email as string, nom: r.nom as string }));
      break;
    }
    case 'leads_tiedes': {
      const rows = await query(
        `SELECT DISTINCT visitor_email as email, visitor_name as nom
         FROM conversations
         WHERE visitor_email IS NOT NULL AND visitor_email != '' AND lead_temp = 'warm'`
      );
      recipients = rows.map(r => ({ email: r.email as string, nom: r.nom as string }));
      break;
    }
    case 'leads_chauds': {
      const rows = await query(
        `SELECT DISTINCT visitor_email as email, visitor_name as nom
         FROM conversations
         WHERE visitor_email IS NOT NULL AND visitor_email != '' AND lead_temp = 'hot'`
      );
      recipients = rows.map(r => ({ email: r.email as string, nom: r.nom as string }));
      break;
    }
    case 'anciens_clients': {
      const rows = await query(
        `SELECT DISTINCT email, nom
         FROM clients
         WHERE email IS NOT NULL AND email != ''`
      );
      recipients = rows.map(r => ({ email: r.email as string, nom: r.nom as string }));
      break;
    }
    case 'leads_sans_reponse': {
      const rows = await query(
        `SELECT DISTINCT visitor_email as email, visitor_name as nom
         FROM conversations
         WHERE visitor_email IS NOT NULL AND visitor_email != ''
           AND status = 'active'
           AND id NOT IN (SELECT conversation_id FROM messages WHERE role = 'assistant' AND conversation_id IS NOT NULL)
         UNION
         SELECT DISTINCT email, nom
         FROM submissions
         WHERE email IS NOT NULL AND email != '' AND statut = 'nouveau'`
      );
      recipients = rows.map(r => ({ email: r.email as string, nom: r.nom as string }));
      break;
    }
    default:
      return NextResponse.json({ error: 'Audience invalide' }, { status: 400 });
  }

  // Deduplicate by email
  const seen = new Set<string>();
  recipients = recipients.filter(r => {
    if (!r.email || seen.has(r.email.toLowerCase())) return false;
    seen.add(r.email.toLowerCase());
    return true;
  });

  if (recipients.length === 0) {
    return NextResponse.json({ error: 'Aucun destinataire trouvé pour cette audience' }, { status: 400 });
  }

  // Record campaign
  const campaignRows = await query(
    `INSERT INTO campaigns (promotion_id, nom, audience, message, destinataires_count)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [promotion_id ?? null, promoNom, audience, custom_message, recipients.length]
  );
  const campaignId = campaignRows[0].id as number;

  // Send emails in batches of BATCH_SIZE
  let sent = 0;
  for (let batch = 0; batch < recipients.length; batch += BATCH_SIZE) {
    const chunk = recipients.slice(batch, batch + BATCH_SIZE);

    await Promise.allSettled(
      chunk.map(r =>
        sendEmail({
          to: r.email,
          subject: promoNom,
          html: buildCampaignHtml(custom_message, r.nom),
        })
      )
    );

    sent += chunk.length;

    // Delay between batches
    if (batch + BATCH_SIZE < recipients.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  return NextResponse.json({ campaign_id: campaignId, sent, total: recipients.length });
}

function buildCampaignHtml(message: string, recipientName: string): string {
  const greeting = recipientName ? `Bonjour ${recipientName},` : 'Bonjour,';
  const escapedMessage = message.replace(/\n/g, '<br>');

  return `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; color: #e2e8f0; padding: 0;">
      <div style="background: linear-gradient(135deg, #f59e0b, #d97706); padding: 24px 32px; text-align: center;">
        <h1 style="margin: 0; color: #0f172a; font-size: 24px; font-weight: 700;">Novus Epoxy</h1>
        <p style="margin: 4px 0 0; color: #1e293b; font-size: 14px;">Planchers \u00e9poxy haut de gamme</p>
      </div>
      <div style="padding: 32px;">
        <p style="color: #f8fafc; font-size: 16px; margin-bottom: 16px;">${greeting}</p>
        <div style="color: #cbd5e1; font-size: 15px; line-height: 1.6;">
          ${escapedMessage}
        </div>
        <div style="margin-top: 32px; text-align: center;">
          <a href="https://novusepoxy.ca" style="display: inline-block; background: #f59e0b; color: #0f172a; padding: 12px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px;">Voir nos services</a>
        </div>
      </div>
      <div style="padding: 20px 32px; border-top: 1px solid #1e293b; text-align: center;">
        <p style="color: #64748b; font-size: 12px; margin: 0;">Novus Epoxy &mdash; Qu\u00e9bec</p>
        <p style="color: #64748b; font-size: 12px; margin: 4px 0 0;">
          Luca: 581-307-2678 | Jason: 418-564-2182
        </p>
        <p style="color: #475569; font-size: 11px; margin: 8px 0 0;">
          Pour ne plus recevoir nos courriels, r\u00e9pondez \u00ab d\u00e9sabonner \u00bb.
        </p>
      </div>
    </div>
  `;
}
