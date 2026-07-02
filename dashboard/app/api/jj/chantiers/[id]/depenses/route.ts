import { NextRequest, NextResponse } from 'next/server';
import { requireJJ } from '@/lib/auth';
import { query } from '@/lib/db';
import { put } from '@vercel/blob';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

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

export async function GET(req: NextRequest, { params }: Params) {
  const gate = await requireJJ(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const chantierId = parseInt(id, 10);
  if (!Number.isFinite(chantierId)) {
    return NextResponse.json({ error: 'id invalide' }, { status: 400 });
  }

  const rows = await query(
    `SELECT * FROM jj_depenses WHERE chantier_id = $1 ORDER BY created_at DESC`,
    [chantierId],
  );

  const du = (rows as Array<Record<string, unknown>>)
    .filter(r => !r.rembourse)
    .reduce((s, r) => s + num(r.sous_total), 0);
  const rembourse = (rows as Array<Record<string, unknown>>)
    .filter(r => r.rembourse)
    .reduce((s, r) => s + num(r.sous_total), 0);

  return NextResponse.json({
    data: rows.map(r => ({ ...r, sous_total: num(r.sous_total) })),
    du: Math.round(du * 100) / 100,
    rembourse: Math.round(rembourse * 100) / 100,
  });
}

export async function POST(req: NextRequest, { params }: Params) {
  const gate = await requireJJ(req);
  if (gate instanceof NextResponse) return gate;

  const { id } = await params;
  const chantierId = parseInt(id, 10);
  if (!Number.isFinite(chantierId)) {
    return NextResponse.json({ error: 'id invalide' }, { status: 400 });
  }

  // Deux modes: multipart/formData (avec photo du reçu) ou JSON.
  let description: string | undefined;
  let sousTotal = 0;
  let recuUrl: string | null = null;

  const contentType = req.headers.get('content-type') ?? '';

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    description = (form.get('description') as string | null) ?? undefined;
    sousTotal = num(form.get('sous_total'));
    const photo = form.get('photo') as File | null;

    if (photo && photo.size > 0) {
      if (!photo.type.startsWith('image/')) {
        return NextResponse.json({ error: 'Le fichier doit etre une image' }, { status: 400 });
      }
      if (photo.size > 10 * 1024 * 1024) {
        return NextResponse.json({ error: 'Fichier trop gros (max 10MB)' }, { status: 400 });
      }
      const ext = photo.name.split('.').pop() ?? 'jpg';
      const blobPath = `jj/depenses/${chantierId}-${Date.now()}.${ext}`;
      recuUrl = await uploadFile(photo, blobPath, 'jj/depenses');
    } else {
      const rawUrl = form.get('recu_url');
      recuUrl = typeof rawUrl === 'string' && rawUrl ? rawUrl : null;
    }
  } else {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Corps invalide' }, { status: 400 });
    description = body.description;
    sousTotal = body.sous_total != null ? num(body.sous_total) : 0;
    recuUrl = typeof body.recu_url === 'string' ? body.recu_url : null;
  }

  if (!description) {
    return NextResponse.json({ error: 'description requise' }, { status: 400 });
  }

  const exists = await query(`SELECT id FROM jj_chantiers WHERE id = $1`, [chantierId]);
  if (exists.length === 0) return NextResponse.json({ error: 'Chantier introuvable' }, { status: 404 });

  const rows = await query(
    `INSERT INTO jj_depenses (chantier_id, description, sous_total, recu_url)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [chantierId, description, sousTotal, recuUrl],
  );

  return NextResponse.json({ ...rows[0], sous_total: num(rows[0].sous_total) }, { status: 201 });
}
