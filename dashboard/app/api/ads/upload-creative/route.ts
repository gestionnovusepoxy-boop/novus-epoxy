import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { put } from '@vercel/blob';

export const maxDuration = 60;

/**
 * POST /api/ads/upload-creative
 * Form-data: file=<image>
 * OR header x-api-key=ADMIN_API_KEY for terminal upload.
 * OR body { "url": "https://..." } to mirror an external URL.
 *
 * Returns: { url: "https://...vercel-blob.com/ads-creatives/..." }
 * Use the returned URL as customImageUrl in POST /api/ads/propose.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  const apiKey = req.headers.get('x-api-key');
  if (!session && apiKey !== process.env.ADMIN_API_KEY) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }

  const ct = req.headers.get('content-type') ?? '';
  let buffer: Buffer | null = null;
  let filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let mime = 'image/jpeg';

  if (ct.includes('application/json')) {
    // Mirror from external URL
    const body = await req.json().catch(() => ({}));
    const url = String(body.url ?? '');
    if (!url.startsWith('http')) {
      return NextResponse.json({ error: 'url requise (http/https)' }, { status: 400 });
    }
    const fetched = await fetch(url);
    if (!fetched.ok) return NextResponse.json({ error: `Fetch failed ${fetched.status}` }, { status: 502 });
    buffer = Buffer.from(await fetched.arrayBuffer());
    mime = fetched.headers.get('content-type') ?? 'image/jpeg';
    const m = url.match(/\.([a-z0-9]{2,5})($|\?)/i);
    if (m) filename += `.${m[1]}`;
    else filename += '.jpg';
  } else if (ct.includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'file requis' }, { status: 400 });
    buffer = Buffer.from(await file.arrayBuffer());
    mime = file.type || 'image/jpeg';
    filename += `-${file.name}`;
  } else {
    // Raw binary body
    buffer = Buffer.from(await req.arrayBuffer());
    mime = ct || 'image/jpeg';
    const ext = mime.split('/')[1] ?? 'jpg';
    filename += `.${ext}`;
  }

  if (!buffer || buffer.length === 0) {
    return NextResponse.json({ error: 'Image vide' }, { status: 400 });
  }
  if (buffer.length > 10 * 1024 * 1024) {
    return NextResponse.json({ error: 'Image > 10MB' }, { status: 400 });
  }

  const blob = await put(`ads-creatives/${filename}`, buffer, {
    access: 'public',
    addRandomSuffix: false,
    contentType: mime,
  });

  return NextResponse.json({ url: blob.url, size: buffer.length, type: mime });
}
