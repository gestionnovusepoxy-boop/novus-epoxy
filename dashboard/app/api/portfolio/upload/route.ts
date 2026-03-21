import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { put } from '@vercel/blob';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });

  const form = await req.formData();
  const files = form.getAll('photos') as File[];

  if (files.length === 0) {
    return NextResponse.json({ error: 'Aucun fichier' }, { status: 400 });
  }

  const urls: string[] = [];

  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    if (file.size > 10 * 1024 * 1024) continue;

    const ext = file.name.split('.').pop() ?? 'jpg';
    const name = `portfolio/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const blob = await put(name, file, {
      access: 'public',
      addRandomSuffix: false,
    });

    urls.push(blob.url);
  }

  return NextResponse.json({ urls });
}
