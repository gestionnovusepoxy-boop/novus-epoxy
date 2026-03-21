import { auth, signOut } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { NotificationProvider } from '@/components/notification-provider';
import { SidebarNav } from '@/components/sidebar-nav';

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

        <SidebarNav />

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
        <NotificationProvider>
          {children}
        </NotificationProvider>
      </main>
    </div>
  );
}
