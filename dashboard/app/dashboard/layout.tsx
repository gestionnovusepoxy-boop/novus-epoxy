import { auth, signOut } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { NotificationProvider } from '@/components/notification-provider';
import { SidebarNav } from '@/components/sidebar-nav';
import { DashboardShell } from '@/components/dashboard-shell';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect('/auth/signin');

  const role = (session.user as { role?: string })?.role;

  // GARDE ANTI-FUITE: un sous-traitant ne doit JAMAIS atteindre le dashboard Novus.
  if (role === 'partner') redirect('/partenaire');

  const signOutAction = async () => { 'use server'; await signOut({ redirectTo: '/auth/signin' }); };

  // Rôle JJ : shell minimal sans sidebar Novus, accès uniquement à /dashboard/jj
  if (role === 'jj') {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col">
        <header className="bg-slate-800 border-b border-slate-700 px-5 py-3 flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <img src="/logo-email.jpg" alt="Novus Epoxy" className="w-8 h-8 rounded-lg" />
            <span className="text-white font-bold text-base">Sous-traitance JJ</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-slate-500 text-xs hidden sm:block">{session.user?.email}</span>
            <form action={signOutAction}>
              <button type="submit" className="text-sm text-slate-400 hover:text-white transition px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600">
                Déconnexion
              </button>
            </form>
          </div>
        </header>
        <main className="flex-1">
          <NotificationProvider>
            {children}
          </NotificationProvider>
        </main>
      </div>
    );
  }

  return (
    <DashboardShell
      email={session.user?.email ?? ''}
      signOutAction={signOutAction}
      sidebar={<SidebarNav />}
    >
      <NotificationProvider>
        {children}
      </NotificationProvider>
    </DashboardShell>
  );
}
