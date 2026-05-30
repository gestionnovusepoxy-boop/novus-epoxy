'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';

type TimelineType = 'email_in' | 'email_out' | 'sms_in' | 'sms_out' | 'chat' | 'quote' | 'note';

interface TimelineEvent {
  ts: string;
  type: TimelineType;
  title: string;
  body?: string;
  meta?: Record<string, unknown>;
  source_id?: number | string;
}

interface TimelineResponse {
  lead: { id: number; nom: string; email: string | null; telephone: string | null; statut: string; temperature: string; source: string | null };
  events: TimelineEvent[];
  counts: { total: number; email_in: number; email_out: number; sms_in: number; sms_out: number; chat: number; quotes: number };
}

const ICON: Record<TimelineType, string> = {
  email_in: '📥', email_out: '📤', sms_in: '📱', sms_out: '💬',
  chat: '🤖', quote: '📋', note: '📝',
};
const LABEL: Record<TimelineType, string> = {
  email_in: 'Email reçu',
  email_out: 'Email envoyé',
  sms_in: 'SMS reçu',
  sms_out: 'SMS envoyé',
  chat: 'Chatbot widget',
  quote: 'Devis',
  note: 'Note',
};
const COLOR: Record<TimelineType, string> = {
  email_in: 'border-blue-500/40 bg-blue-500/5',
  email_out: 'border-cyan-500/40 bg-cyan-500/5',
  sms_in: 'border-purple-500/40 bg-purple-500/5',
  sms_out: 'border-violet-500/40 bg-violet-500/5',
  chat: 'border-pink-500/40 bg-pink-500/5',
  quote: 'border-amber-500/40 bg-amber-500/5',
  note: 'border-slate-600 bg-slate-800/50',
};

function fmtTs(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' });
}

export default function ConversationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | TimelineType>('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(`/api/leads/${id}/timeline`)
      .then(r => r.json())
      .then((d: TimelineResponse) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-6 text-slate-400">Chargement de l&apos;historique...</div>;
  if (!data || !data.lead) return <div className="p-6 text-red-400">Lead introuvable</div>;

  const visible = data.events.filter(e => {
    if (filter !== 'all' && e.type !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (e.title?.toLowerCase().includes(q) || (e.body ?? '').toLowerCase().includes(q));
    }
    return true;
  });

  function toggle(key: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const filterBtn = (t: 'all' | TimelineType, label: string, count: number) => (
    <button
      key={t}
      onClick={() => setFilter(t)}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${filter === t ? 'bg-amber-500 text-slate-900 border-amber-400' : 'bg-slate-800 text-slate-300 border-slate-700 hover:border-slate-500'}`}
    >
      {label} <span className="ml-1 opacity-60">{count}</span>
    </button>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <Link href={`/dashboard/crm/${id}`} className="text-slate-400 hover:text-white text-sm mb-2 block transition">&larr; Retour au lead</Link>
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h1 className="text-2xl font-bold text-white">Conversations — {data.lead.nom}</h1>
          <div className="flex gap-3 text-xs text-slate-400">
            {data.lead.email && <span>📧 {data.lead.email}</span>}
            {data.lead.telephone && <span>📞 {data.lead.telephone}</span>}
            <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700">{data.lead.statut}</span>
            <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700">{data.lead.temperature}</span>
          </div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {filterBtn('all', 'Tout', data.counts.total)}
        {filterBtn('email_in', '📥 Emails reçus', data.counts.email_in)}
        {filterBtn('email_out', '📤 Emails envoyés', data.counts.email_out)}
        {filterBtn('sms_in', '📱 SMS reçus', data.counts.sms_in)}
        {filterBtn('sms_out', '💬 SMS envoyés', data.counts.sms_out)}
        {filterBtn('chat', '🤖 Chatbot', data.counts.chat)}
        {filterBtn('quote', '📋 Devis', data.counts.quotes)}
      </div>

      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="🔍 Rechercher dans les messages..."
        className="w-full mb-4 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
      />

      {visible.length === 0 ? (
        <p className="text-slate-500 text-center py-12">Aucune conversation pour ce filtre.</p>
      ) : (
        <div className="space-y-3">
          {visible.map((e, i) => {
            const key = `${e.type}-${e.source_id ?? i}-${e.ts}`;
            const isOpen = expanded.has(key);
            const hasBody = !!e.body && e.body.length > 0;
            return (
              <div key={key} className={`rounded-xl border-2 p-4 ${COLOR[e.type]}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-2xl">{ICON[e.type]}</span>
                      <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{LABEL[e.type]}</span>
                      <span className="text-xs text-slate-500">{fmtTs(e.ts)}</span>
                    </div>
                    <p className="text-white font-medium truncate">{e.title}</p>
                    {hasBody && !isOpen && (
                      <p className="text-slate-400 text-sm mt-1 line-clamp-2">{(e.body ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200)}</p>
                    )}
                    {hasBody && isOpen && (
                      <div className="mt-2 text-slate-300 text-sm whitespace-pre-wrap border-t border-slate-700 pt-2">
                        {e.type === 'email_in' || e.type === 'email_out'
                          ? <div dangerouslySetInnerHTML={{ __html: e.body ?? '' }} className="prose prose-invert max-w-none" />
                          : e.body}
                      </div>
                    )}
                  </div>
                  {hasBody && (
                    <button onClick={() => toggle(key)} className="text-xs text-amber-400 hover:text-amber-300 shrink-0">
                      {isOpen ? '▲ Réduire' : '▼ Voir tout'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
