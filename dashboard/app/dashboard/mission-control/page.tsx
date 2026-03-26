import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import MissionControlClient from './MissionControlClient';

export default async function MissionControlPage() {
  const session = await auth();
  if (!session) redirect('/auth/signin');

  const authorName = session.user?.name ?? session.user?.email?.split('@')[0] ?? 'Admin';

  // Load today's activity server-side
  let activity: Record<string, Record<string, number | string>> = {};
  try {
    const base = process.env.NEXTAUTH_URL ?? 'https://novus-epoxy.vercel.app';
    const res = await fetch(`${base}/api/agents/activity`, {
      headers: { Cookie: '' },
      cache: 'no-store',
    });
    if (res.ok) activity = await res.json() as Record<string, Record<string, number | string>>;
  } catch { /* noop — client will fetch */ }

  return <MissionControlClient authorName={authorName} initialActivity={activity} />;
}
