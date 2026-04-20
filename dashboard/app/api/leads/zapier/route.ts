import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { sendSMS } from '@/lib/sms';
import { escapeHtml } from '@/lib/utils';

// Map FB form free-text answers to CRM service codes
function normalizeService(raw: string | null): string | null {
  if (!raw) return null;
  const t = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  // Exact code match
  const codes = ['flake', 'metallique', 'couleur_unie', 'quartz', 'commercial', 'antiderapant', 'meulage'];
  if (codes.includes(t)) return t;
  // Fuzzy match on keywords
  if (t.includes('flocon') || t.includes('flake') || t.includes('garage')) return 'flake';
  if (t.includes('metal')) return 'metallique';
  if (t.includes('couleur') || t.includes('uni') || t.includes('solid')) return 'couleur_unie';
  if (t.includes('quartz')) return 'quartz';
  if (t.includes('commercial') || t.includes('industriel') || t.includes('entrepot')) return 'commercial';
  if (t.includes('antiderapant') || t.includes('anti-derapant') || t.includes('anti derapant') || t.includes('patio') || t.includes('balcon') || t.includes('escalier') || t.includes('marche')) return 'antiderapant';
  if (t.includes('meulage') || t.includes('diamant') || t.includes('poli')) return 'meulage';
  return raw; // return original if no match
}

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

  const serviceRaw  = (body.service ?? body.type_service ?? '').toString().slice(0, 120) || null;
  // Normalize FB form answers to CRM service codes
  const service = normalizeService(serviceRaw);
  const espace   = (body.espace ?? body.location ?? '').toString().slice(0, 120) || null;
  // Facebook pre-filled address fields (from user's FB profile)
  const fbStreet = (body.street_address ?? body.street ?? body.rue ?? '').toString().trim();
  const fbCity = (body.city ?? body.ville ?? '').toString().trim();
  const fbState = (body.state ?? body.province ?? '').toString().trim();
  const fbZip = (body.zip_code ?? body.zip ?? body.code_postal ?? '').toString().trim();
  const superficieRaw = (body.superficie ?? body.surface ?? '').toString().slice(0, 50) || null;
  // Clean superficie: extract numeric value, handle "25x15" multiplication
  let superficie = superficieRaw;
  if (superficieRaw) {
    if (/^\d+\s*x\s*\d+$/i.test(superficieRaw)) {
      const parts = superficieRaw.split(/x/i).map((s: string) => parseFloat(s.trim()));
      superficie = String(Math.round(parts[0] * parts[1]));
    } else {
      superficie = superficieRaw.replace(/\s*(sf|pi2?|pi²|pieds?\s*carr[eé]s?|sqft|p2|pc)\s*$/i, '').trim() || superficieRaw;
    }
  }
  const ville    = (body.ville ?? fbCity ?? '').toString().slice(0, 120) || null;
  // Build full address from FB fields or use manual field
  const manualAdresse = (body.adresse ?? body.address ?? '').toString().trim();
  const fbAdresse = [fbStreet, fbCity, fbState, fbZip].filter(Boolean).join(', ');
  const adresse  = (manualAdresse || fbAdresse || null)?.slice(0, 255) ?? null;
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

  // --- Atomic dedupe via INSERT ... ON CONFLICT (race-condition safe) ---
  let newLeadId: number | undefined;
  const crmResult = await query(
    `INSERT INTO crm_leads (nom, email, telephone, service, superficie, ville, adresse, source, statut, temperature, notes, type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (email) WHERE email IS NOT NULL AND email != '' DO NOTHING
     RETURNING id`,
    [
      nom,
      email || null,
      telephone,
      service,
      superficie,
      ville,
      adresse,
      'facebook-zapier',
      'nouveau',
      'chaud',
      notes,
      'residential',
    ],
  );
  newLeadId = (crmResult?.[0] as { id?: number } | undefined)?.id;

  // If ON CONFLICT hit on email, also check phone dedup
  if (!newLeadId && !email && telephone) {
    const dupRows = await query(
      `SELECT id FROM crm_leads WHERE telephone = $1 LIMIT 1`,
      [telephone],
    );
    if (dupRows.length > 0) newLeadId = undefined; // duplicate
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
    // Send to group if available, otherwise DM admins (not both — avoids duplicates)
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const groupId = (process.env.TELEGRAM_GROUP_CHAT_ID ?? '').trim();
    const adminIds = (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const chatIds = groupId ? [groupId] : adminIds;
    if (botToken && chatIds.length > 0) {
      const SERVICE_LABELS: Record<string, string> = {
        flake: 'Flocon (Flake)', metallique: 'Métallique', couleur_unie: 'Couleur unie',
        quartz: 'Quartz', commercial: 'Commercial', antiderapant: 'Antidérapant', meulage: 'Meulage',
      };
      const serviceLabel = service ? (SERVICE_LABELS[service] ?? service) : null;
      const lines = [
        `🔥 <b>NOUVEAU LEAD FACEBOOK!</b>`,
        `<b>⚡ Contacte-le ASAP — premier rendu gagne!</b>`,
        ``,
        `👤 <b>${escapeHtml(nom)}</b>`,
        telephone ? `📞 <a href="tel:${escapeHtml(telephone)}">${escapeHtml(telephone)}</a>` : '',
        email ? `📧 ${escapeHtml(email)}` : '',
        ``,
        serviceLabel ? `🔧 Service: <b>${escapeHtml(serviceLabel)}</b>` : '',
        superficie ? `📐 Superficie: <b>${escapeHtml(superficie)} pi²</b>` : '',
        espace ? `📍 Espace: ${escapeHtml(espace)}` : '',
        ville ? `🏠 Ville: ${escapeHtml(ville)}` : '',
        adresse ? `🏠 ${escapeHtml(adresse)}` : '',
        adName ? `📢 Pub: ${escapeHtml(adName)}` : '',
      ].filter(Boolean);

      // Note: Telegram inline keyboards don't support tel:/sms: URLs (rejected as invalid).
      // Phone number is already clickable in the <a href="tel:..."> inside the message text on mobile.
      const buttons: Record<string, unknown> = {
        inline_keyboard: [[
          { text: '📋 Voir dans CRM', url: `https://novus-epoxy.vercel.app/dashboard/crm` },
        ]],
      };

      await Promise.all(chatIds.map(async (chatId) => {
        try {
          const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: lines.join('\n'),
              parse_mode: 'HTML',
              reply_markup: buttons,
            }),
          });
          if (!r.ok) {
            const err = await r.text();
            console.error(`[zapier] Telegram ${chatId} failed: ${r.status} ${err}`);
          }
        } catch (e) {
          console.error(`[zapier] Telegram ${chatId} exception:`, e);
        }
      }));
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
    lead_id: newLeadId ?? null,
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
