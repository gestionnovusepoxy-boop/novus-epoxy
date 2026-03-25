import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query as db } from '@/lib/db';
import { SERVICES, type ServiceType, calculateQuote, formatMoney } from '@/lib/pricing';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const page   = Math.max(1, parseInt(searchParams.get('page')  ?? '1'));
  const limit  = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '25')));
  const offset = (page - 1) * limit;
  const statut = searchParams.get('statut');
  const search = searchParams.get('search');

  

  const conditions: string[] = [];
  const params: unknown[]    = [];
  let   idx                  = 1;

  if (statut && ['nouveau','lu','en_traitement','ferme'].includes(statut)) {
    conditions.push(`statut = $${idx++}`);
    params.push(statut);
  }
  if (search) {
    conditions.push(`(nom ILIKE $${idx} OR email ILIKE $${idx})`);
    params.push(`%${search}%`);
    idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [countRow, rows] = await Promise.all([
    db(`SELECT COUNT(*)::int AS total FROM submissions ${where}`, params),
    db(
      `SELECT id, nom, email, telephone, service, message, ville, adresse, surface_estimee, type_projet, statut, created_at, updated_at
       FROM submissions ${where}
       ORDER BY created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    ),
  ]);

  return NextResponse.json({
    data:  rows,
    total: (countRow[0] as { total: number }).total,
    page,
    limit,
  });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const id     = parseInt(new URL(req.url).searchParams.get('id') ?? '0');
  const body   = await req.json().catch(() => ({}));
  const statut = body.statut as string;

  if (!id || !['nouveau','lu','en_traitement','ferme'].includes(statut)) {
    return NextResponse.json({ error: 'Paramètres invalides' }, { status: 400 });
  }

  
  await db(`UPDATE submissions SET statut = $1 WHERE id = $2`, [statut, id]);

  return NextResponse.json({ ok: true });
}

// Map form service names to pricing keys
const SERVICE_MAP: Record<string, ServiceType> = {
  'finition flake': 'flake',
  'flake': 'flake',
  'flocon': 'flake',
  'finition flocon': 'flake',
  'finition metallique': 'metallique',
  'finition métallique': 'metallique',
  'metallique': 'metallique',
  'métallique': 'metallique',
  'commercial': 'commercial',
  'couleur unie': 'couleur_unie',
  'quartz': 'quartz',
  'antiderapant': 'antiderapant',
  'antidérapant': 'antiderapant',
  'meulage': 'meulage',
};

function matchServiceType(service: string | null): ServiceType | null {
  if (!service) return null;
  const lower = service.toLowerCase().trim();
  for (const [key, val] of Object.entries(SERVICE_MAP)) {
    if (lower.includes(key)) return val;
  }
  return null;
}

function parseSurface(surface: string | null): number | null {
  if (!surface) return null;
  const num = parseFloat(surface.replace(/[^\d.]/g, ''));
  return isNaN(num) || num <= 0 ? null : num;
}

async function sendSMSNotif(phone: string, msg: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!sid || !token || !from) return;

  const formatted = phone.startsWith('+') ? phone : `+1${phone.replace(/\D/g, '')}`;
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: from, To: formatted, Body: msg }),
  }).catch(() => {});
}

async function notifyAdminsWithQuote(
  submission: { nom: string; email: string; telephone: string | null; service: string | null; ville: string | null; surface_estimee: string | null; adresse: string | null; type_projet: string | null },
  quoteId: number | null,
  quoteTotal: string | null,
  quoteDepot: string | null,
  serviceLabel: string | null,
  superficie: number | null,
) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').filter(Boolean);

  // Build Telegram message
  const lines = [
    `📋 <b>Nouvelle soumission!</b>`,
    ``,
    `👤 ${submission.nom}`,
    submission.email ? `📧 ${submission.email}` : '',
    submission.telephone ? `📞 ${submission.telephone}` : '',
    submission.ville ? `📍 ${submission.ville}` : '',
    submission.adresse ? `🏠 ${submission.adresse}` : '',
    submission.service ? `🔧 ${submission.service}` : '',
    submission.surface_estimee ? `📐 ${submission.surface_estimee} pi²` : '',
  ].filter(Boolean);

  if (quoteId && quoteTotal) {
    lines.push('');
    lines.push(`<b>Devis auto #${quoteId}</b>`);
    lines.push(`💰 Total: ${quoteTotal}`);
    lines.push(`💳 Depot: ${quoteDepot}`);
    if (serviceLabel) lines.push(`📦 ${serviceLabel} — ${superficie} pi²`);
  } else {
    lines.push('');
    lines.push(`⚠️ Devis auto impossible (service ou surface manquant)`);
  }

  const msg = lines.join('\n');

  // Inline buttons for Telegram
  const buttons = quoteId ? {
    inline_keyboard: [
      [
        { text: '✅ Approuver et envoyer', callback_data: `approve_quote_${quoteId}` },
        { text: '❌ Rejeter', callback_data: `reject_quote_${quoteId}` },
      ],
      [
        { text: '📋 Voir dashboard', url: `https://novus-epoxy.vercel.app/dashboard/devis` },
      ],
    ],
  } : {
    inline_keyboard: [
      [{ text: '📋 Voir soumissions', url: 'https://novus-epoxy.vercel.app/dashboard/soumissions' }],
    ],
  };

  // Send Telegram to all admins
  if (botToken) {
    await Promise.all(chatIds.map(chatId =>
      fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId.trim(),
          text: msg,
          parse_mode: 'HTML',
          reply_markup: buttons,
        }),
      }).then(async r => {
        if (!r.ok) console.error('Telegram sendMessage error:', await r.text().catch(() => r.status));
      }).catch(err => console.error('Telegram fetch error:', err))
    ));
  }

  // SMS to admins
  const smsLines = [
    `Novus Epoxy - Nouvelle soumission!`,
    `${submission.nom}${submission.telephone ? ` (${submission.telephone})` : ''}`,
    submission.service ? `Service: ${submission.service}` : '',
    submission.surface_estimee ? `Surface: ${submission.surface_estimee} pi2` : '',
    submission.ville ? `Ville: ${submission.ville}` : '',
  ].filter(Boolean);

  if (quoteId && quoteTotal) {
    smsLines.push(`Devis #${quoteId}: ${quoteTotal}`);
    smsLines.push(`Approuve dans Telegram ou dashboard`);
  }

  const smsMsg = smsLines.join('\n');
  const adminPhone = process.env.ADMIN_PHONE;
  const jasonPhone = process.env.JASON_PHONE;
  if (adminPhone) await sendSMSNotif(adminPhone, smsMsg);
  if (jasonPhone) await sendSMSNotif(jasonPhone, smsMsg);
}

// Endpoint public pour recevoir les soumissions du formulaire de contact
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.nom || !body?.email) {
    return NextResponse.json({ error: 'Champs requis manquants' }, { status: 400 });
  }

  const ip     = req.headers.get('x-forwarded-for')?.split(',')[0] ?? '';
  const ua     = req.headers.get('user-agent') ?? '';
  const ipHash = await sha256(`${ip}${ua}${new Date().toISOString().slice(0, 10)}`);

  const submissionRows = await db(
    `INSERT INTO submissions (nom, email, telephone, service, type_projet, adresse, surface_estimee, ville, ip_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      body.nom.slice(0, 120),
      body.email.slice(0, 255),
      body.telephone?.slice(0, 30) ?? null,
      body.service?.slice(0, 80) ?? null,
      body.type_projet?.slice(0, 80) ?? null,
      body.adresse?.slice(0, 500) ?? null,
      body.surface_estimee?.slice(0, 50) ?? null,
      body.ville?.slice(0, 120) ?? null,
      ipHash,
    ]
  );
  const submissionId = (submissionRows[0] as { id: number }).id;

  // Try to auto-create a draft quote if we have enough info
  let quoteId: number | null = null;
  let quoteTotal: string | null = null;
  let quoteDepot: string | null = null;
  let serviceLabel: string | null = null;
  let superficie: number | null = null;

  const serviceType = matchServiceType(body.service);
  const surfaceNum = parseSurface(body.surface_estimee);

  if (serviceType && surfaceNum && surfaceNum > 0) {
    try {
      const calc = calculateQuote(serviceType, surfaceNum);
      const service = SERVICES[serviceType];
      serviceLabel = service.label;
      superficie = surfaceNum;
      quoteTotal = formatMoney(calc.total);
      quoteDepot = formatMoney(calc.depot_requis);

      const rows = await db(
        `INSERT INTO quotes (client_nom, client_email, client_tel, client_adresse, type_service, superficie, prix_pied_carre, sous_total, tps, tvq, total, depot_requis, submission_id, statut)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'brouillon')
         RETURNING id`,
        [
          body.nom.slice(0, 120),
          body.email.slice(0, 255),
          body.telephone?.slice(0, 30) ?? null,
          body.adresse?.slice(0, 500) ?? null,
          serviceType,
          surfaceNum,
          calc.prix_pied_carre,
          calc.sous_total,
          calc.tps,
          calc.tvq,
          calc.total,
          calc.depot_requis,
          submissionId,
        ]
      );
      quoteId = (rows[0] as { id: number }).id;
    } catch (err) {
      console.error('Auto-quote creation failed:', err);
    }
  }

  // Notify admins via Telegram (with buttons) + SMS
  await notifyAdminsWithQuote(
    {
      nom: body.nom,
      email: body.email,
      telephone: body.telephone ?? null,
      service: body.service ?? null,
      ville: body.ville ?? null,
      surface_estimee: body.surface_estimee ?? null,
      adresse: body.adresse ?? null,
      type_projet: body.type_projet ?? null,
    },
    quoteId,
    quoteTotal,
    quoteDepot,
    serviceLabel,
    superficie,
  );

  // Special alert for metallique — Jason must contact client for in-person color selection
  const serviceLower = (body.service ?? '').toLowerCase();
  if (serviceLower.includes('metallique') || serviceLower.includes('m\u00e9tallique')) {
    const clientName = body.nom;
    const clientTel = body.telephone ?? 'pas de tel';
    const clientEmail = body.email;
    const clientVille = body.ville ?? '';

    const jasonSms = `METALLIQUE - Appelle ${clientName} pour choisir les couleurs en personne!\nTel: ${clientTel}\nEmail: ${clientEmail}${clientVille ? `\nVille: ${clientVille}` : ''}`;
    const lucaSms = `Metallique: Jason doit contacter ${clientName} (${clientTel}) pour couleurs en personne.`;

    const jasonPhone = process.env.JASON_PHONE;
    const adminPhone = process.env.ADMIN_PHONE;
    if (jasonPhone) await sendSMSNotif(jasonPhone, jasonSms);
    if (adminPhone) await sendSMSNotif(adminPhone, lucaSms);

    // Also Telegram
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatIds = (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').filter(Boolean);
    if (botToken) {
      const tgMsg = `\ud83c\udfa8 <b>METALLIQUE — Couleurs en personne</b>\n\nJason, appelle ${clientName} pour choisir les couleurs!\n\ud83d\udcde ${clientTel}\n\ud83d\udce7 ${clientEmail}${clientVille ? `\n\ud83d\udccd ${clientVille}` : ''}`;
      await Promise.all(chatIds.map(chatId =>
        fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId.trim(), text: tgMsg, parse_mode: 'HTML' }),
        }).catch(() => {})
      ));
    }
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

async function sha256(str: string): Promise<string> {
  const buf    = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
