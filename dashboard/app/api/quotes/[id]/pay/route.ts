import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import Stripe from 'stripe';
import { formatMoney } from '@/lib/pricing';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const quoteId = parseInt(id);
  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ error: 'Token requis' }, { status: 403 });
  }

  const rows = await query('SELECT * FROM quotes WHERE id = $1 AND secret_token = $2', [quoteId, token]);
  if (!rows[0]) {
    return NextResponse.json({ error: 'Devis introuvable' }, { status: 404 });
  }

  const quote = rows[0];
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  if (!stripeKey) {
    // Stripe not configured — show friendly message
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Paiement — Novus Epoxy</title></head>
<body style="margin:0;padding:0;background:#0f172a;color:#f8fafc;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">
<div style="text-align:center;max-width:500px;padding:20px;">
<h1 style="font-size:24px;margin:0 0 16px;">Paiement en ligne bientot disponible</h1>
<p style="color:#94a3b8;margin:0 0 20px;">En attendant, payez par virement Interac a:</p>
<div style="background:#1e293b;border-radius:12px;padding:20px;border:1px solid #334155;">
<p style="color:#f59e0b;font-weight:700;font-size:18px;margin:0 0 8px;">gestionnovusepoxy@gmail.com</p>
<p style="color:#94a3b8;font-size:13px;margin:0;">Virement Interac ou cheque a l'ordre de Novus Epoxy</p>
</div>
</div></body></html>`;
    return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const stripe = new Stripe(stripeKey, {
    httpClient: Stripe.createFetchHttpClient(),
  });
  const total = Number(quote.total);
  const depot = Number(quote.depot_requis);
  const balance = total - depot;
  const baseUrl = 'https://novus-epoxy.vercel.app';

  // Determine payment needed
  const statut = quote.statut as string;

  // If fully paid (both deposit and balance)
  if (quote.deposit_paid_at && quote.balance_paid_at) {
    return NextResponse.redirect(`${baseUrl}/paiement/${quoteId}?success=true`);
  }

  let amount: number;
  let description: string;
  let paymentType: 'deposit' | 'balance';

  if (statut === 'contrat_signe') {
    // Need to pay deposit
    amount = depot;
    description = `Novus Epoxy — Devis #${quoteId} — Depot 30%`;
    paymentType = 'deposit';
  } else if (['depot_paye', 'planifie', 'complete'].includes(statut)) {
    // Deposit paid, need balance
    if (quote.balance_paid_at) {
      return NextResponse.redirect(`${baseUrl}/paiement/${quoteId}?success=true`);
    }
    amount = balance;
    description = `Novus Epoxy — Devis #${quoteId} — Solde 70%`;
    paymentType = 'balance';
  } else {
    // Not ready for payment yet
    return NextResponse.redirect(`${baseUrl}/paiement/${quoteId}`);
  }

  // 3% card processing fee
  const fraisCarte = Math.round(amount * 0.03 * 100) / 100;
  const totalAvecFrais = amount + fraisCarte;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'cad',
            product_data: {
              name: description,
            },
            unit_amount: Math.round(amount * 100),
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: 'cad',
            product_data: {
              name: 'Frais de traitement carte (3%)',
            },
            unit_amount: Math.round(fraisCarte * 100),
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${baseUrl}/paiement/${quoteId}?success=true&token=${encodeURIComponent(token as string)}`,
      cancel_url: `${baseUrl}/paiement/${quoteId}?cancelled=true&token=${encodeURIComponent(token as string)}`,
      metadata: {
        quote_id: String(quoteId),
        payment_type: paymentType,
      },
      customer_email: quote.client_email as string,
    });

    if (!session.url) {
      return NextResponse.json({ error: 'Erreur Stripe: pas de URL' }, { status: 500 });
    }

    // Save session ID
    if (paymentType === 'deposit') {
      await query('UPDATE quotes SET stripe_deposit_session_id = $1 WHERE id = $2', [session.id, quoteId]);
    } else {
      await query('UPDATE quotes SET stripe_balance_session_id = $1 WHERE id = $2', [session.id, quoteId]);
    }

    return NextResponse.redirect(session.url);
  } catch (err: unknown) {
    console.error('Stripe session creation error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: 'Erreur lors de la creation de la session de paiement' }, { status: 500 });
  }
}
