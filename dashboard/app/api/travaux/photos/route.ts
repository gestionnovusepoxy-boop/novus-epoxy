import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { query } from '@/lib/db';
import { put, del } from '@vercel/blob';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

async function uploadFile(file: File, blobPath: string, localDir: string): Promise<string> {
  // Try Vercel Blob first
  try {
    const blob = await put(blobPath, file, { access: 'public', addRandomSuffix: false });
    return blob.url;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('Blob upload failed, falling back to local:', msg);
  }

  // Fallback: save to public directory
  const filename = path.basename(blobPath);
  const publicDir = path.join(process.cwd(), 'public', localDir);
  await mkdir(publicDir, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(publicDir, filename), buffer);
  return `/${localDir}/${filename}`;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorise' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const quoteId = searchParams.get('quoteId');
  if (!quoteId) return NextResponse.json({ error: 'quoteId requis' }, { status: 400 });

  const rows = await query(
    `SELECT id, quote_id, type, url, filename, created_at
     FROM job_photos
     WHERE quote_id = $1
     ORDER BY type ASC, created_at ASC`,
    [parseInt(quoteId)]
  );

  return NextResponse.json({ data: rows });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorise' }, { status: 401 });

  const form = await req.formData();
  const quoteId = form.get('quoteId') as string;
  const type = form.get('type') as string;
  const photo = form.get('photo') as File | null;

  if (!quoteId || !type || !photo) {
    return NextResponse.json({ error: 'quoteId, type et photo requis' }, { status: 400 });
  }

  if (!['avant', 'apres'].includes(type)) {
    return NextResponse.json({ error: 'type doit etre avant ou apres' }, { status: 400 });
  }

  if (!photo.type.startsWith('image/')) {
    return NextResponse.json({ error: 'Le fichier doit etre une image' }, { status: 400 });
  }

  if (photo.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: 'Fichier trop gros (max 10MB)' }, { status: 400 });
  }

  const ext = photo.name.split('.').pop() ?? 'jpg';
  const blobName = `travaux/${quoteId}/${type}-${Date.now()}.${ext}`;

  const url = await uploadFile(photo, blobName, `travaux/${quoteId}`);

  const rows = await query(
    `INSERT INTO job_photos (quote_id, type, url, filename)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [parseInt(quoteId), type, url, photo.name]
  );

  return NextResponse.json(rows[0], { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Non autorise' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 });

  const rows = await query(
    `DELETE FROM job_photos WHERE id = $1 RETURNING url`,
    [parseInt(id)]
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Photo non trouvee' }, { status: 404 });
  }

  // Delete from Vercel Blob
  try {
    await del(rows[0].url as string);
  } catch {
    // Blob deletion failed but DB row is already removed
  }

  return NextResponse.json({ success: true });
}
