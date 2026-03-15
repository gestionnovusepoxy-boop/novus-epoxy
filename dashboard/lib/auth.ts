import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      name: 'Connexion',
      credentials: {
        email:    { label: 'Courriel',    type: 'email' },
        password: { label: 'Mot de passe', type: 'password' },
      },
      async authorize(credentials) {
        const email = (credentials?.email as string)?.toLowerCase().trim();
        const password = credentials?.password as string;
        if (!email || !password) return null;

        // Support multiple authorized users via AUTHORIZED_USERS env var
        // Format: "email1:password1:name1,email2:password2:name2"
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

        const match = users.find(u => u.email === email && u.password === password);
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
