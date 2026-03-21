import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { sendSMS } from '@/lib/sms';
import { formatMoney } from '@/lib/pricing';
import Stripe from 'stripe';

async function notifyTelegram(message: string) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').filter(Boolean);
  if (!botToken || chatIds.length === 0) return;

  await Promise.all(chatIds.map(chatId =>
    fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId.trim(), text: message, parse_mode: 'Markdown' }),
    }).catch(() => {})
  ));
}

async function sendConfirmationEmail(to: string, subject: string, html: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? 'onboarding@resend.dev';
  if (!apiKey) return;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
  } catch (err) {
    console.error('Email send error:', err);
  }
}

export async function POST(req: NextRequest) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeKey || !webhookSecret) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  const stripe = new Stripe(stripeKey);
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');

  if (!sig) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const quoteId = session.metadata?.quote_id;
    const paymentType = session.metadata?.payment_type;

    if (!quoteId || !paymentType) {
      console.error('Missing metadata in Stripe session:', session.id);
      return NextResponse.json({ received: true });
    }

    const rows = await query('SELECT * FROM quotes WHERE id = $1', [parseInt(quoteId)]);
    if (!rows[0]) {
      console.error('Quote not found for Stripe payment:', quoteId);
      return NextResponse.json({ received: true });
    }

    const quote = rows[0];
    const clientName = quote.client_nom as string;
    const clientEmail = quote.client_email as string;

    if (paymentType === 'deposit') {
      // Check if booking dates are still available
      let datesAvailable = true;
      if (quote.booking_id) {
        const bookings = await query('SELECT * FROM bookings WHERE id = $1', [quote.booking_id]);
        if (bookings[0]) {
          const booking = bookings[0];
          const conflicts = await query(
            `SELECT id FROM bookings
             WHERE statut = 'confirme'
             AND id != $4
             AND (
               (jour1_date = $1 AND jour1_slot = 'matin')
               OR (jour2_date = $2 AND jour2_slot = $3)
               OR (jour1_date = $2 AND jour1_slot = $3)
               OR (jour2_date = $1 AND jour2_slot = 'matin')
             )`,
            [booking.jour1_date, booking.jour2_date, booking.jour2_slot, booking.id]
          );

          if (conflicts.length > 0) {
            datesAvailable = false;
            // Payment accepted but dates conflict — admin must handle
            await notifyTelegram(
              `⚠️ *Depot recu mais CONFLIT de dates!*\n\nDevis #${quoteId} — ${clientName}\nMontant: ${formatMoney(Number(quote.depot_requis))}\n\nLes dates choisies sont deja prises. Offrir de nouvelles dates ou rembourser.\n\n[Voir le devis](https://novus-epoxy.vercel.app/dashboard/devis/${quoteId})`
            );
          }

          if (datesAvailable) {
            // Confirm the booking (freeze dates)
            await query('UPDATE bookings SET statut = $1 WHERE id = $2', ['confirme', booking.id]);
          }
        }
      }

      // Update quote
      await query(
        `UPDATE quotes SET statut = 'depot_paye', paid_at = NOW(), deposit_paid_at = NOW(), stripe_deposit_session_id = $1 WHERE id = $2`,
        [session.id, parseInt(quoteId)]
      );

      // Send confirmation email
      const depositHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#ffffff;">
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
<div style="background:#0f172a;color:white;padding:20px 24px;border-radius:8px 8px 0 0;">
<h2 style="margin:0;font-size:20px;">Depot recu!</h2>
<p style="margin:4px 0 0;color:#f59e0b;font-size:14px;">Novus Epoxy — Devis #${quoteId}</p>
</div>
<div style="padding:20px 24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;">
<p>Bonjour ${clientName},</p>
<p>Nous avons bien recu votre depot de <strong>${formatMoney(Number(quote.depot_requis))}</strong>.</p>
${datesAvailable ? '<p style="color:#16a34a;font-weight:600;">Vos dates de travaux sont maintenant confirmees!</p>' : '<p style="color:#f59e0b;">Notre equipe vous contactera pour confirmer les dates de travaux.</p>'}
<p style="color:#64748b;font-size:13px;">Le solde de ${formatMoney(Number(quote.total) - Number(quote.depot_requis))} sera a payer a la fin des travaux.</p>
<div style="text-align:center;margin:20px 0;">
<a href="https://novus-epoxy.vercel.app/paiement/${quoteId}" style="display:inline-block;background:#0f172a;color:#ffffff;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">Voir mon paiement</a>
</div>
<p style="color:#64748b;font-size:13px;">Questions? Contactez-nous:<br/>
<strong>Luca:</strong> 581-307-5983 | <strong>Jason:</strong> 581-307-2678</p>
</div></div></body></html>`;

      await sendConfirmationEmail(clientEmail, `Depot recu — Novus Epoxy #${quoteId}`, depositHtml);

      // Notify admins via SMS
      const adminPhones = [process.env.ADMIN_PHONE, process.env.JASON_PHONE].filter(Boolean) as string[];
      const smsMsg = datesAvailable
        ? `Novus Epoxy: Depot recu pour devis #${quoteId}! Dates confirmees. ${formatMoney(Number(quote.depot_requis))} de ${clientName}.`
        : `Novus Epoxy: Depot recu pour devis #${quoteId} MAIS dates en conflit! ${formatMoney(Number(quote.depot_requis))} de ${clientName}. Verifier ASAP!`;
      await Promise.all(adminPhones.map(phone => sendSMS(phone, smsMsg)));

      // Notify admins via Telegram
      const telegramMsg = datesAvailable
        ? `💰 *Depot recu pour devis #${quoteId}!*\n\nClient: ${clientName}\nMontant: ${formatMoney(Number(quote.depot_requis))}\nDates confirmees ✅\n\n[Voir le devis](https://novus-epoxy.vercel.app/dashboard/devis/${quoteId})`
        : `💰 *Depot recu pour devis #${quoteId}!*\n\nClient: ${clientName}\nMontant: ${formatMoney(Number(quote.depot_requis))}\n⚠️ Conflit de dates — action requise\n\n[Voir le devis](https://novus-epoxy.vercel.app/dashboard/devis/${quoteId})`;
      await notifyTelegram(telegramMsg);

    } else if (paymentType === 'balance') {
      // Update quote
      await query(
        `UPDATE quotes SET statut = 'complete', balance_paid_at = NOW(), stripe_balance_session_id = $1 WHERE id = $2`,
        [session.id, parseInt(quoteId)]
      );

      // Send confirmation email
      const balanceHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#ffffff;">
<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;">
<div style="background:#0f172a;color:white;padding:20px 24px;border-radius:8px 8px 0 0;">
<h2 style="margin:0;font-size:20px;">Paiement final recu!</h2>
<p style="margin:4px 0 0;color:#22c55e;font-size:14px;">Novus Epoxy — Devis #${quoteId}</p>
</div>
<div style="padding:20px 24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;">
<p>Bonjour ${clientName},</p>
<p>Nous avons bien recu votre paiement final de <strong>${formatMoney(Number(quote.total) - Number(quote.depot_requis))}</strong>.</p>
<p style="color:#16a34a;font-weight:600;">Tous les paiements sont completes. Merci!</p>
<p style="color:#64748b;font-size:13px;">Questions? Contactez-nous:<br/>
<strong>Luca:</strong> 581-307-5983 | <strong>Jason:</strong> 581-307-2678</p>
</div></div></body></html>`;

      await sendConfirmationEmail(clientEmail, `Paiement final recu — Novus Epoxy #${quoteId}`, balanceHtml);

      // Notify admins
      const adminPhones = [process.env.ADMIN_PHONE, process.env.JASON_PHONE].filter(Boolean) as string[];
      const smsMsg = `Novus Epoxy: Solde final recu pour devis #${quoteId}! ${formatMoney(Number(quote.total) - Number(quote.depot_requis))} de ${clientName}.`;
      await Promise.all(adminPhones.map(phone => sendSMS(phone, smsMsg)));

      await notifyTelegram(
        `✅ *Solde final recu pour devis #${quoteId}!*\n\nClient: ${clientName}\nMontant: ${formatMoney(Number(quote.total) - Number(quote.depot_requis))}\nTout est paye!\n\n[Voir le devis](https://novus-epoxy.vercel.app/dashboard/devis/${quoteId})`
      );
    }
  }

  return NextResponse.json({ received: true });
}
