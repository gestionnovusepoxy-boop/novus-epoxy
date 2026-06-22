'use client';

import { useState, useCallback, useEffect } from 'react';
import { PollingProvider } from '@/components/polling-provider';

interface SmsLog {
  id: number;
  direction: 'inbound' | 'outbound';
  from_number: string;
  to_number: string;
  client_nom: string | null;
  message: string;
  statut: string;
  created_at: string;
}

function formatDateFr(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '').slice(-10);
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

function getContactPhone(sms: SmsLog): string {
  return sms.direction === 'inbound' ? sms.from_number : sms.to_number;
}

/* ─── Conversation View ─── */
function ConversationPanel({ phone, messages, onClose, onSent }: { phone: string; messages: SmsLog[]; onClose: () => void; onSent: () => void }) {
  const sorted = [...messages].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const clientName = messages.find(m => m.client_nom)?.client_nom || formatPhone(phone);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [statusOk, setStatusOk] = useState<string | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);

  async function send() {
    if (!reply.trim() || sending) return;
    setSending(true); setStatusOk(null); setStatusErr(null);
    try {
      const res = await fetch('/api/sms/logs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: phone, message: reply.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) { setStatusOk('Texto envoyé au client'); setReply(''); onSent(); }
      else setStatusErr(data.deliveryError || 'Échec de l\'envoi');
    } catch { setStatusErr('Erreur de connexion'); }
    setSending(false);
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-800 rounded-xl max-w-lg w-full max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <div>
            <h3 className="text-white font-semibold">{clientName}</h3>
            <p className="text-slate-400 text-sm">{formatPhone(phone)}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl">&times;</button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {sorted.map(sms => (
            <div key={sms.id} className={`flex ${sms.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-xl px-4 py-2.5 ${
                sms.direction === 'outbound'
                  ? 'bg-amber-500/20 text-amber-100 border border-amber-500/30'
                  : 'bg-slate-700 text-slate-200 border border-slate-600'
              }`}>
                <p className="text-sm whitespace-pre-wrap">{sms.message}</p>
                <p className="text-[11px] mt-1 opacity-60">{formatDateFr(sms.created_at)}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Reply box */}
        <div className="p-4 border-t border-slate-700">
          <div className="flex gap-2">
            <input
              type="text"
              value={reply}
              onChange={e => setReply(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') send(); }}
              placeholder="Répondre par texto..."
              className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-4 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
            <button onClick={send} disabled={!reply.trim() || sending}
              className="bg-amber-500 text-slate-900 font-bold px-5 py-2.5 rounded-lg hover:bg-amber-400 transition disabled:opacity-50">
              {sending ? '...' : 'Envoyer'}
            </button>
          </div>
          {statusOk && <div className="mt-2 text-sm text-green-400">✅ {statusOk}</div>}
          {statusErr && <div className="mt-2 text-sm text-red-400">⚠️ {statusErr}</div>}
        </div>
      </div>
    </div>
  );
}

/* ─── Main Page ─── */
function PageContent() {
  const [data, setData] = useState<SmsLog[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<'all' | 'inbound' | 'outbound'>('all');
  const [search, setSearch] = useState('');
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: '200' });
    if (filter !== 'all') params.set('direction', filter);
    if (search) params.set('search', search);
    const res = await fetch(`/api/sms/logs?${params}`);
    if (!res.ok) return;
    const json = await res.json();
    setData(json.data ?? []);
    setTotal(json.total ?? 0);
  }, [filter, search]);

  useEffect(() => { load(); }, [load]);

  // Group by phone number for conversation threads
  const conversations: Record<string, { phone: string; messages: SmsLog[]; lastMessage: SmsLog; clientName: string }> = {};
  for (const sms of data) {
    const phone = getContactPhone(sms).replace(/\D/g, '').slice(-10);
    if (!conversations[phone]) {
      conversations[phone] = {
        phone,
        messages: [],
        lastMessage: sms,
        clientName: sms.client_nom || formatPhone(phone),
      };
    }
    conversations[phone].messages.push(sms);
    if (new Date(sms.created_at) > new Date(conversations[phone].lastMessage.created_at)) {
      conversations[phone].lastMessage = sms;
    }
    if (sms.client_nom && conversations[phone].clientName === formatPhone(phone)) {
      conversations[phone].clientName = sms.client_nom;
    }
  }

  const sortedConvos = Object.values(conversations).sort(
    (a, b) => new Date(b.lastMessage.created_at).getTime() - new Date(a.lastMessage.created_at).getTime()
  );

  const selectedMessages = selectedPhone ? conversations[selectedPhone]?.messages ?? [] : [];

  const filterCls = (f: string) =>
    `px-3 py-1.5 text-sm font-medium rounded-lg transition ${
      filter === f ? 'bg-amber-500 text-black' : 'bg-slate-800 text-slate-400 hover:text-white'
    }`;

  const inboundCount = data.filter(s => s.direction === 'inbound').length;
  const outboundCount = data.filter(s => s.direction === 'outbound').length;

  return (
    <PollingProvider onRefresh={load}>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-2xl font-bold text-white">Textos</h2>
            <p className="text-slate-400 text-sm">{total} messages — {Object.keys(conversations).length} conversations</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setFilter('all')} className={filterCls('all')}>Tout ({total})</button>
            <button onClick={() => setFilter('inbound')} className={filterCls('inbound')}>Recus ({inboundCount})</button>
            <button onClick={() => setFilter('outbound')} className={filterCls('outbound')}>Envoyes ({outboundCount})</button>
          </div>
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Rechercher par nom, numero ou message..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500"
        />

        {/* Conversation List */}
        {sortedConvos.length === 0 ? (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-12 text-center">
            <p className="text-slate-500">Aucun texto pour le moment</p>
            <p className="text-slate-600 text-sm mt-1">Les SMS envoyes et recus apparaitront ici</p>
          </div>
        ) : (
          <div className="space-y-1">
            {sortedConvos.map(convo => {
              const hasInbound = convo.messages.some(m => m.direction === 'inbound');
              const lastMsg = convo.lastMessage;
              return (
                <div
                  key={convo.phone}
                  onClick={() => setSelectedPhone(convo.phone)}
                  className="flex items-center gap-3 bg-slate-800 hover:bg-slate-750 border border-slate-700 hover:border-slate-600 rounded-xl p-4 cursor-pointer transition"
                >
                  {/* Avatar */}
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                    hasInbound ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-400'
                  }`}>
                    {convo.clientName.charAt(0).toUpperCase()}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h4 className="text-white font-medium text-sm truncate">{convo.clientName}</h4>
                      <span className="text-slate-500 text-xs flex-shrink-0 ml-2">{formatDateFr(lastMsg.created_at)}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-slate-500 text-xs">{formatPhone(convo.phone)}</span>
                      <span className="text-slate-600 text-xs">·</span>
                      <span className="text-slate-400 text-xs">{convo.messages.length} msg</span>
                    </div>
                    <p className="text-slate-400 text-sm truncate mt-1">
                      {lastMsg.direction === 'outbound' ? '→ ' : '← '}
                      {lastMsg.message.slice(0, 80)}
                    </p>
                  </div>

                  {/* Badges */}
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {hasInbound && (
                      <span className="text-[10px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded border border-green-500/30">Reponse</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Conversation Modal */}
        {selectedPhone && (
          <ConversationPanel
            phone={selectedPhone}
            messages={selectedMessages}
            onClose={() => setSelectedPhone(null)}
            onSent={load}
          />
        )}
      </div>
    </PollingProvider>
  );
}

export default function TextosPage() {
  return <PageContent />;
}
