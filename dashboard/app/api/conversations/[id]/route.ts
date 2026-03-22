import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { calculateQuoteCustomPrice, formatMoney, TPS_RATE, TVQ_RATE } from '@/lib/pricing';
import { notifyAdminSMS } from '@/lib/sms';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const convId = parseInt(id);

  const convRows = await query(`SELECT * FROM conversations WHERE id = $1`, [convId]);
  if (convRows.length === 0) return NextResponse.json({ error: 'Conversation introuvable' }, { status: 404 });

  const messages = await query(
    `SELECT id, role, content, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [convId]
  );

  return NextResponse.json({ conversation: convRows[0], messages });
}

// POST — Admin sends a reply to the client in the chat
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const { id } = await params;
  const convId = parseInt(id);
  const body = await req.json().catch(() => null);
  const message = body?.message?.slice(0, 5000);

  if (!message) return NextResponse.json({ error: 'Message requis' }, { status: 400 });

  // Verify conversation exists
  const convRows = await query(`SELECT * FROM conversations WHERE id = $1`, [convId]);
  if (convRows.length === 0) return NextResponse.json({ error: 'Conversation introuvable' }, { status: 404 });

  const conv = convRows[0];

  // Check if admin is setting a price for a balcony quote (e.g. "prix: 1500" or "1500$")
  const priceMatch = message.match(/(?:prix\s*[:=]\s*)?(\d+(?:\.\d{1,2})?)\s*\$/i) ||
                     message.match(/^prix\s*[:=]\s*(\d+(?:\.\d{1,2})?)/i);

  if (priceMatch && conv.status === 'handoff') {
    const customPrice = parseFloat(priceMatch[1]);
    const calc = calculateQuoteCustomPrice(customPrice);

    // Get client info from conversation
    const clientName = conv.visitor_name ?? 'Client';
    const clientEmail = conv.visitor_email ?? '';
    const clientTel = conv.visitor_tel ?? null;
    const clientAdresse = conv.visitor_adresse ?? null;
    const typeService = conv.type_service ?? 'antiderapant';
    const superficie = conv.superficie ?? 0;
    const etatPlancher = conv.etat_plancher ?? null;

    if (!clientEmail) {
      return NextResponse.json({ ok: true, warning: 'Pas d\'email client — devis non cree. Collectez l\'email d\'abord.' });
    }

    // Create the quote with custom price
    const rows = await query(
      `INSERT INTO quotes (client_nom, client_email, client_tel, client_adresse, type_service, superficie, etat_plancher, prix_pied_carre, sous_total, tps, tvq, total, depot_requis, statut)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'brouillon')
       RETURNING id`,
      [
        clientName, clientEmail, clientTel, clientAdresse,
        typeService, superficie, etatPlancher,
        superficie > 0 ? Math.round(customPrice / superficie * 100) / 100 : 0,
        calc.sous_total, calc.tps, calc.tvq, calc.total, calc.depot_requis,
      ]
    );

    const quoteId = rows[0].id as number;
    await query(`UPDATE conversations SET quote_id = $1, status = 'pending_approval' WHERE id = $2`, [quoteId, convId]);

    // Save confirmation message to chat
    const confirmMsg = `Devis #${quoteId} cree! Prix: ${formatMoney(calc.sous_total)} + taxes = ${formatMoney(calc.total)}. Depot: ${formatMoney(calc.depot_requis)}. Le devis sera envoye a ${clientEmail} une fois approuve.`;
    await query(
      `INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`,
      [convId, confirmMsg]
    );

    return NextResponse.json({ ok: true, quote_created: true, quote_id: quoteId, total: calc.total });
  }

  // Normal admin reply
  await query(
    `INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`,
    [convId, message]
  );

  // If conversation was in handoff, move back to active
  if (conv.status === 'handoff') {
    await query(`UPDATE conversations SET status = 'active' WHERE id = $1`, [convId]);
  }

  return NextResponse.json({ ok: true });
}
