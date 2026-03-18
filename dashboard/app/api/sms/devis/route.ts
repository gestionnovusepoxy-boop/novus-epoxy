import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { query } from '@/lib/db';
import { SERVICES, type ServiceType, calculateQuote, formatMoney } from '@/lib/pricing';
import { sendSMS, notifyAdminSMS } from '@/lib/sms';

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// POST — Quick create + send quote via SMS
// Protected by ADMIN_API_KEY for use from Telegram bot or CLI
export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key') ?? req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const expectedKey = process.env.ADMIN_API_KEY;

  if (!expectedKey || !apiKey || !safeCompare(expectedKey, apiKey)) {
    return NextResponse.json({ error: 'Non autorise' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Body requis' }, { status: 400 });

  const {
    client_nom, client_tel, client_email,
    client_adresse, type_service, superficie,
    couleur_flake, notes,
  } = body as Record<string, string>;

  if (!client_nom || !client_tel || !type_service || !superficie) {
    return NextResponse.json({
      error: 'Champs requis: client_nom, client_tel, type_service, superficie',
    }, { status: 400 });
  }

  const serviceKey = type_service as ServiceType;
  if (!SERVICES[serviceKey]) {
    return NextResponse.json({ error: 'type_service invalide (flake, metallique, commercial)' }, { status: 400 });
  }

  const calc = calculateQuote(serviceKey, Number(superficie));
  const service = SERVICES[serviceKey];

  // Create quote in DB
  const rows = await query(
    `INSERT INTO quotes (
      client_nom, client_email, client_tel, client_adresse,
      type_service, superficie, couleur_flake, notes,
      prix_pied_carre, sous_total, tps, tvq, total, depot_requis,
      statut, approved_at, sent_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'envoye',NOW(),NOW())
    RETURNING id`,
    [
      client_nom, client_email ?? '', client_tel, client_adresse ?? '',
      serviceKey, Number(superficie), couleur_flake ?? null, notes ?? null,
      calc.prix_pied_carre, calc.sous_total, calc.tps, calc.tvq, calc.total, calc.depot_requis,
    ]
  );

  const quoteId = rows[0].id as number;
  const solde70 = formatMoney(calc.total - calc.depot_requis);

  const msg = [
    `Bonjour ${client_nom}!`,
    `Voici votre soumission Novus Epoxy #${quoteId} :`,
    ``,
    `${service.label}${couleur_flake ? ` - ${couleur_flake}` : ''}`,
    `${superficie} pi² x ${formatMoney(calc.prix_pied_carre)}/pi²`,
    `Sous-total: ${formatMoney(calc.sous_total)}`,
    `TPS: ${formatMoney(calc.tps)}`,
    `TVQ: ${formatMoney(calc.tvq)}`,
    `Total: ${formatMoney(calc.total)}`,
    ``,
    `Depot (30%): ${formatMoney(calc.depot_requis)}`,
    `Solde: ${solde70}`,
    ``,
    ...(client_adresse ? [`Adresse: ${client_adresse}`, ``] : []),
    `Pour planifier vos travaux:`,
    `https://novus-epoxy.vercel.app/reservation/${quoteId}`,
    ``,
    `Questions? 581-307-2678`,
  ].join('\n');

  const sent = await sendSMS(client_tel, msg);

  // Notify admins
  await notifyAdminSMS(quoteId, client_nom);

  return NextResponse.json({
    success: true,
    quote_id: quoteId,
    sms_sent: sent,
    total: formatMoney(calc.total),
    depot: formatMoney(calc.depot_requis),
  });
}
