import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { query } from '@/lib/db';
import MarcelClient from './MarcelClient';

async function loadHistory() {
  try {
    const rows = await query(`SELECT value FROM kv_store WHERE key = 'marcel_history_shared'`, []);
    if (!rows[0]) return [];
    const history = JSON.parse(rows[0].value as string) as Array<{
      role: string; content: string; author?: string; ts?: number;
    }>;
    // Convert to AI SDK message format, keeping author in id field for display
    return history.slice(-40).map((m, i) => ({
      id: String(i),
      role: m.role as 'user' | 'assistant',
      content: m.content,
      // Store author in createdAt for UI display trick — we use a custom approach
    }));
  } catch {
    return [];
  }
}

async function loadHistoryRaw() {
  try {
    const rows = await query(`SELECT value FROM kv_store WHERE key = 'marcel_history_shared'`, []);
    if (!rows[0]) return [];
    return JSON.parse(rows[0].value as string) as Array<{
      role: string; content: string; author?: string; ts?: number;
    }>;
  } catch {
    return [];
  }
}

export default async function MarcelPage() {
  const session = await auth();
  if (!session) redirect('/auth/signin');

  const authorName = session.user?.name ?? session.user?.email?.split('@')[0] ?? 'Admin';
  const history = await loadHistoryRaw();

  return <MarcelClient authorName={authorName} initialHistory={history} />;
}
