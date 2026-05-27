import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { compareSync } from 'bcryptjs';
import { timingSafeEqual } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { query } from '@/lib/db';

// Audit log for auth events
async function auditLog(action: string, email: string, success: boolean, ip: string) {
  try {
    await query(
      `INSERT INTO audit_logs (action, email, success, ip_address) VALUES ($1, $2, $3, $4)`,
      [action, email, success, ip]
    );
  } catch { /* don't block auth on audit failure */ }
}

// Check password: supports bcrypt hashes ($2a$, $2b$) and timing-safe plaintext comparison.
// Plaintext passwords come from env vars (ADMIN_PASSWORD / AUTHORIZED_USERS).
// They are compared with timingSafeEqual to prevent timing attacks.
// To migrate to bcrypt, replace the plaintext value in the env var with a bcrypt hash.
function checkPassword(input: string, stored: string): boolean {
  if (stored.startsWith('$2a$') || stored.startsWith('$2b$')) {
    return compareSync(input, stored);
  }
  // Timing-safe comparison for plaintext env-var passwords
  const a = Buffer.from(input);
  const b = Buffer.from(stored);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      name: 'Connexion',
      credentials: {
        email:    { label: 'Courriel',    type: 'email' },
        password: { label: 'Mot de passe', type: 'password' },
      },
      async authorize(credentials, request) {
        const email = (credentials?.email as string)?.toLowerCase().trim();
        const password = credentials?.password as string;
        const ip = (request?.headers as Headers)?.get?.('x-forwarded-for')?.split(',')[0] ?? 'unknown';
        if (!email || !password) return null;

        // Support multiple authorized users via AUTHORIZED_USERS env var
        // Format: "email1:hash1:name1,email2:hash2:name2"
        const users = (process.env.AUTHORIZED_USERS ?? '').split(',').filter(Boolean).map((u, i) => {
          const [e, p, n] = u.split(':');
          return { id: String(i + 2), email: e?.toLowerCase().trim(), password: p, name: n ?? e?.split('@')[0] };
        });

        // Always include original admin
        const adminEmail = process.env.ADMIN_EMAIL?.toLowerCase().trim();
        const adminPassword = process.env.ADMIN_PASSWORD;
        if (adminEmail && adminPassword) {
          users.unshift({ id: '1', email: adminEmail, password: adminPassword, name: 'Admin' });
        }

        const match = users.find(u => u.email === email && checkPassword(password, u.password));

        await auditLog('login', email, !!match, ip);

        if (!match) return null;
        return { id: match.id, email: match.email, name: match.name };
      },
    }),
  ],
  session: { strategy: 'jwt' },
  trustHost: true,
  pages: {
    signIn: '/auth/signin',
  },
});

/**
 * Admin gate: accepts EITHER a valid NextAuth session OR an
 * `x-api-key` header matching `process.env.ADMIN_API_KEY`.
 *
 * Returns `{ ok: true, via: 'session' | 'api-key' }` on success, or
 * a `NextResponse` 401 on failure that the caller should return as-is.
 *
 * Usage:
 *   const gate = await requireAdmin(req);
 *   if (gate instanceof NextResponse) return gate;
 *   // proceed
 */
export async function requireAdmin(
  req: NextRequest,
): Promise<{ ok: true; via: 'session' | 'api-key' } | NextResponse> {
  const session = await auth();
  if (session) return { ok: true, via: 'session' };

  const apiKey = req.headers.get('x-api-key') ?? '';
  const validApiKey = process.env.ADMIN_API_KEY ?? '';
  if (validApiKey && apiKey) {
    const a = Buffer.from(apiKey);
    const b = Buffer.from(validApiKey);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return { ok: true, via: 'api-key' };
    }
  }

  return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
}
