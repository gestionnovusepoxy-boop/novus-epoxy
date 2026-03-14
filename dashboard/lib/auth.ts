import NextAuth from 'next-auth';
import Resend from 'next-auth/providers/resend';

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Resend({
      apiKey: process.env.RESEND_API_KEY,
      from:   process.env.EMAIL_FROM ?? 'dashboard@novusepoxy.ca',
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      // Un seul admin autorisé
      return user.email === process.env.ADMIN_EMAIL;
    },
  },
  pages: {
    signIn:  '/auth/signin',
    error:   '/auth/signin',
  },
});
