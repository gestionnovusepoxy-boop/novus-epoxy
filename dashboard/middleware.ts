import { NextRequest, NextResponse } from 'next/server';

// Note: Arcjet moved to API routes (lib/arcjet.ts) — Edge Function size limit on Hobby plan
// Rate limiting in-memory (per-endpoint limits)
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
    pathname === '/api/chat/history' ||
    pathname === '/api/chat/upload'
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

  // /api/chat/upload — public photo upload from chat widget (rate limit: 10/min per IP)
  if (pathname === '/api/chat/upload' && req.method === 'POST') {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
    if (isRateLimited(`chatupload:${ip}`, 10, 60_000)) {
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

  // Bookings — public endpoints (rate limit: 20/min per IP)
  if (pathname.startsWith('/api/bookings')) {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
    if (isRateLimited(`booking:${ip}`, 20, 60_000)) {
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

  // Telegram admin bot webhook
  if (pathname === '/api/telegram/admin' && req.method === 'POST') {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
    if (isRateLimited(`tgadmin:${ip}`, 60, 60_000)) {
      return NextResponse.json({ error: 'Trop de requêtes' }, { status: 429 });
    }
    return NextResponse.next();
  }

  // Twilio incoming SMS webhook — let it through with basic rate limit
  if (pathname === '/api/sms/incoming' && req.method === 'POST') {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
    if (isRateLimited(`sms-in:${ip}`, 30, 60_000)) {
      return NextResponse.json({ error: 'Trop de requêtes' }, { status: 429 });
    }
    return NextResponse.next();
  }

  // SMS devis API
  if (pathname === '/api/sms/devis' && req.method === 'POST') {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
    if (isRateLimited(`smsdevis:${ip}`, 10, 60_000)) {
      return NextResponse.json({ error: 'Trop de requêtes' }, { status: 429 });
    }
    return NextResponse.next();
  }

  // Public quote endpoints (contract, payment, pay)
  if (pathname.match(/^\/api\/quotes\/\d+\/(contract|payment-info|pay|confirm-deposit|confirm-balance|calendar)/)) {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
    if (isRateLimited(`quote-public:${ip}`, 30, 60_000)) {
      return NextResponse.json({ error: 'Trop de requêtes' }, { status: 429 });
    }
    return NextResponse.next();
  }

  // Stripe webhook
  if (pathname === '/api/stripe/webhook' && req.method === 'POST') {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
    if (isRateLimited(`stripe:${ip}`, 60, 60_000)) {
      return NextResponse.json({ error: 'Trop de requêtes' }, { status: 429 });
    }
    return NextResponse.next();
  }

  // Security headers on all responses
  const res = NextResponse.next();
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'DENY');
  res.headers.set('X-XSS-Protection', '1; mode=block');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return res;
}

export const config = {
  matcher: ['/api/track', '/api/submissions', '/api/meta/webhook', '/api/openclaw/webhook', '/api/chat', '/api/chat/history', '/api/chat/upload', '/api/chat/email', '/api/auth/:path*', '/api/bookings/:path*', '/api/telegram/admin', '/api/sms/devis', '/api/sms/incoming', '/api/quotes/:path*', '/api/stripe/webhook'],
};
