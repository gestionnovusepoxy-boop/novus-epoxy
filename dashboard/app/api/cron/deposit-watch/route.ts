import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { formatMoney } from '@/lib/pricing';

const BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN ?? '';
const ADMIN_CHAT_IDS = () =>
  (process.env.TELEGRAM_ADMIN_CHAT_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

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

  let depositsCreated = 0;
  let balanceAlerts = 0;

  // --- 1. Quotes with depot_paye status but no payment record ---
  const depositQuotes = await query(`
    SELECT q.id, q.client_nom, q.depot_requis, q.total, q.deposit_paid_at,
           q.client_id
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
    const clientId = q.client_id as number | null;
    const depotMontant = Number(q.depot_requis ?? 0);
    if (depotMontant <= 0) continue;

    try {
      // Find or create invoice for this quote
      let invoiceRows = await query(
        `SELECT id FROM invoices WHERE quote_id = $1 LIMIT 1`,
        [quoteId]
      );

      if (invoiceRows.length === 0) {
        // Generate invoice number
        const year = new Date().getFullYear();
        const prefix = `NE-${year}-`;
        const lastNum = await query(
          `SELECT numero FROM invoices WHERE numero LIKE $1 ORDER BY numero DESC LIMIT 1`,
          [`${prefix}%`]
        );
        let nextNum = 1;
        if (lastNum[0]) {
          const parts = String(lastNum[0].numero).split('-');
          nextNum = parseInt(parts[parts.length - 1] ?? '0') + 1;
        }
        const numero = `${prefix}${String(nextNum).padStart(4, '0')}`;

        // Get quote details for invoice
        const quoteDetails = await query(
          `SELECT type_service, superficie, prix_pied_carre, sous_total, tps, tvq, total, depot_requis
           FROM quotes WHERE id = $1`,
          [quoteId]
        );
        const qd = quoteDetails[0];

        invoiceRows = await query(
          `INSERT INTO invoices (numero, quote_id, client_id, type_service, superficie, prix_pied_carre, sous_total, tps, tvq, total, depot_montant, statut)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'en_cours')
           RETURNING id`,
          [
            numero, quoteId, clientId,
            qd.type_service, qd.superficie, qd.prix_pied_carre,
            qd.sous_total, qd.tps, qd.tvq, qd.total, qd.depot_requis,
          ]
        );
      }

      const invoiceId = invoiceRows[0].id as number;

      // Create payment record
      await query(
        `INSERT INTO payments (invoice_id, type, montant, methode, notes, paid_at)
         VALUES ($1, 'depot', $2, 'autre', 'Auto-detecte par deposit-watch', $3)`,
        [invoiceId, depotMontant, q.deposit_paid_at]
      );

      // Update invoice deposit flags
      await query(
        `UPDATE invoices SET depot_paye = true, depot_paye_at = $1 WHERE id = $2`,
        [q.deposit_paid_at, invoiceId]
      );

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

  // --- 2. Completed bookings with no final payment ---
  const completedNoFinal = await query(`
    SELECT q.id, q.client_nom, q.total, q.depot_requis
    FROM quotes q
    JOIN bookings b ON b.quote_id = q.id
    WHERE b.statut = 'complete'
      AND q.statut IN ('planifie', 'depot_paye')
      AND NOT EXISTS (
        SELECT 1 FROM invoices inv
        JOIN payments p ON p.invoice_id = inv.id
        WHERE inv.quote_id = q.id AND p.type = 'final'
      )
  `);

  for (const q of completedNoFinal) {
    const balance = Number(q.total ?? 0) - Number(q.depot_requis ?? 0);
    if (balance <= 0) continue;

    const chatIds = ADMIN_CHAT_IDS();
    const msg = `Travaux termines pour <b>#${q.id}</b> -- balance <b>${formatMoney(balance)}</b> en attente\nClient: ${q.client_nom}`;
    for (const chatId of chatIds) {
      await sendTelegram(chatId, msg);
    }

    balanceAlerts++;
  }

  return NextResponse.json({
    ok: true,
    deposits_created: depositsCreated,
    balance_alerts: balanceAlerts,
  });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
