'use client';

import { signIn } from 'next-auth/react';
import { useState } from 'react';

export default function SignInPage() {
  const [email, setEmail]     = useState('');
  const [sent, setSent]       = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await signIn('resend', { email, redirect: false });
    setSent(true);
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white">Novus Epoxy</h1>
          <p className="text-slate-400 mt-1 text-sm">Dashboard Admin</p>
        </div>

        <div className="bg-slate-800 rounded-xl p-8 shadow-xl border border-slate-700">
          {sent ? (
            <div className="text-center">
              <div className="text-4xl mb-4">📬</div>
              <p className="text-white font-medium">Lien envoyé!</p>
              <p className="text-slate-400 text-sm mt-2">
                Vérifie ton courriel <span className="text-white">{email}</span>
              </p>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-white mb-6">Connexion</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">
                    Adresse courriel
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 transition"
                    placeholder="admin@novusepoxy.ca"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 font-semibold rounded-lg px-4 py-2.5 transition"
                >
                  {loading ? 'Envoi...' : 'Envoyer le lien de connexion'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
