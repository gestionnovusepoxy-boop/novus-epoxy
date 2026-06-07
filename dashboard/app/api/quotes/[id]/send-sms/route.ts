import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { query } from '@/lib/db';
import { SERVICES, type ServiceType, formatMoney } from '@/lib/pricing';
import { sendSMS } from '@/lib/sms';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin(_req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const rows = await query('SELECT * FROM quotes WHERE id = $1', [parseInt(id)]);
  const quote = rows[0];
  if (!quote) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });

  if (!quote.client_tel) {
    return NextResponse.json({ error: 'Pas de numero de telephone pour ce client' }, { status: 400 });
  }

  const service = SERVICES[quote.type_service as ServiceType]
    ?? ({ label: String(quote.type_service ?? 'Service') } as unknown as (typeof SERVICES)[ServiceType]);
  const secretToken = quote.secret_token as string;
  const solde70 = formatMoney(Number(quote.total) - Number(quote.depot_requis));

  const msg = [
    `Bonjour ${quote.client_nom}!`,
    `Voici votre soumission Novus Epoxy #${quote.id} :`,
    ``,
    `${service.label}${quote.couleur_flake ? ` - ${quote.couleur_flake}` : ''}`,
    `${quote.superficie} pi² x ${formatMoney(Number(quote.prix_pied_carre))}/pi²`,
    `Sous-total: ${formatMoney(Number(quote.sous_total))}`,
    `TPS: ${formatMoney(Number(quote.tps))}`,
    `TVQ: ${formatMoney(Number(quote.tvq))}`,
    `Total: ${formatMoney(Number(quote.total))}`,
    ``,
    `Depot (30%): ${formatMoney(Number(quote.depot_requis))}`,
    `Solde: ${solde70}`,
    ``,
    `Adresse: ${quote.client_adresse ?? 'Non specifiee'}`,
    ``,
    `Pour planifier vos travaux:`,
    `https://novus-epoxy.vercel.app/reservation/${quote.id}?token=${encodeURIComponent(secretToken)}`,
    ``,
    `Questions? 581-307-2678`,
  ].join('\n');

  const sent = await sendSMS(quote.client_tel as string, msg);
  if (!sent) {
    return NextResponse.json({ error: 'Echec envoi SMS — verifiez Twilio' }, { status: 500 });
  }

  // Update status if still brouillon/en_attente/approuve
  if (['brouillon', 'en_attente', 'approuve'].includes(quote.statut as string)) {
    await query(`UPDATE quotes SET statut = 'envoye', sent_at = NOW() WHERE id = $1`, [parseInt(id)]);
  }

  return NextResponse.json({ success: true, method: 'sms' });
}
