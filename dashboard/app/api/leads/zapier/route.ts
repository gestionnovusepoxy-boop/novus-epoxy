import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { sendSMS } from '@/lib/sms';
import { escapeHtml } from '@/lib/utils';

// POST /api/leads/zapier — receives Facebook leads forwarded by Zapier
// Auth: header x-api-key must match ZAPIER_API_KEY (or ADMIN_API_KEY as fallback)
// Payload (flexible — Zapier can map any FB form fields):
// {
//   nom? / full_name? / name? : string
//   email? : string
//   telephone? / phone? / phone_number? : string
//   service? / type_service? : string
//   espace? / location? : string
//   superficie? / surface? : string
//   ville? / city? : string
//   adresse? / address? : string
//   message? / notes? : string
//   ad_name? / campaign? : string
//   form_name? : string
//   leadgen_id? / lead_id? : string
// }
export async function POST(req: NextRequest) {
  // --- Auth via API key ---
  const apiKey = req.headers.get('x-api-key') ?? req.nextUrl.searchParams.get('api_key');
  const expected = process.env.ZAPIER_API_KEY ?? process.env.ADMIN_API_KEY;
  if (!expected || apiKey !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // --- Flexible field mapping ---
  const nom = (body.nom ?? body.full_name ?? body.name
    ?? [body.first_name, body.last_name].filter(Boolean).join(' ')
    ?? 'Lead Facebook').toString().trim().slice(0, 120);

  const email = (body.email ?? '').toString().trim().toLowerCase().slice(0, 255);
  const telephoneRaw = (body.telephone ?? body.phone ?? body.phone_number ?? '').toString();
  const telephone = telephoneRaw.replace(/\D/g, '').slice(-10) || null;

  const service  = (body.service ?? body.type_service ?? '').toString().slice(0, 120) || null;
  const espace   = (body.espace ?? body.location ?? '').toString().slice(0, 120) || null;
  const superficie = (body.superficie ?? body.surface ?? '').toString().slice(0, 50) || null;
  const ville    = (body.ville ?? body.city ?? '').toString().slice(0, 120) || null;
  const adresse  = (body.adresse ?? body.address ?? '').toString().slice(0, 255) || null;
  const msg      = (body.message ?? body.notes ?? '').toString().slice(0, 1000) || null;
  const adName   = (body.ad_name ?? body.campaign ?? '').toString().slice(0, 200) || null;
  const formName = (body.form_name ?? '').toString().slice(0, 200) || null;
  const leadId   = (body.leadgen_id ?? body.lead_id ?? '').toString().slice(0, 100) || null;

  // Need at least email OR telephone to proceed
  if (!email && !telephone) {
    return NextResponse.json({ error: 'email or telephone required' }, { status: 400 });
  }

  // --- Build notes blob ---
  const noteParts = [
    leadId ? `Lead FB #${leadId}` : 'Lead Facebook (Zapier)',
    adName ? `Ad: ${adName}` : null,
    formName ? `Form: ${formName}` : null,
    espace ? `Espace: ${espace}` : null,
    service ? `Service: ${service}` : null,
    superficie ? `Superficie: ${superficie}` : null,
    adresse ? `Adresse: ${adresse}` : null,
    msg ? `Message: ${msg}` : null,
  ].filter(Boolean);
  const notes = noteParts.join(' — ');

  // --- Manual dedupe check (partial unique index doesn't work with ON CONFLICT) ---
  let existingLead: { id: number } | null = null;
  if (email) {
    const dupRows = await query(
      `SELECT id FROM crm_leads WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email],
    );
    if (dupRows.length > 0) existingLead = dupRows[0] as { id: number };
  } else if (telephone) {
    const dupRows = await query(
      `SELECT id FROM crm_leads WHERE telephone = $1 LIMIT 1`,
      [telephone],
    );
    if (dupRows.length > 0) existingLead = dupRows[0] as { id: number };
  }

  let newLeadId: number | undefined;
  if (existingLead) {
    newLeadId = undefined; // duplicate — skip insert
  } else {
    const crmResult = await query(
      `INSERT INTO crm_leads (nom, email, telephone, service, superficie, ville, source, statut, temperature, notes, type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        nom,
        email || null,
        telephone,
        service,
        superficie,
        ville,
        'facebook-zapier',
        'nouveau',
        'chaud',
        notes,
        'residential',
      ],
    );
    newLeadId = (crmResult?.[0] as { id?: number } | undefined)?.id;
  }

  // Also insert into submissions (backwards compat)
  await query(
    `INSERT INTO submissions (nom, email, telephone, service, message, statut)
     VALUES ($1, $2, $3, $4, $5, 'nouveau')`,
    [
      nom,
      email || 'no-email@facebook.lead',
      telephone,
      'Facebook Lead Ad (Zapier)',
      notes,
    ],
  ).catch(() => {});

  // Only notify for NEW leads (not duplicates)
  // NOTE: Aria auto-contact intentionally DISABLED — Luca/Jason will contact leads personally
  if (newLeadId) {
    // Build a one-line description summarizing the lead
    const descParts: string[] = [];
    if (espace) descParts.push(espace);
    if (superficie) descParts.push(`${superficie} pi²`);
    if (service) descParts.push(service);
    if (ville) descParts.push(`à ${ville}`);
    const summary = descParts.length > 0
      ? descParts.join(' • ')
      : (msg ? msg.slice(0, 120) : 'Nouveau lead — détails dans CRM');

    // Telegram notification — bypass quiet hours for FB leads (urgent, real-time)
    // Send to group + individual admin chats (group is primary, fallback to individual if missing)
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const groupId = (process.env.TELEGRAM_GROUP_CHAT_ID ?? '').trim();
    const adminIds = (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const chatIds = [groupId, ...adminIds].filter(Boolean);
    if (botToken && chatIds.length > 0) {
      const lines = [
        `🔥 <b>NOUVEAU LEAD FACEBOOK!</b>`,
        `<b>⚡ Contacte-le ASAP — premier rendu gagne!</b>`,
        ``,
        `📝 <i>${escapeHtml(summary)}</i>`,
        ``,
        `👤 ${escapeHtml(nom)}`,
        email ? `📧 <code>${escapeHtml(email)}</code>` : '',
        telephone ? `📞 <a href="tel:${escapeHtml(telephone)}">${escapeHtml(telephone)}</a>` : '',
        adresse ? `🏠 ${escapeHtml(adresse)}` : '',
        msg && descParts.length > 0 ? `💬 <i>${escapeHtml(msg.slice(0, 200))}</i>` : '',
        adName ? `📢 Pub: ${escapeHtml(adName)}` : '',
      ].filter(Boolean);

      const buttons: Record<string, unknown> = { inline_keyboard: [] };
      const row1: Record<string, string>[] = [];
      if (telephone) row1.push({ text: '📞 Appeler', url: `tel:${telephone}` });
      if (telephone) row1.push({ text: '💬 SMS', url: `sms:${telephone}` });
      if (row1.length > 0) (buttons.inline_keyboard as unknown[]).push(row1);
      (buttons.inline_keyboard as unknown[]).push([
        { text: '📋 Voir dans CRM', url: `https://novus-epoxy.vercel.app/dashboard/crm` },
      ]);

      await Promise.all(chatIds.map(chatId =>
        fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: lines.join('\n'),
            parse_mode: 'HTML',
            reply_markup: buttons,
          }),
        }).catch(() => {})
      ));
    }

    // SMS to Luca + Jason (sendSMS respects 8h-21h quiet hours internally)
    const smsLines = [
      `🔥 LEAD FB - Contacte ASAP!`,
      nom,
      summary,
      telephone ? `📞 ${telephone}` : '',
      email ? `📧 ${email}` : '',
    ].filter(Boolean);
    const smsMsg = smsLines.join(' | ');
    const adminPhone = process.env.ADMIN_PHONE;
    const jasonPhone = process.env.JASON_PHONE;
    if (adminPhone) sendSMS(adminPhone, smsMsg).catch(() => {});
    if (jasonPhone) sendSMS(jasonPhone, smsMsg).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    lead_id: newLeadId ?? existingLead?.id ?? null,
    duplicate: !newLeadId,
    nom,
    email,
    telephone,
  });
}

// Healthcheck for Zapier "test connection"
export async function GET(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key') ?? req.nextUrl.searchParams.get('api_key');
  const expected = process.env.ZAPIER_API_KEY ?? process.env.ADMIN_API_KEY;
  if (!expected || apiKey !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ ok: true, endpoint: 'zapier-leads', version: 1 });
}
