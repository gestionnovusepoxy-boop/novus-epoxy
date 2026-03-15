import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getOrCreateConversation } from '@/lib/agent';

const WEBHOOK_SECRET = process.env.OPENCLAW_WEBHOOK_SECRET ?? '';

// POST — Receive events from OpenClaw (Telegram bot Nova)
export async function POST(req: NextRequest) {
  // Verify shared secret
  const authHeader = req.headers.get('authorization');
  if (WEBHOOK_SECRET && authHeader !== `Bearer ${WEBHOOK_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Body requis' }, { status: 400 });

  const event = body.event ?? body.type ?? 'message';

  // Handle different event types from OpenClaw
  switch (event) {
    case 'message':
      return handleMessage(body);
    case 'lead':
      return handleLead(body);
    case 'quote_request':
      return handleQuoteRequest(body);
    default:
      return handleMessage(body);
  }
}

// Handle incoming Telegram message — store as conversation
async function handleMessage(body: Record<string, unknown>) {
  const chatId = String(body.chat_id ?? body.telegram_chat_id ?? '');
  const senderName = (body.sender_name ?? body.name ?? '') as string;
  const senderEmail = (body.sender_email ?? body.email ?? '') as string;
  const message = (body.message ?? body.text ?? '') as string;
  const botReply = (body.bot_reply ?? body.reply ?? '') as string;

  if (!chatId || !message) {
    return NextResponse.json({ error: 'chat_id et message requis' }, { status: 400 });
  }

  const visitorId = `tg_${chatId}`;
  const conversationId = await getOrCreateConversation('telegram', visitorId);

  // Update conversation metadata if provided
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (senderName) { sets.push(`visitor_name = $${i++}`); params.push(senderName.slice(0, 120)); }
  if (senderEmail) { sets.push(`visitor_email = $${i++}`); params.push(senderEmail.slice(0, 255)); }

  if (sets.length > 0) {
    await query(
      `UPDATE conversations SET ${sets.join(', ')} WHERE id = $${i} AND visitor_name IS NULL`,
      [...params, conversationId]
    );
  }

  // Save user message
  await query(
    `INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'user', $2)`,
    [conversationId, message.slice(0, 5000)]
  );

  // Save bot reply if included
  if (botReply) {
    await query(
      `INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'assistant', $2)`,
      [conversationId, botReply.slice(0, 5000)]
    );
  }

  return NextResponse.json({
    ok: true,
    conversation_id: conversationId,
    visitor_id: visitorId,
  });
}

// Handle lead data from OpenClaw
async function handleLead(body: Record<string, unknown>) {
  const nom = (body.name ?? body.nom ?? 'Lead Telegram') as string;
  const email = (body.email ?? '') as string;
  const telephone = (body.phone ?? body.tel ?? '') as string;
  const service = (body.service ?? 'Telegram') as string;
  const message = (body.message ?? body.notes ?? '') as string;
  const chatId = String(body.chat_id ?? body.telegram_chat_id ?? '');

  await query(
    `INSERT INTO submissions (nom, email, telephone, service, message, statut)
     VALUES ($1, $2, $3, $4, $5, 'nouveau')`,
    [
      nom.slice(0, 120),
      email.slice(0, 255),
      telephone ? telephone.slice(0, 30) : null,
      service.slice(0, 100),
      `Via Telegram${chatId ? ` (chat ${chatId})` : ''} — ${message}`.slice(0, 2000),
    ]
  );

  // Also update conversation if chat_id provided
  if (chatId) {
    const visitorId = `tg_${chatId}`;
    const conversationId = await getOrCreateConversation('telegram', visitorId);
    const sets: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    if (nom) { sets.push(`visitor_name = $${i++}`); params.push(nom); }
    if (email) { sets.push(`visitor_email = $${i++}`); params.push(email); }
    if (telephone) { sets.push(`visitor_tel = $${i++}`); params.push(telephone); }

    if (sets.length > 0) {
      await query(
        `UPDATE conversations SET ${sets.join(', ')}, lead_temp = 'warm' WHERE id = $${i}`,
        [...params, conversationId]
      );
    }
  }

  return NextResponse.json({ ok: true, status: 'lead_created' });
}

// Handle quote request from OpenClaw
async function handleQuoteRequest(body: Record<string, unknown>) {
  const nom = (body.name ?? body.nom ?? '') as string;
  const email = (body.email ?? '') as string;
  const telephone = (body.phone ?? body.tel ?? '') as string;
  const adresse = (body.address ?? body.adresse ?? '') as string;
  const typeService = (body.service_type ?? body.type_service ?? '') as string;
  const superficie = Number(body.area ?? body.superficie ?? 0);

  if (!nom || !email || !typeService || !superficie) {
    return NextResponse.json({ error: 'nom, email, type_service et superficie requis' }, { status: 400 });
  }

  // Create submission
  await query(
    `INSERT INTO submissions (nom, email, telephone, service, message, statut)
     VALUES ($1, $2, $3, $4, $5, 'en_traitement')`,
    [nom, email, telephone || null, typeService, `Demande devis Telegram — ${superficie} pi²`]
  );

  return NextResponse.json({ ok: true, status: 'quote_request_received' });
}
