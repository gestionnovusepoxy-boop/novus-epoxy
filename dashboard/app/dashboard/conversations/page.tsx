'use client';

import { useState, useCallback } from 'react';
import { PollingProvider } from '@/components/polling-provider';
import Link from 'next/link';

interface Conversation {
  id: number; channel: string; visitor_id: string; visitor_name: string | null;
  visitor_email: string | null; type_service: string | null; status: string;
  lead_temp: string; nb_messages: number; last_message: string | null; quote_id: number | null;
  created_at: string; updated_at: string;
}

const CHANNEL_LABEL: Record<string, string> = { web: 'Site web', messenger: 'Messenger', email: 'Email', telegram: 'Telegram' };
const CHANNEL_COLOR: Record<string, string> = { web: 'bg-blue-500/20 text-blue-400', messenger: 'bg-purple-500/20 text-purple-400', email: 'bg-green-500/20 text-green-400', telegram: 'bg-cyan-500/20 text-cyan-400' };
const STATUS_LABEL: Record<string, string> = { active: 'Active', pending_approval: 'A approuver', quote_sent: 'Devis envoye', closed: 'Fermee', handoff: '🖐 Handoff' };

function PageContent() {
  const [data, setData]       = useState<Conversation[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [channel, setChannel] = useState('');
  const [status, setStatus]   = useState('');

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ page: String(page), limit: '25' });
    if (channel) qs.set('channel', channel);
    if (status) qs.set('status', status);
    const res = await fetch(`/api/conversations?${qs}`);
    const json = await res.json();
    setData(json.data ?? []);
    setTotal(json.total ?? 0);
  }, [page, channel, status]);

  const activeCount = data.filter(c => c.status === 'active').length;
  const pendingCount = data.filter(c => c.status === 'pending_approval').length;
  const quoteCount = data.filter(c => c.status === 'quote_sent').length;
  const handoffCount = data.filter(c => c.status === 'handoff').length;

  return (
    <PollingProvider onRefresh={load}>
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">Conversations Agent</h2>
          <span className="text-slate-400 text-sm">{total} conversation{total > 1 ? 's' : ''}</span>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-6 gap-4">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-white">{total}</p>
            <p className="text-slate-400 text-xs">Total</p>
          </div>
          <div className="bg-slate-800 border border-green-500/30 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-green-400">{activeCount}</p>
            <p className="text-slate-400 text-xs">Actives</p>
          </div>
          <div className="bg-slate-800 border border-yellow-500/30 rounded-xl p-4 text-center cursor-pointer" onClick={() => { setStatus('handoff'); setPage(1); }}>
            <p className="text-2xl font-bold text-yellow-400">{handoffCount}</p>
            <p className="text-slate-400 text-xs">Handoff</p>
          </div>
          <div className="bg-slate-800 border border-red-500/30 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-red-400">{pendingCount}</p>
            <p className="text-slate-400 text-xs">A approuver</p>
          </div>
          <div className="bg-slate-800 border border-amber-500/30 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-amber-400">{quoteCount}</p>
            <p className="text-slate-400 text-xs">Devis envoyes</p>
          </div>
          <div className="bg-slate-800 border border-blue-500/30 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-blue-400">
              {data.reduce((s, c) => s + (c.nb_messages ?? 0), 0)}
            </p>
            <p className="text-slate-400 text-xs">Messages</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3">
          <select value={channel} onChange={e => { setChannel(e.target.value); setPage(1); }}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500">
            <option value="">Tous les canaux</option>
            <option value="web">Site web</option>
            <option value="messenger">Messenger</option>
            <option value="email">Email</option>
          </select>
          <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500">
            <option value="">Tous les statuts</option>
            <option value="active">Active</option>
            <option value="handoff">Handoff</option>
            <option value="pending_approval">A approuver</option>
            <option value="quote_sent">Devis envoye</option>
            <option value="closed">Fermee</option>
          </select>
        </div>

        {/* List */}
        <div className="space-y-3">
          {data.length === 0 && (
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-8 text-center">
              <p className="text-slate-500">Aucune conversation. L&apos;agent attend ses premiers messages!</p>
            </div>
          )}
          {data.map(conv => (
            <Link key={conv.id} href={`/dashboard/conversations/${conv.id}`}
              className="block bg-slate-800 border border-slate-700 rounded-xl p-4 hover:border-amber-500/50 transition">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-medium px-2 py-1 rounded ${CHANNEL_COLOR[conv.channel] ?? 'bg-slate-500/20 text-slate-400'}`}>
                    {CHANNEL_LABEL[conv.channel] ?? conv.channel}
                  </span>
                  <span className={`text-xs font-bold px-2 py-1 rounded ${
                    conv.lead_temp === 'hot' ? 'bg-red-500/20 text-red-400' :
                    conv.lead_temp === 'warm' ? 'bg-orange-500/20 text-orange-400' :
                    'bg-blue-500/20 text-blue-400'
                  }`}>
                    {conv.lead_temp === 'hot' ? '🔥 Hot' : conv.lead_temp === 'warm' ? '🟠 Warm' : '🔵 Cold'}
                  </span>
                  <span className="text-white font-medium text-sm">
                    {conv.visitor_name || conv.visitor_email || conv.visitor_id}
                  </span>
                  {conv.visitor_email && conv.visitor_name && (
                    <span className="text-slate-500 text-xs">{conv.visitor_email}</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {conv.quote_id && (
                    <span className="text-amber-400 text-xs">Devis #{conv.quote_id}</span>
                  )}
                  <span className={`text-xs px-2 py-1 rounded ${
                    conv.status === 'active' ? 'bg-green-500/20 text-green-400' :
                    conv.status === 'handoff' ? 'bg-yellow-500/20 text-yellow-400 animate-pulse' :
                    conv.status === 'pending_approval' ? 'bg-red-500/20 text-red-400' :
                    conv.status === 'quote_sent' ? 'bg-amber-500/20 text-amber-400' :
                    'bg-slate-500/20 text-slate-400'
                  }`}>
                    {STATUS_LABEL[conv.status] ?? conv.status}
                  </span>
                  <span className="text-slate-500 text-xs">{conv.nb_messages} msg</span>
                </div>
              </div>
              {conv.last_message && (
                <p className="text-slate-400 text-sm mt-2 truncate">{conv.last_message}</p>
              )}
              <p className="text-slate-600 text-xs mt-1">
                {new Date(conv.updated_at).toLocaleDateString('fr-CA')} {new Date(conv.updated_at).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </Link>
          ))}
        </div>

        {total > 25 && (
          <div className="flex gap-2 justify-end">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-3 py-1.5 bg-slate-700 rounded text-sm text-white disabled:opacity-40">Précédent</button>
            <span className="px-3 py-1.5 text-slate-400 text-sm">Page {page} / {Math.ceil(total / 25)}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil(total / 25)}
              className="px-3 py-1.5 bg-slate-700 rounded text-sm text-white disabled:opacity-40">Suivant</button>
          </div>
        )}
      </div>
    </PollingProvider>
  );
}

export default function ConversationsPage() {
  return <PageContent />;
}
