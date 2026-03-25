import arcjet, { shield, detectBot, tokenBucket } from '@arcjet/next';

// Arcjet security — used in API routes (not middleware, due to Edge Function size limit on Hobby plan)
// Import and call aj.protect(req) in any API route that needs protection
//
// Example usage in an API route:
//   import { aj } from '@/lib/arcjet';
//   const decision = await aj.protect(req);
//   if (decision.isDenied()) return NextResponse.json({ error: 'Blocked' }, { status: 403 });

export const aj = process.env.ARCJET_KEY
  ? arcjet({
      key: process.env.ARCJET_KEY,
      characteristics: ['ip.src'],
      rules: [
        shield({ mode: 'LIVE' }),
        detectBot({
          mode: 'LIVE',
          allow: [
            'CATEGORY:SEARCH_ENGINE',
            'CATEGORY:MONITOR',
            'CATEGORY:SOCIAL',
            'CATEGORY:PREVIEW',
          ],
        }),
        tokenBucket({
          mode: 'LIVE',
          refillRate: 100,
          interval: 60,
          capacity: 100,
        }),
      ],
    })
  : null;
