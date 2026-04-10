import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import MissionControlClient from './MissionControlClient';

export default async function MissionControlPage() {
  const session = await auth();
  if (!session) redirect('/auth/signin');

  const authorName = session.user?.name ?? session.user?.email?.split('@')[0] ?? 'Admin';

  // Let the client component fetch activity data itself (server-side fetch
  // sends no cookies → API returns 401 → all data shows 0).
  return <MissionControlClient authorName={authorName} initialActivity={{}} />;
}
