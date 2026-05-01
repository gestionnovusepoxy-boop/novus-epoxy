import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query as db } from '@/lib/db';
import { SERVICES, type ServiceType, calculateQuote, formatMoney } from '@/lib/pricing';
import { isQuietHours } from '@/lib/telegram-utils';

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

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const id = parseInt(new URL(req.url).searchParams.get('id') ?? '0');
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  await db(`DELETE FROM submissions WHERE id = $1`, [id]);
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
  // Use centralized sendSMS which handles quiet hours, validation, dedup, and logging
  const { sendSMS } = await import('@/lib/sms');
  await sendSMS(phone, msg).catch(() => {});
}

async function analyzeLeadWithClaude(submission: {
  nom: string; telephone: string | null; service: string | null;
  surface_estimee: string | null; ville: string | null; type_projet: string | null;
}): Promise<{ temperature: string; urgence: string; action: string; raison: string; emoji: string } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const details = [
      `Nom: ${submission.nom}`,
      submission.telephone ? `Tel: ${submission.telephone}` : 'Pas de telephone',
      submission.service ? `Service: ${submission.service}` : 'Service non specifie',
      submission.surface_estimee ? `Surface: ${submission.surface_estimee}` : 'Surface non specifiee',
      submission.ville ? `Ville: ${submission.ville}` : '',
      submission.type_projet ? `Type projet: ${submission.type_projet}` : '',
    ].filter(Boolean).join('\n');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: `Lead pour entreprise epoxy Quebec:\n\n${details}\n\nReponds en JSON strict:\n{"temperature":"chaud|tiede|froid","urgence":"urgent|normal|pas_presse","action":"appeler_maintenant|envoyer_devis|attendre_infos|relancer_semaine","raison":"1 phrase max"}` }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const parsed = JSON.parse((data.content?.[0]?.text ?? '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
    const emojiMap: Record<string, string> = { chaud: '🔥', tiede: '🟡', froid: '🔵' };
    const actionLabel: Record<string, string> = { appeler_maintenant: 'Appeler maintenant', envoyer_devis: 'Envoyer devis', attendre_infos: 'Attendre infos', relancer_semaine: 'Relancer dans 1 sem' };
    return { ...parsed, emoji: emojiMap[parsed.temperature] ?? '📋', action: actionLabel[parsed.action] ?? parsed.action };
  } catch { return null; }
}

async function notifyAdminsWithQuote(
  submission: { nom: string; email: string; telephone: string | null; service: string | null; ville: string | null; surface_estimee: string | null; adresse: string | null; type_projet: string | null },
  quoteId: number | null,
  quoteTotal: string | null,
  quoteDepot: string | null,
  serviceLabel: string | null,
  superficie: number | null,
  analysis?: { temperature: string; urgence: string; action: string; raison: string; emoji: string } | null,
) {
  if (isQuietHours()) return;

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').filter(Boolean);

  // Build Telegram message
  const lines = [
    `📋 <b>Nouvelle soumission!</b>`,
    analysis ? `${analysis.emoji} <b>${analysis.temperature.toUpperCase()}</b> — ${analysis.raison}` : '',
    ``,
    `👤 ${submission.nom}`,
    submission.email ? `📧 ${submission.email}` : '',
    submission.telephone ? `📞 ${submission.telephone}` : '',
    submission.ville ? `📍 ${submission.ville}` : '',
    submission.adresse ? `🏠 ${submission.adresse}` : '',
    submission.service ? `🔧 ${submission.service}` : '',
    submission.surface_estimee ? `📐 ${submission.surface_estimee} pi²` : '',
  ].filter(Boolean);

  if (analysis) {
    lines.push('');
    lines.push(`➡️ <b>Action:</b> ${analysis.action}`);
  }

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
    smsLines.push(`https://novus-epoxy.vercel.app/dashboard/devis`);
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
    `INSERT INTO submissions (nom, email, telephone, service, type_projet, adresse, surface_estimee, ville, ip_hash, utm_source, utm_medium, utm_campaign)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
      body.utm_source?.slice(0, 80) ?? null,
      body.utm_medium?.slice(0, 80) ?? null,
      body.utm_campaign?.slice(0, 120) ?? null,
    ]
  );
  const submissionId = (submissionRows[0] as { id: number }).id;

  // Detect source: utm_source from Facebook ads, or referrer, or default
  const utmSource = body.utm_source?.toLowerCase?.() ?? '';
  const utmMedium = body.utm_medium?.toLowerCase?.() ?? '';
  const referrer = (body.referrer ?? '').toLowerCase();
  const leadSource = utmSource.includes('facebook') || utmSource.includes('fb') || utmMedium === 'paid'
    ? 'facebook-ad'
    : utmSource.includes('google')
      ? 'google-ad'
      : referrer.includes('facebook.com') || referrer.includes('fb.com')
        ? 'facebook-organic'
        : 'site_web';

  // Also insert into crm_leads so Aria can follow up
  const notesParts = [body.service, body.surface_estimee ? `${body.surface_estimee} pi²` : null, body.type_projet, body.adresse].filter(Boolean).join(' — ');
  const crmResult = await db(
    `INSERT INTO crm_leads (nom, telephone, email, service, ville, source, statut, temperature, notes)
     VALUES ($1, $2, $3, $4, $5, $6, 'nouveau', 'chaud', $7)
     ON CONFLICT (email) DO UPDATE SET
       telephone = COALESCE(NULLIF(crm_leads.telephone, ''), EXCLUDED.telephone),
       service = COALESCE(EXCLUDED.service, crm_leads.service),
       ville = COALESCE(EXCLUDED.ville, crm_leads.ville),
       notes = crm_leads.notes || E'\n' || EXCLUDED.notes,
       temperature = 'chaud',
       updated_at = NOW()
     RETURNING id`,
    [
      body.nom.slice(0, 120),
      body.telephone?.slice(0, 30) ?? null,
      body.email.slice(0, 255).toLowerCase(),
      body.service?.slice(0, 80) ?? null,
      body.ville?.slice(0, 120) ?? null,
      leadSource,
      notesParts || `Soumission #${submissionId}`,
    ]
  ).catch(() => []); // Don't fail

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
        `INSERT INTO quotes (client_nom, client_email, client_tel, client_adresse, type_service, superficie, prix_pied_carre, rabais_pct, rabais_montant, sous_total, tps, tvq, total, depot_requis, submission_id, statut)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'brouillon')
         RETURNING id`,
        [
          body.nom.slice(0, 120),
          body.email.slice(0, 255),
          body.telephone?.slice(0, 30) ?? null,
          body.adresse?.slice(0, 500) ?? null,
          serviceType,
          surfaceNum,
          calc.prix_pied_carre,
          calc.rabais_pct,
          calc.rabais_montant,
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

  // Analyze lead with Claude before notifying
  const leadAnalysis = await analyzeLeadWithClaude({
    nom: body.nom,
    telephone: body.telephone ?? null,
    service: body.service ?? null,
    surface_estimee: body.surface_estimee ?? null,
    ville: body.ville ?? null,
    type_projet: body.type_projet ?? null,
  });

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
    leadAnalysis,
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
    if (botToken && !isQuietHours()) {
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

  // Special alert for balcon/patio/terrasse — SMS auto au client pour photos dès la soumission
  const isBalconSubmission = ['balcon', 'patio', 'terrasse'].some(kw =>
    [body.service, body.type_projet, body.notes, body.adresse].some(f => (f ?? '').toLowerCase().includes(kw))
  );
  if (isBalconSubmission && body.telephone) {
    const prenom = (body.nom ?? '').split(' ')[0];
    const greeting = prenom ? `Bonjour ${prenom}!` : 'Bonjour!';
    const photoMsg = `${greeting} On a bien reçu votre demande de soumission Novus Époxy pour votre balcon. Pour vous préparer un prix précis, pourriez-vous nous envoyer quelques photos? Répondez à ce texto avec vos photos (vue d'ensemble + zones à réparer). Merci! 📸`;
    await sendSMSNotif(body.telephone, photoMsg);
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

async function sha256(str: string): Promise<string> {
  const buf    = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
