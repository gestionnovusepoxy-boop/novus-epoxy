import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

// Note: Arcjet moved to API routes (lib/arcjet.ts) — Edge Function size limit on Hobby plan
// Rate limiting in-memory (per-endpoint limits) with automatic cleanup
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const MAX_RATE_LIMIT_ENTRIES = 10_000;

function isRateLimited(key: string, maxRequests: number, windowMs: number): boolean {
  const now   = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    // Cleanup expired entries when map gets large
    if (rateLimitMap.size > MAX_RATE_LIMIT_ENTRIES) {
      for (const [k, v] of rateLimitMap) {
        if (now > v.resetAt) rateLimitMap.delete(k);
      }
    }
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

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── ISOLATION SOUS-TRAITANT (chokepoint sécurité) ──────────────────────────
  // Un compte 'partner' ne peut atteindre QUE /partenaire (+ son API) et l'auth.
  // Tout le reste (dashboard Novus, 77 routes admin) → bloqué. Couvre les routes
  // qui n'utilisent que auth() (sans requireAdmin). Fail-open prudent: si la lecture
  // du token échoue, on ne bloque pas (les routes gardent leur propre auth).
  const isPartnerScope = pathname.startsWith('/partenaire') || pathname.startsWith('/api/partenaire');
  const isAuthScope = pathname.startsWith('/api/auth') || pathname.startsWith('/auth');
  if (!isPartnerScope && !isAuthScope && (pathname.startsWith('/dashboard') || pathname.startsWith('/api/'))) {
    try {
      const token = await getToken({ req, secret: process.env.AUTH_SECRET, secureCookie: process.env.NODE_ENV === 'production' });
      if ((token as { role?: string } | null)?.role === 'partner') {
        if (pathname.startsWith('/api/')) {
          return NextResponse.json({ error: 'Accès refusé — sous-traitant' }, { status: 403 });
        }
        return NextResponse.redirect(new URL('/partenaire', req.url));
      }
    } catch { /* fail-open: les routes gardent leur propre garde (requireAdmin) */ }
  }

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

  // Zapier inbound leads webhook
  if (pathname === '/api/leads/zapier') {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
    if (isRateLimited(`zapier:${ip}`, 120, 60_000)) {
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

  // Public quote endpoints (contract, payment, confirm)
  if (pathname.match(/^\/api\/quotes\/\d+\/(contract|payment-info|confirm-deposit|confirm-balance|calendar)/)) {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
    if (isRateLimited(`quote-public:${ip}`, 30, 60_000)) {
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
  // Couvre les routes publiques/webhooks (rate-limit) ET /dashboard + /api/* (garde sous-traitant).
  matcher: ['/dashboard/:path*', '/api/:path*'],
};
