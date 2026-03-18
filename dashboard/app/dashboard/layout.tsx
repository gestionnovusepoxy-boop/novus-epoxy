import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { signOut } from '@/lib/auth';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect('/auth/signin');

  return (
    <div className="min-h-screen bg-slate-900 flex">
      {/* Sidebar */}
      <aside className="w-56 bg-slate-800 border-r border-slate-700 flex flex-col">
        <div className="p-6 border-b border-slate-700">
          <h1 className="text-white font-bold text-lg leading-tight">Novus Epoxy</h1>
          <p className="text-amber-400 text-xs mt-0.5 font-medium">Admin</p>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {[
            { href: '/dashboard',              label: 'Vue d\'ensemble', icon: '📊' },
            { href: '/dashboard/devis',        label: 'Devis',           icon: '📝' },
            { href: '/dashboard/calendrier',   label: 'Calendrier',      icon: '📅' },
            { href: '/dashboard/factures',     label: 'Factures',        icon: '🧾' },
            { href: '/dashboard/clients',      label: 'Clients',         icon: '👥' },
            { href: '/dashboard/depenses',      label: 'Dépenses',        icon: '💳' },
            { href: '/dashboard/comptabilite', label: 'Comptabilité',    icon: '💰' },
            { href: '/dashboard/banque',       label: 'Banque',          icon: '🏦' },
            { href: '/dashboard/conversations', label: 'Agent IA',        icon: '🤖' },
            { href: '/dashboard/contenu',      label: 'Contenu',         icon: '✍️' },
            { href: '/dashboard/soumissions',  label: 'Soumissions',     icon: '📋' },
            { href: '/dashboard/emails',       label: 'Emails',          icon: '📧' },
            { href: '/dashboard/stats',        label: 'Statistiques',    icon: '📈' },
          ].map(({ href, label, icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700 transition text-sm"
            >
              <span>{icon}</span>
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-700">
          <p className="text-slate-500 text-xs truncate mb-3">{session.user?.email}</p>
          <form action={async () => { 'use server'; await signOut({ redirectTo: '/auth/signin' }); }}>
            <button
              type="submit"
              className="w-full text-left text-sm text-slate-400 hover:text-white transition"
            >
              Déconnexion
            </button>
          </form>
        </div>
      </aside>

      {/* Contenu principal */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
