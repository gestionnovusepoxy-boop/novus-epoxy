import arcjet, { shield, detectBot, tokenBucket } from '@arcjet/next';

// Arcjet security instance — used in middleware
// Shield: protects against common attacks (SQL injection, XSS, etc.)
// Bot detection: blocks automated/scraper bots on public endpoints
// Token bucket: rate limiting shared across all Vercel instances
export const aj = arcjet({
  key: process.env.ARCJET_KEY!,
  characteristics: ['ip.src'],
  rules: [
    // Protect against common attacks
    shield({ mode: 'LIVE' }),
    // Block automated bots (allow search engines + social crawlers)
    detectBot({
      mode: 'LIVE',
      allow: [
        'CATEGORY:SEARCH_ENGINE',
        'CATEGORY:MONITOR',
        'CATEGORY:SOCIAL',
        'CATEGORY:PREVIEW',
      ],
    }),
    // Global rate limit: 100 requests per 60 seconds per IP
    tokenBucket({
      mode: 'LIVE',
      refillRate: 100,
      interval: 60,
      capacity: 100,
    }),
  ],
});
