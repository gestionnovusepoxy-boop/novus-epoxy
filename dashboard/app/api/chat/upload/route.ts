import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { getOrCreateConversation, processMessage } from '@/lib/agent';

// Public endpoint — photo upload from chat widget
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get('photo') as File | null;
  const visitorId = (form.get('visitor_id') as string)?.slice(0, 120) || 'anonymous-web';

  if (!file || !file.type.startsWith('image/')) {
    return NextResponse.json({ error: 'Image requise' }, { status: 400 });
  }

  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: 'Image trop grosse (max 10MB)' }, { status: 400 });
  }

  const ext = file.name.split('.').pop() ?? 'jpg';
  const name = `chat/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const blob = await put(name, file, {
    access: 'public',
    addRandomSuffix: false,
  });

  const conversationId = await getOrCreateConversation('web', visitorId);

  // Send image URL as a message so Nova and admin can see it
  const message = `[Photo envoyée] ${blob.url}`;
  const reply = await processMessage(
    { conversationId, channel: 'web', visitorId },
    message,
  );

  return NextResponse.json({ reply, conversation_id: conversationId, image_url: blob.url });
}
