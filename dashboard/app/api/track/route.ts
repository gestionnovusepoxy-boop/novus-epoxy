import { NextRequest, NextResponse } from 'next/server';
import { query as db } from '@/lib/db';

// Endpoint public — appelé par tracker.js depuis novusepoxy.ca
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.type) return new NextResponse(null, { status: 400 });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? '';
  const ua = req.headers.get('user-agent') ?? '';

  const today    = new Date().toISOString().slice(0, 10);
  const hour     = new Date().getUTCHours().toString();
  const halfHour = Math.floor(new Date().getUTCMinutes() / 30).toString();

  const visitorHash = await sha256(`${ip}${ua}${today}`);
  const sessionHash = await sha256(`${ip}${ua}${today}${hour}${halfHour}`);

  const path = (body.path as string)?.slice(0, 500) ?? '/';
  

  if (body.type === 'pageview') {
    await db(
      `INSERT INTO page_views (url_path, referrer, user_agent, visitor_hash, session_hash, duree_sec)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        path,
        (body.referrer as string | null)?.slice(0, 500) ?? null,
        ua.slice(0, 500),
        visitorHash,
        sessionHash,
        typeof body.duration === 'number' ? body.duration : null,
      ]
    );
  } else if (body.type === 'event') {
    await db(
      `INSERT INTO events (type, url_path, valeur, visitor_hash)
       VALUES ($1, $2, $3, $4)`,
      [
        (body.name as string)?.slice(0, 80) ?? 'unknown',
        path,
        (body.value as string | null)?.slice(0, 255) ?? null,
        visitorHash,
      ]
    );
  }

  return new NextResponse(null, { status: 204 });
}

// Autoriser les requêtes cross-origin depuis novusepoxy.ca
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin':  'https://novusepoxy.ca',
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

async function sha256(str: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
