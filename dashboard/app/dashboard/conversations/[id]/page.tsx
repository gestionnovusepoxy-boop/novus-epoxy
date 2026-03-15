'use client';

import { useState, useCallback } from 'react';
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

const CHANNEL_LABEL: Record<string, string> = { web: 'Site web', messenger: 'Messenger', email: 'Email' };

function PageContent() {
  const params = useParams();
  const id = params.id as string;
  const [conv, setConv] = useState<ConvDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/conversations/${id}`);
    const json = await res.json();
    setConv(json.conversation ?? null);
    setMessages(json.messages ?? []);
  }, [id]);

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
          <div className="space-y-4 max-h-[500px] overflow-y-auto">
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] rounded-xl px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-amber-500 text-slate-900'
                    : 'bg-slate-700 text-slate-200'
                }`}>
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  <p className={`text-xs mt-1 ${msg.role === 'user' ? 'text-amber-800' : 'text-slate-500'}`}>
                    {new Date(msg.created_at).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))}
            {messages.length === 0 && (
              <p className="text-slate-500 text-center text-sm">Aucun message</p>
            )}
          </div>
        </div>
      </div>
    </PollingProvider>
  );
}

export default function ConversationDetailPage() {
  return <PageContent />;
}
