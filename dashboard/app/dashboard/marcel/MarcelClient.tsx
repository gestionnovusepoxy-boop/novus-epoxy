'use client';

import { useChat } from 'ai/react';
import { useEffect, useRef, useState } from 'react';

interface HistoryMessage {
  role: string;
  content: string;
  author?: string;
  ts?: number;
}

interface Props {
  authorName: string;
  initialHistory: HistoryMessage[];
}

const QUICK_ACTIONS = [
  { icon: '📊', label: 'Stats du jour', message: 'Donne-moi les stats du business pour aujourd\'hui' },
  { icon: '🔥', label: 'Leads chauds', message: 'Montre-moi les leads CRM chauds à contacter' },
  { icon: '📋', label: 'Devis en attente', message: 'Liste les devis en attente d\'approbation ou envoyés' },
  { icon: '📧', label: 'Emails récents', message: 'Résume les 5 derniers emails reçus' },
  { icon: '💰', label: 'Créer un devis', message: 'Je veux créer un nouveau devis — dis-moi les infos dont tu as besoin' },
];

function parseAuthorFromContent(content: string): { author: string; text: string } {
  const match = content.match(/^\[([^\]]+)\]:\s*([\s\S]*)$/);
  if (match) return { author: match[1], text: match[2] };
  return { author: '', text: content };
}

function MessageBubble({ role, content, author }: { role: string; content: string; author?: string }) {
  const isUser = role === 'user';
  const { author: parsedAuthor, text } = isUser ? parseAuthorFromContent(content) : { author: author ?? 'Marcel', text: content };
  const displayAuthor = isUser ? parsedAuthor : 'Marcel';

  const initials = displayAuthor ? displayAuthor.slice(0, 1).toUpperCase() : 'M';
  const avatarColor = isUser
    ? (displayAuthor === 'Jason' ? 'bg-blue-600' : 'bg-emerald-600')
    : 'bg-violet-600';

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'} items-end mb-4`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0 ${avatarColor}`}>
        {isUser ? initials : '🤖'}
      </div>
      <div className={`max-w-[75%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        <span className="text-xs text-slate-500 px-1">{displayAuthor}</span>
        <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? 'bg-slate-700 text-slate-100 rounded-br-sm'
            : 'bg-slate-800 text-slate-100 rounded-bl-sm border border-slate-700'
        }`}>
          {text}
        </div>
      </div>
    </div>
  );
}

export default function MarcelClient({ authorName, initialHistory }: Props) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [inputValue, setInputValue] = useState('');

  // Convert history to initial messages for useChat
  const initialMessages = initialHistory.slice(-30).map((m, i) => ({
    id: `hist-${i}`,
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  const { messages, append, isLoading, error } = useChat({
    api: '/api/marcel',
    initialMessages,
    id: 'marcel-shared',
    onError: (err) => console.error('Marcel error:', err),
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = inputValue.trim();
    if (!text || isLoading) return;
    setInputValue('');
    await append({ role: 'user', content: text });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuickAction = async (message: string) => {
    if (isLoading) return;
    await append({ role: 'user', content: message });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] bg-slate-950 rounded-xl overflow-hidden border border-slate-800">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-800 bg-slate-900">
        <div className="w-10 h-10 rounded-full bg-violet-600 flex items-center justify-center text-xl">🤖</div>
        <div>
          <h1 className="text-white font-semibold text-base">Marcel</h1>
          <p className="text-slate-400 text-xs">Agent IA Novus Epoxy · Sonnet 4.6 · Chat partagé Jason & Luca</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${isLoading ? 'bg-yellow-400 animate-pulse' : 'bg-emerald-400'}`} />
          <span className="text-xs text-slate-500">{isLoading ? 'Marcel réfléchit...' : 'En ligne'}</span>
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex gap-2 px-4 py-3 border-b border-slate-800 bg-slate-900/50 overflow-x-auto">
        {QUICK_ACTIONS.map(({ icon, label, message }) => (
          <button
            key={label}
            onClick={() => handleQuickAction(message)}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-medium transition whitespace-nowrap disabled:opacity-50"
          >
            <span>{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3">
            <div className="text-5xl">🤖</div>
            <h2 className="text-white font-semibold text-lg">Bonjour {authorName}!</h2>
            <p className="text-slate-400 text-sm max-w-sm">
              Je suis Marcel, votre agent IA. Je peux gérer les devis, leads, SMS, emails et plus encore. Que puis-je faire pour vous?
            </p>
            <div className="flex flex-wrap gap-2 justify-center mt-2">
              {QUICK_ACTIONS.map(({ icon, label, message }) => (
                <button
                  key={label}
                  onClick={() => handleQuickAction(message)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-sm transition"
                >
                  <span>{icon}</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <MessageBubble key={m.id} role={m.role} content={m.content} />
        ))}

        {isLoading && (
          <div className="flex gap-3 items-end mb-4">
            <div className="w-8 h-8 rounded-full bg-violet-600 flex items-center justify-center text-sm">🤖</div>
            <div className="bg-slate-800 border border-slate-700 rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="text-red-400 text-sm text-center py-2">
            Erreur: {error.message}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-slate-800 bg-slate-900">
        <div className="flex gap-2 items-end">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Message à Marcel en tant que ${authorName}... (Entrée pour envoyer)`}
              rows={1}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 resize-none focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 transition"
              style={{ minHeight: '44px', maxHeight: '120px' }}
              onInput={(e) => {
                const t = e.target as HTMLTextAreaElement;
                t.style.height = 'auto';
                t.style.height = Math.min(t.scrollHeight, 120) + 'px';
              }}
              disabled={isLoading}
            />
          </div>
          <button
            onClick={handleSend}
            disabled={!inputValue.trim() || isLoading}
            className="w-10 h-10 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-500 text-white flex items-center justify-center transition flex-shrink-0"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
              <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-slate-600 mt-1.5 text-center">Shift+Entrée pour nouvelle ligne · Chat partagé visible par Jason & Luca</p>
      </div>
    </div>
  );
}
