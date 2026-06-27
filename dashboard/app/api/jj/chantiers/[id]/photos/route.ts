import { NextRequest, NextResponse } from 'next/server';
import { requireJJ } from '@/lib/auth';
import { query } from '@/lib/db';
import { put, del } from '@vercel/blob';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

async function uploadFile(file: File, blobPath: string, localDir: string): Promise<string> {
  try {
    const blob = await put(blobPath, file, { access: 'public', addRandomSuffix: false });
    return blob.url;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('Blob upload failed, falling back to local:', msg);
  }
  const filename = path.basename(blobPath);
  const publicDir = path.join(process.cwd(), 'public', localDir);
  await mkdir(publicDir, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(publicDir, filename), buffer);
  return `/${localDir}/${filename}`;
}

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const gate = await requireJJ(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const chantierId = parseInt(id, 10);
  if (!Number.isFinite(chantierId)) {
    return NextResponse.json({ error: 'id invalide' }, { status: 400 });
  }

  const form = await req.formData();
  const type = form.get('type') as string | null;
  const photo = form.get('photo') as File | null;

  if (!type || !photo) {
    return NextResponse.json({ error: 'type et photo requis' }, { status: 400 });
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

  const rows = await query(`SELECT id, photos_avant, photos_apres FROM jj_chantiers WHERE id = $1`, [chantierId]);
  if (rows.length === 0) return NextResponse.json({ error: 'Chantier introuvable' }, { status: 404 });

  const ext = photo.name.split('.').pop() ?? 'jpg';
  const blobPath = `jj/${chantierId}/${type}-${Date.now()}.${ext}`;
  const url = await uploadFile(photo, blobPath, `jj/${chantierId}`);

  const col = type === 'avant' ? 'photos_avant' : 'photos_apres';
  const current = (rows[0][col] as Array<{ url: string; name: string }>) ?? [];
  const updated = [...current, { url, name: photo.name }];

  await query(
    `UPDATE jj_chantiers SET ${col} = $1::jsonb, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(updated), chantierId],
  );

  return NextResponse.json({ url }, { status: 201 });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const gate = await requireJJ(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const chantierId = parseInt(id, 10);
  if (!Number.isFinite(chantierId)) {
    return NextResponse.json({ error: 'id invalide' }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type');
  const url = searchParams.get('url');

  if (!type || !url || !['avant', 'apres'].includes(type)) {
    return NextResponse.json({ error: 'type et url requis (avant|apres)' }, { status: 400 });
  }

  const rows = await query(`SELECT id, photos_avant, photos_apres FROM jj_chantiers WHERE id = $1`, [chantierId]);
  if (rows.length === 0) return NextResponse.json({ error: 'Chantier introuvable' }, { status: 404 });

  const col = type === 'avant' ? 'photos_avant' : 'photos_apres';
  const current = (rows[0][col] as Array<{ url: string; name: string }>) ?? [];
  const updated = current.filter(p => p.url !== url);

  await query(
    `UPDATE jj_chantiers SET ${col} = $1::jsonb, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(updated), chantierId],
  );

  try { await del(url); } catch { /* best-effort */ }

  return NextResponse.json({ success: true });
}
