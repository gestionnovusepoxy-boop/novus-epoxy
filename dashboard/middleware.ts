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

const CORS_ORIGIN = 'https://novusepoxy.ca';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  CORS_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // CORS preflight for all public endpoints
  if (req.method === 'OPTIONS' && (
    pathname === '/api/track' ||
    pathname === '/api/submissions' ||
    pathname === '/api/chat' ||
    pathname === '/api/chat/history'
  )) {
    return new NextResponse(null, { status: 204, headers: corsHeaders() });
  }

  // /api/track — public cross-origin
  if (pathname === '/api/track') {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
    if (isRateLimited(`track:${ip}`, 120, 60_000)) {
      return NextResponse.json({ error: 'Trop de requêtes' }, { status: 429 });
    }
    const res = NextResponse.next();
    res.headers.set('Access-Control-Allow-Origin', CORS_ORIGIN);
    return res;
  }

  // /api/submissions POST — public form
  if (pathname === '/api/submissions' && req.method === 'POST') {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
    if (isRateLimited(`sub:${ip}`, 10, 60_000)) {
      return NextResponse.json({ error: 'Trop de requêtes' }, { status: 429 });
    }
    const res = NextResponse.next();
    res.headers.set('Access-Control-Allow-Origin', CORS_ORIGIN);
    return res;
  }

  // /api/chat — public chat widget (rate limit: 30 msg/min per IP)
  if (pathname === '/api/chat' && req.method === 'POST') {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
    if (isRateLimited(`chat:${ip}`, 30, 60_000)) {
      return NextResponse.json({ error: 'Trop de requêtes' }, { status: 429 });
    }
    const res = NextResponse.next();
    res.headers.set('Access-Control-Allow-Origin', CORS_ORIGIN);
    return res;
  }

  // /api/chat/history — public read
  if (pathname === '/api/chat/history') {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
    if (isRateLimited(`chathist:${ip}`, 60, 60_000)) {
      return NextResponse.json({ error: 'Trop de requêtes' }, { status: 429 });
    }
    const res = NextResponse.next();
    res.headers.set('Access-Control-Allow-Origin', CORS_ORIGIN);
    return res;
  }

  // /api/chat/email — inbound email agent
  if (pathname === '/api/chat/email' && req.method === 'POST') {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
    if (isRateLimited(`email:${ip}`, 30, 60_000)) {
      return NextResponse.json({ error: 'Trop de requêtes' }, { status: 429 });
    }
    return NextResponse.next();
  }

  // Auth — rate limit login attempts (5/min per IP)
  if (pathname.startsWith('/api/auth') && req.method === 'POST') {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
    if (isRateLimited(`auth:${ip}`, 5, 60_000)) {
      return NextResponse.json({ error: 'Trop de tentatives' }, { status: 429 });
    }
    return NextResponse.next();
  }

  // OpenClaw webhook (Telegram/Nova bot)
  if (pathname === '/api/openclaw/webhook' && req.method === 'POST') {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
    if (isRateLimited(`openclaw:${ip}`, 60, 60_000)) {
      return NextResponse.json({ error: 'Trop de requêtes' }, { status: 429 });
    }
    return NextResponse.next();
  }

  // Meta webhook
  if (pathname === '/api/meta/webhook') {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
    if (isRateLimited(`meta:${ip}`, 60, 60_000)) {
      return NextResponse.json({ error: 'Trop de requêtes' }, { status: 429 });
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/track', '/api/submissions', '/api/meta/webhook', '/api/openclaw/webhook', '/api/chat', '/api/chat/history', '/api/chat/email', '/api/auth/:path*'],
};
