import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { generateContractHtml } from '@/lib/contract-pdf';
import { formatMoney } from '@/lib/pricing';
import { escapeHtml } from '@/lib/utils';
import { sendSMS } from '@/lib/sms';

// GET — Returns the contract HTML for viewing/printing (admin only)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorise' }, { status: 401 });

  const { id } = await params;
  const rows = await query(
    `SELECT q.*, b.jour1_date AS booking_jour1_date, b.jour2_date AS booking_jour2_date, b.jour2_slot AS booking_jour2_slot
     FROM quotes q LEFT JOIN bookings b ON b.id = q.booking_id
     WHERE q.id = $1`,
    [parseInt(id)]
  );
  const quote = rows[0];
  if (!quote) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });

  const fmtBookingDate = (d: unknown) => {
    if (!d) return null;
    if (d instanceof Date) return d.toISOString().split('T')[0];
    return String(d);
  };

  const html = generateContractHtml({
    id: quote.id as number,
    client_nom: quote.client_nom as string,
    client_email: quote.client_email as string,
    client_tel: quote.client_tel as string | null,
    client_adresse: quote.client_adresse as string | null,
    type_service: quote.type_service as string,
    superficie: Number(quote.superficie),
    etat_plancher: quote.etat_plancher as string | null,
    notes: quote.notes as string | null,
    sous_total: Number(quote.sous_total),
    tps: Number(quote.tps),
    tvq: Number(quote.tvq),
    total: Number(quote.total),
    depot_requis: Number(quote.depot_requis),
    created_at: quote.created_at as string,
    booking_jour1_date: fmtBookingDate(quote.booking_jour1_date),
    booking_jour2_date: fmtBookingDate(quote.booking_jour2_date),
    booking_jour2_slot: quote.booking_jour2_slot as string | null,
  });

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// POST — Client signs the contract (public endpoint, verified by email)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);

  if (!body?.client_email || !body?.signature_nom) {
    return NextResponse.json({ error: 'client_email et signature_nom requis' }, { status: 400 });
  }

  const quoteId = parseInt(id);
  const rows = await query('SELECT * FROM quotes WHERE id = $1', [quoteId]);
  const quote = rows[0];
  if (!quote) return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });

  // Verify email matches
  const clientEmail = (body.client_email as string).toLowerCase().trim();
  const quoteEmail = (quote.client_email as string).toLowerCase().trim();
  if (clientEmail !== quoteEmail) {
    return NextResponse.json({ error: 'Acces refuse' }, { status: 403 });
  }

  // Check quote is in correct state
  if (quote.statut !== 'envoye') {
    const laterStatuts = ['contrat_signe', 'depot_paye', 'planifie', 'complete'];
    if (laterStatuts.includes(quote.statut as string)) {
      return NextResponse.json({ error: 'Contrat deja signe', already_signed: true }, { status: 400 });
    }
    return NextResponse.json({ error: 'Ce devis ne peut pas etre signe' }, { status: 400 });
  }

  // Sign the contract
  const signatureNom = (body.signature_nom as string).trim();
  await query(
    `UPDATE quotes SET statut = 'contrat_signe', contrat_signe_at = NOW(), contrat_signature_nom = $1 WHERE id = $2`,
    [signatureNom, quoteId]
  );

  // Send confirmation email to client
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? 'onboarding@resend.dev';

  if (apiKey) {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#ffffff;">
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
<div style="background:#0f172a;color:white;padding:20px 24px;border-radius:8px 8px 0 0;">
<h2 style="margin:0;font-size:20px;">Contrat signe avec succes!</h2>
<p style="margin:4px 0 0;color:#f59e0b;font-size:14px;">Novus Epoxy — Devis #${quoteId}</p>
</div>
<div style="padding:20px 24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;">
<p>Bonjour ${escapeHtml(quote.client_nom as string)},</p>
<p>Merci d'avoir signe le contrat pour votre projet de plancher epoxy. Voici un resume:</p>
<div style="background:#f8fafc;padding:16px;border-radius:8px;margin:16px 0;">
<p style="margin:4px 0;"><strong>Signe par:</strong> ${escapeHtml(signatureNom)}</p>
<p style="margin:4px 0;"><strong>Total:</strong> ${formatMoney(Number(quote.total))}</p>
<p style="margin:4px 0;"><strong>Depot (30%):</strong> ${formatMoney(Number(quote.depot_requis))}</p>
</div>
<div style="background:#fffbeb;border:1px solid #f59e0b;border-radius:8px;padding:16px;margin:16px 0;">
<p style="margin:0;color:#92400e;font-weight:700;">Prochaine etape: payer le depot</p>
<p style="margin:4px 0 0;color:#78716c;font-size:13px;">Pour confirmer votre reservation, veuillez effectuer le depot de ${formatMoney(Number(quote.depot_requis))} par virement Interac ou cheque.</p>
</div>
<p style="color:#64748b;font-size:13px;">Des questions? Contactez-nous:<br/>
<strong>Luca:</strong> 581-307-5983<br/>
<strong>Jason:</strong> 581-307-2678</p>
</div>
</div></body></html>`;

    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [quote.client_email as string],
          subject: `Contrat signe — Novus Epoxy #${quoteId}`,
          html,
        }),
      });
    } catch (err) { console.error('Contract confirmation email failed:', err); }
  }

  // SMS notification to admins (Luca + Jason)
  const adminPhone = process.env.ADMIN_PHONE;
  const jasonPhone = process.env.JASON_PHONE;
  const smsMsg = `Novus Epoxy: ${quote.client_nom} a signe le contrat! Devis #${quoteId} — ${formatMoney(Number(quote.total))}. Depot a recevoir: ${formatMoney(Number(quote.depot_requis))}. https://novus-epoxy.vercel.app/dashboard/devis/${quoteId}`;

  const phones = [adminPhone, jasonPhone].filter(Boolean) as string[];
  await Promise.all(phones.map(phone => sendSMS(phone, smsMsg).catch(() => {})));

  return NextResponse.json({ ok: true });
}
