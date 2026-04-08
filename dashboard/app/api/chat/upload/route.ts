import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { getOrCreateConversation, processMessage } from '@/lib/agent';

async function uploadFile(file: File, blobPath: string): Promise<string> {
  try {
    const blob = await put(blobPath, file, { access: 'public', addRandomSuffix: false });
    return blob.url;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('Blob upload failed, falling back to local:', msg);
  }

  const filename = path.basename(blobPath);
  const publicDir = path.join(process.cwd(), 'public', 'chat-uploads');
  await mkdir(publicDir, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(publicDir, filename), buffer);
  return `/chat-uploads/${filename}`;
}

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

  const imageUrl = await uploadFile(file, name);

  const conversationId = await getOrCreateConversation('web', visitorId);

  // Send image URL as a message so Nova and admin can see it
  const message = `[Photo envoyée] ${imageUrl}`;
  const reply = await processMessage(
    { conversationId, channel: 'web', visitorId },
    message,
  );

  return NextResponse.json({ reply, conversation_id: conversationId, image_url: imageUrl });
}
