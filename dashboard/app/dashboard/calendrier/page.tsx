import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import CalendrierClient from './CalendrierClient';

export default async function CalendrierPage() {
  const session = await auth();
  if (!session) redirect('/auth/signin');

  const calendarToken = process.env.CALENDAR_TOKEN || '';

  return <CalendrierClient bookings={[]} calendarToken={calendarToken} />;
}
