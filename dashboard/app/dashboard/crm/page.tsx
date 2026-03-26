import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import CrmClient from './CrmClient';

export default async function CrmPage() {
  const session = await auth();
  if (!session) redirect('/auth/signin');

  return <CrmClient />;
}
