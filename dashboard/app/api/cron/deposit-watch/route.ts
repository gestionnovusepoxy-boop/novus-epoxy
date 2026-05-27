import { NextRequest, NextResponse } from 'next/server';
import { getAdminChatIds } from '@/lib/telegram-utils';
import { query, transaction } from '@/lib/db';
import { formatMoney } from '@/lib/pricing';
import { isQuietHours } from '@/lib/telegram-utils';
import { insertInvoiceWithRetry } from '@/lib/invoice-numero';

const BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN ?? '';
const ADMIN_CHAT_IDS = () =>
  getAdminChatIds();

async function sendTelegram(chatId: string, text: string) {
  const token = BOT_TOKEN();
  if (!token) return;
  const chunks = text.match(/[\s\S]{1,4000}/g) ?? [text];
  for (const chunk of chunks) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: chunk, parse_mode: 'HTML' }),
    });
  }
}

export const maxDuration = 60;

// Vercel Cron — Auto-detect deposits and missing final payments
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')?.replace('Bearer ', '') ?? '';
  const cronSecret = process.env.CRON_SECRET ?? '';
  const adminKey = process.env.ADMIN_API_KEY ?? '';
  if (!authHeader || (authHeader !== cronSecret && authHeader !== adminKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (isQuietHours()) return NextResponse.json({ skipped: 'quiet hours' });

  // Wrap the whole handler so any uncaught error surfaces as diagnostic JSON
  // instead of an empty 500 body (which is what was happening in prod).
  try {
  let depositsCreated = 0;
  let balanceAlerts = 0;

  // --- 1. Quotes with depot_paye status but no payment record ---
  // Note: quotes table is flat (no client_id FK) — client info is embedded as client_nom/email/tel.
  // For the invoice we just leave client_id NULL (invoices.client_id is nullable).
  const depositQuotes = await query(`
    SELECT q.id, q.client_nom, q.depot_requis, q.total, q.deposit_paid_at
    FROM quotes q
    WHERE q.statut = 'depot_paye'
      AND q.deposit_paid_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM invoices inv
        JOIN payments p ON p.invoice_id = inv.id
        WHERE inv.quote_id = q.id AND p.type = 'depot'
      )
  `);

  for (const q of depositQuotes) {
    const quoteId = q.id as number;
    const clientId: number | null = null;
    const depotMontant = Number(q.depot_requis ?? 0);
    if (depotMontant <= 0) continue;

    try {
      // Find or create invoice for this quote
      let invoiceRows = await query(
        `SELECT id FROM invoices WHERE quote_id = $1 LIMIT 1`,
        [quoteId]
      );

      if (invoiceRows.length === 0) {
        // Get quote details for invoice — MUST include rabais_pct/rabais_montant
        // because the INSERT below references qd.rabais_pct and qd.rabais_montant.
        const quoteDetails = await query(
          `SELECT type_service, superficie, prix_pied_carre, rabais_pct, rabais_montant, sous_total, tps, tvq, total, depot_requis
           FROM quotes WHERE id = $1`,
          [quoteId]
        );
        const qd = quoteDetails[0];

        invoiceRows = await insertInvoiceWithRetry({ digits: 4 }, (numero) =>
          query(
            `INSERT INTO invoices (numero, quote_id, client_id, type_service, superficie, prix_pied_carre, rabais_pct, rabais_montant, sous_total, tps, tvq, total, depot_montant, statut)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'en_cours')
             RETURNING id`,
            [
              numero, quoteId, clientId,
              qd.type_service, qd.superficie, qd.prix_pied_carre,
              qd.rabais_pct ?? 0, qd.rabais_montant ?? 0,
              qd.sous_total, qd.tps, qd.tvq, qd.total, qd.depot_requis,
            ]
          )
        );
      }

      const invoiceId = invoiceRows[0].id as number;

      // Payment insert + invoice flag update MUST be atomic — otherwise a payment
      // can be recorded without the deposit flag flipping (or vice versa), leaving
      // accounting out of sync. Wrap both in a transaction (P1-6).
      await transaction(async (txq) => {
        await txq(
          `INSERT INTO payments (invoice_id, type, montant, methode, notes, paid_at)
           VALUES ($1, 'depot', $2, 'autre', 'Auto-detecte par deposit-watch', $3)`,
          [invoiceId, depotMontant, q.deposit_paid_at]
        );
        await txq(
          `UPDATE invoices SET depot_paye = true, depot_paye_at = $1 WHERE id = $2`,
          [q.deposit_paid_at, invoiceId]
        );
      });

      // Telegram notification
      const chatIds = ADMIN_CHAT_IDS();
      const msg = `Depot recu pour devis <b>#${quoteId}</b> -- <b>${formatMoney(depotMontant)}</b>\nClient: ${q.client_nom}`;
      for (const chatId of chatIds) {
        await sendTelegram(chatId, msg);
      }

      depositsCreated++;
    } catch (err) {
      console.error(`deposit-watch: error processing quote #${quoteId}:`, err);
    }
  }

  // --- 2. Completed bookings with no final payment (alert once per day max via kv_store) ---
  const completedNoFinal = await query(`
    SELECT q.id, q.client_nom, q.total, q.depot_requis
    FROM quotes q
    JOIN bookings b ON b.quote_id = q.id
    WHERE b.statut = 'complete'
      AND q.statut IN ('planifie', 'depot_paye', 'complete')
      AND NOT EXISTS (
        SELECT 1 FROM invoices inv
        JOIN payments p ON p.invoice_id = inv.id
        WHERE inv.quote_id = q.id AND p.type = 'final'
      )
  `);

  for (const q of completedNoFinal) {
    const balance = Number(q.total ?? 0) - Number(q.depot_requis ?? 0);
    if (balance <= 0) continue;

    // Dedup: only alert once per quote per day
    const alertKey = `balance_alert_${q.id}`;
    const lastAlert = await query(`SELECT value FROM kv_store WHERE key = $1`, [alertKey]);
    const today = new Date().toISOString().split('T')[0];
    if (lastAlert.length > 0 && (lastAlert[0].value as string).includes(today)) continue;

    await query(
      `INSERT INTO kv_store (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`,
      [alertKey, JSON.stringify({ alerted_at: today })]
    );

    const chatIds = ADMIN_CHAT_IDS();
    const msg = `💰 <b>Balance en attente!</b>\n\n👤 ${q.client_nom}\n📋 Devis #${q.id}\n💵 Balance: <b>${formatMoney(balance)}</b>\n\n⚡ Contacter le client pour le paiement final.`;
    const buttons = JSON.stringify({ inline_keyboard: [[
      { text: '📋 Voir dashboard', url: 'https://novus-epoxy.vercel.app/dashboard/devis' },
    ]]});
    for (const chatId of chatIds) {
      const token = BOT_TOKEN();
      if (!token) continue;
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML', reply_markup: buttons }),
      }).catch(() => {});
    }

    balanceAlerts++;
  }

  return NextResponse.json({
    ok: true,
    deposits_created: depositsCreated,
    balance_alerts: balanceAlerts,
  });
  } catch (err) {
    const e = err as Error;
    console.error('deposit-watch fatal:', e);
    return NextResponse.json(
      { error: e?.message ?? 'unknown', stack: e?.stack ?? null },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
