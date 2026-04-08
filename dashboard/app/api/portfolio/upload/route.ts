import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { put } from '@vercel/blob';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

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
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const blobPath = `portfolio/${filename}`;

    // Try Vercel Blob first
    try {
      const blob = await put(blobPath, file, {
        access: 'public',
        addRandomSuffix: false,
      });
      urls.push(blob.url);
      continue;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('Blob upload failed, falling back to local:', msg);
    }

    // Fallback: save to public/portfolio/ (works in dev, persists on Vercel via deploy)
    try {
      const publicDir = path.join(process.cwd(), 'public', 'portfolio');
      await mkdir(publicDir, { recursive: true });
      const buffer = Buffer.from(await file.arrayBuffer());
      await writeFile(path.join(publicDir, filename), buffer);
      urls.push(`/portfolio/${filename}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('Local save also failed:', msg);
      // Last resort: base64 data URL (stored directly in DB)
      const buffer = Buffer.from(await file.arrayBuffer());
      const base64 = buffer.toString('base64');
      const mimeType = file.type || 'image/jpeg';
      urls.push(`data:${mimeType};base64,${base64}`);
    }
  }

  return NextResponse.json({ urls });
}
