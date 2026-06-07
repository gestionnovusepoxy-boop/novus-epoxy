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
      console.error('Blob upload failed:', msg);
      // Plus de fallback public/ (FS read-only sur Vercel) ni base64 (bourre la DB de data-URLs ~10MB).
      // On échoue proprement — vérifier que BLOB_READ_WRITE_TOKEN est configuré.
      return NextResponse.json(
        { error: 'Upload échoué — stockage Blob indisponible (BLOB_READ_WRITE_TOKEN?)', detail: msg },
        { status: 502 }
      );
    }
  }

  return NextResponse.json({ urls });
}
