import { NextRequest, NextResponse } from 'next/server';

// Rate limiting in-memory (réinitialisé à chaque cold start — suffisant pour Vercel serverless)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(key: string, maxRequests: number, windowMs: number): boolean {
  const now   = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  entry.count++;
  return entry.count > maxRequests;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // CORS pour /api/track (endpoint public cross-origin)
  if (pathname === '/api/track') {
    if (req.method === 'OPTIONS') {
      return new NextResponse(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin':  'https://novusepoxy.ca',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      });
    }

    // Rate limit : 120 requêtes par minute par IP
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
    if (isRateLimited(`track:${ip}`, 120, 60_000)) {
      return NextResponse.json({ error: 'Trop de requêtes' }, { status: 429 });
    }

    const res = NextResponse.next();
    res.headers.set('Access-Control-Allow-Origin', 'https://novusepoxy.ca');
    return res;
  }

  // CORS pour /api/submissions POST (formulaire public cross-origin)
  if (pathname === '/api/submissions' && req.method === 'POST') {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
    if (isRateLimited(`sub:${ip}`, 10, 60_000)) {
      return NextResponse.json({ error: 'Trop de requêtes' }, { status: 429 });
    }

    const res = NextResponse.next();
    res.headers.set('Access-Control-Allow-Origin', 'https://novusepoxy.ca');
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/track', '/api/submissions'],
};
