import { auth, signOut } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { NotificationProvider } from '@/components/notification-provider';
import { SidebarNav } from '@/components/sidebar-nav';
import { DashboardShell } from '@/components/dashboard-shell';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect('/auth/signin');

  const signOutAction = async () => { 'use server'; await signOut({ redirectTo: '/auth/signin' }); };

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
