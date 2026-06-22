'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { PollingProvider } from '@/components/polling-provider';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface Message {
  id: number; role: string; content: string; created_at: string;
}

interface ConvDetail {
  id: number; channel: string; visitor_name: string | null; visitor_email: string | null;
  visitor_tel: string | null; visitor_adresse: string | null; type_service: string | null;
  superficie: number | null; status: string; quote_id: number | null; created_at: string;
}

const CHANNEL_LABEL: Record<string, string> = { web: 'Site web', messenger: 'Messenger', email: 'Email', telegram: 'Telegram' };
const STATUS_LABEL: Record<string, string> = { active: 'Active', handoff: 'Handoff', pending_approval: 'A approuver', quote_sent: 'Devis envoye', closed: 'Fermee' };

function PageContent() {
  const params = useParams();
  const id = params.id as string;
  const [conv, setConv] = useState<ConvDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendOk, setSendOk] = useState<string | null>(null);
  const msgsEndRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/conversations/${id}`);
    const json = await res.json();
    setConv(json.conversation ?? null);
    setMessages(json.messages ?? []);
  }, [id]);

  useEffect(() => {
    msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendReply() {
    if (!reply.trim() || sending) return;
    setSending(true);
    setSendError(null);
    setSendOk(null);
    try {
      const res = await fetch(`/api/conversations/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: reply.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setReply('');
        if (data.delivered) setSendOk(`Envoyé au client par ${data.delivered}`);
        else if (data.deliveryError) setSendError(`Sauvegardé mais PAS livré — ${data.deliveryError}`);
        else if (data.quote_created) setSendOk(`Devis #${data.quote_id} créé`);
        else setSendOk('Message sauvegardé');
        await load();
      } else {
        setSendError('Erreur lors de l\'envoi du message');
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Erreur de connexion');
    }
    setSending(false);
  }

  return (
    <PollingProvider onRefresh={load}>
      <div className="p-6 space-y-5">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/conversations" className="text-slate-400 hover:text-white text-sm transition">
            &larr; Conversations
          </Link>
          <h2 className="text-2xl font-bold text-white">
            Conversation #{id}
          </h2>
          {conv && (
            <span className={`text-xs px-2 py-1 rounded font-medium ${
              conv.status === 'handoff' ? 'bg-yellow-500/20 text-yellow-400 animate-pulse' :
              conv.status === 'active' ? 'bg-green-500/20 text-green-400' :
              'bg-slate-500/20 text-slate-400'
            }`}>
              {STATUS_LABEL[conv.status] ?? conv.status}
            </span>
          )}
        </div>

        {conv && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              <p className="text-slate-400 text-xs uppercase tracking-wider">Canal</p>
              <p className="text-white font-medium mt-1">{CHANNEL_LABEL[conv.channel] ?? conv.channel}</p>
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              <p className="text-slate-400 text-xs uppercase tracking-wider">Client</p>
              <p className="text-white font-medium mt-1">{conv.visitor_name || '—'}</p>
              {conv.visitor_email && <p className="text-slate-500 text-xs">{conv.visitor_email}</p>}
              {conv.visitor_tel && <p className="text-slate-500 text-xs">{conv.visitor_tel}</p>}
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              <p className="text-slate-400 text-xs uppercase tracking-wider">Service</p>
              <p className="text-white font-medium mt-1">{conv.type_service || '—'}</p>
              {conv.superficie && <p className="text-slate-500 text-xs">{conv.superficie} pi²</p>}
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              <p className="text-slate-400 text-xs uppercase tracking-wider">Devis</p>
              {conv.quote_id ? (
                <Link href={`/dashboard/devis/${conv.quote_id}`} className="text-amber-400 font-medium mt-1 block hover:underline">
                  #{conv.quote_id}
                </Link>
              ) : (
                <p className="text-slate-500 mt-1">Pas encore</p>
              )}
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
          <h3 className="text-white font-semibold mb-4">Conversation</h3>
          <div className="space-y-4 max-h-[400px] overflow-y-auto">
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] rounded-xl px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-amber-500 text-slate-900'
                    : 'bg-slate-700 text-slate-200'
                }`}>
                  {/\[Photo envoy[ée]+e?\]\s*(https?:\/\/[^\s]+)/i.test(msg.content) ? (
                    <a href={msg.content.match(/https?:\/\/[^\s]+/)?.[0] ?? '#'} target="_blank" rel="noopener noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={msg.content.match(/https?:\/\/[^\s]+/)?.[0] ?? ''} alt="Photo client" className="max-w-full rounded-lg" />
                    </a>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  )}
                  <p className={`text-xs mt-1 ${msg.role === 'user' ? 'text-amber-800' : 'text-slate-500'}`}>
                    {new Date(msg.created_at).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}
            {messages.length === 0 && (
              <p className="text-slate-500 text-center text-sm">Aucun message</p>
            )}
            <div ref={msgsEndRef} />
          </div>

          {sendError && (
            <div className="mt-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
              {sendError}
            </div>
          )}

          {/* Reply box */}
          <div className="mt-4 flex gap-3 border-t border-slate-700 pt-4">
            <input
              type="text"
              value={reply}
              onChange={e => setReply(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') sendReply(); }}
              placeholder="Repondre au client..."
              className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
            <button
              onClick={sendReply}
              disabled={!reply.trim() || sending}
              className="bg-amber-500 text-slate-900 font-bold px-6 py-3 rounded-lg hover:bg-amber-400 transition disabled:opacity-50"
            >
              {sending ? '...' : 'Envoyer'}
            </button>
          </div>
          {sendOk && <div className="mt-2 text-sm text-green-400">✅ {sendOk}</div>}
          {sendError && <div className="mt-2 text-sm text-red-400">⚠️ {sendError}</div>}
        </div>
      </div>
    </PollingProvider>
  );
}

export default function ConversationDetailPage() {
  return <PageContent />;
}
