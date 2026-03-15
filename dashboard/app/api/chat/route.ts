import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateConversation, processMessage } from '@/lib/agent';

// Public endpoint — chat widget on novusepoxy.ca
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.message || typeof body.message !== 'string') {
    return NextResponse.json({ error: 'Message requis' }, { status: 400 });
  }

  const message = body.message.slice(0, 2000);
  const visitorId = body.visitor_id?.slice(0, 120) || 'anonymous-web';

  const conversationId = await getOrCreateConversation('web', visitorId);

  const reply = await processMessage(
    { conversationId, channel: 'web', visitorId },
    message,
  );

  return NextResponse.json({ reply, conversation_id: conversationId });
}
