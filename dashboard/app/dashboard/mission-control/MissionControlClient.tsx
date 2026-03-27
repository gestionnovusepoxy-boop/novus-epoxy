'use client';

import { useChat } from 'ai/react';
import { useEffect, useRef, useState, useCallback } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ActivityData {
  marcel?:  { messages: number; label: string };
  hunter?:  { chauds: number; tièdes: number; nouveaux: number };
  aria?:    { emails_today: number };
  rex?:     { devis_today: number; en_attente: number };
  iris?:    { confirmes: string; pipeline: string; actifs: number };
  sage?:    { posts: number };
  zara?:    { a_venir: number; confirmees_today: number };
  bolt?:    { notifications: number };
  echo?:    { env_ok: number; env_total: number };
  nova?:    { today: number; en_attente: number; devis_today: number };
}

interface Props {
  authorName: string;
  initialActivity: ActivityData;
}

// ─── Terminal command labels ─────────────────────────────────────────────────

const TERMINAL_COMMANDS: { key: string; label: string }[] = [
  { key: 'deploy',     label: '🚀 Deploy Prod' },
  { key: 'git-status', label: '📊 Git Status' },
  { key: 'git-log',    label: '📋 Git Log' },
  { key: 'ts-check',   label: '✅ TS Check' },
  { key: 'git-diff',   label: '🔍 Git Diff' },
  { key: 'git-branch', label: '🌿 Branches' },
  { key: 'node-ver',   label: '📦 Node Version' },
];

const COMMAND_LABELS: Record<string, string> = Object.fromEntries(
  TERMINAL_COMMANDS.map(c => [c.key, c.label])
);

// ─── Agent definitions ────────────────────────────────────────────────────────

const AGENTS = [
  {
    id: 'marcel', name: 'Marcel', emoji: '🤖', role: 'Chef de Cabinet',
    desc: 'Orchestration centrale — devis, CRM, SMS, emails',
    color: 'violet',
    ring: 'ring-violet-500/40', bg: 'bg-violet-600', text: 'text-violet-400',
    border: 'border-violet-500/20', glow: 'shadow-violet-500/10',
    quickActions: [
      { label: 'Stats du jour', msg: 'Donne-moi les stats du business pour aujourd\'hui' },
      { label: 'Leads chauds', msg: 'Montre-moi les leads CRM chauds à contacter' },
      { label: 'Devis en attente', msg: 'Liste les devis en attente d\'approbation' },
      { label: 'Emails récents', msg: 'Résume les 5 derniers emails reçus' },
    ],
  },
  {
    id: 'hunter', name: 'Hunter', emoji: '🎯', role: 'Dark Hunter',
    desc: 'Prospecte, score leads, génère plans d\'attaque',
    color: 'red',
    ring: 'ring-red-500/40', bg: 'bg-red-600', text: 'text-red-400',
    border: 'border-red-500/20', glow: 'shadow-red-500/10',
    quickActions: [
      { label: 'Score mes leads', msg: 'Score et classe tous mes leads CRM par priorité' },
      { label: 'Top 5 priorités', msg: 'Donne-moi les 5 leads les plus prioritaires à contacter maintenant' },
      { label: 'Leads jamais contactés', msg: 'Quels leads n\'ont jamais été contactés?' },
      { label: 'Plan d\'attaque', msg: 'Génère un plan d\'attaque pour le lead le plus chaud' },
    ],
  },
  {
    id: 'aria', name: 'Aria', emoji: '📧', role: 'Email Agent',
    desc: 'Gmail, leads qui répondent, follow-ups intelligents',
    color: 'blue',
    ring: 'ring-blue-500/40', bg: 'bg-blue-600', text: 'text-blue-400',
    border: 'border-blue-500/20', glow: 'shadow-blue-500/10',
    quickActions: [
      { label: 'Résume les emails', msg: 'Résume les 5 derniers emails reçus sur Gmail' },
      { label: 'Emails non lus', msg: 'Montre-moi les emails non lus seulement' },
      { label: 'Leads qui ont répondu', msg: 'Quels leads CRM ont répondu récemment?' },
      { label: 'Relances à faire', msg: 'Quels leads devraient recevoir un email de suivi aujourd\'hui?' },
    ],
  },
  {
    id: 'rex', name: 'Rex', emoji: '📱', role: 'Closer SMS',
    desc: 'Relances SMS percutantes, scripts de closing',
    color: 'green',
    ring: 'ring-green-500/40', bg: 'bg-green-600', text: 'text-green-400',
    border: 'border-green-500/20', glow: 'shadow-green-500/10',
    quickActions: [
      { label: 'Leads à relancer', msg: 'Quels leads devraient recevoir un SMS de relance aujourd\'hui?' },
      { label: 'Relance urgente', msg: 'Génère une relance SMS urgente pour le lead le plus chaud' },
      { label: 'Script chaleureux', msg: 'Génère un message de relance SMS chaleureux pour un lead tiède' },
      { label: 'Devis non répondus', msg: 'Quels devis envoyés n\'ont pas eu de réponse?' },
    ],
  },
  {
    id: 'iris', name: 'Iris', emoji: '💰', role: 'Analyste Financière',
    desc: 'Revenus, pipeline, rentabilité, projections',
    color: 'amber',
    ring: 'ring-amber-500/40', bg: 'bg-amber-600', text: 'text-amber-400',
    border: 'border-amber-500/20', glow: 'shadow-amber-500/10',
    quickActions: [
      { label: 'Revenus confirmés', msg: 'Analyse mes revenus confirmés et le pipeline actuel' },
      { label: 'Pipeline devis', msg: 'Quels devis sont en attente de signature ou de paiement?' },
      { label: 'Performance du mois', msg: 'Comment performe le business ce mois-ci?' },
      { label: 'Devis à closer', msg: 'Quels devis ont le plus de chances d\'être signés?' },
    ],
  },
  {
    id: 'sage', name: 'Sage', emoji: '✍️', role: 'Content Creator',
    desc: 'Posts Instagram, Facebook, contenu marketing',
    color: 'pink',
    ring: 'ring-pink-500/40', bg: 'bg-pink-600', text: 'text-pink-400',
    border: 'border-pink-500/20', glow: 'shadow-pink-500/10',
    quickActions: [
      { label: 'Post Instagram', msg: 'Génère un post Instagram percutant pour Novus Epoxy avec des hashtags' },
      { label: 'Post Facebook', msg: 'Génère un post Facebook engageant sur nos planchers époxy' },
      { label: 'Post avant/après', msg: 'Génère un post style avant/après pour un projet époxy flake garage' },
      { label: 'Promo Avril', msg: 'Génère un post promotionnel pour le rabais Avril 20% de Novus Epoxy' },
    ],
  },
  {
    id: 'zara', name: 'Zara', emoji: '📅', role: 'Booking Manager',
    desc: 'Réservations, calendrier, rappels clients',
    color: 'cyan',
    ring: 'ring-cyan-500/40', bg: 'bg-cyan-600', text: 'text-cyan-400',
    border: 'border-cyan-500/20', glow: 'shadow-cyan-500/10',
    quickActions: [
      { label: 'Réservations à venir', msg: 'Liste toutes les réservations à venir' },
      { label: 'Planning semaine', msg: 'Quel est le planning de la semaine?' },
      { label: 'Confirmations en attente', msg: 'Quelles réservations attendent confirmation?' },
      { label: 'Stats réservations', msg: 'Donne-moi les stats de réservations' },
    ],
  },
  {
    id: 'bolt', name: 'Bolt', emoji: '⚡', role: 'Telegram Commander',
    desc: 'Notifications équipe, alertes Telegram',
    color: 'orange',
    ring: 'ring-orange-500/40', bg: 'bg-orange-600', text: 'text-orange-400',
    border: 'border-orange-500/20', glow: 'shadow-orange-500/10',
    quickActions: [
      { label: 'Update équipe', msg: 'Envoie un message de bonne journée à l\'équipe sur Telegram' },
      { label: 'Alerte leads chauds', msg: 'Envoie une alerte Telegram sur les leads chauds à contacter' },
      { label: 'Résumé journée', msg: 'Envoie un résumé de la journée à l\'équipe Telegram' },
      { label: 'Test notification', msg: 'Envoie un message de test sur Telegram pour vérifier que ça fonctionne' },
    ],
  },
  {
    id: 'echo', name: 'Echo', emoji: '🔍', role: 'System Monitor',
    desc: 'Santé système, env vars, crons, alertes',
    color: 'slate',
    ring: 'ring-slate-400/40', bg: 'bg-slate-600', text: 'text-slate-400',
    border: 'border-slate-500/20', glow: 'shadow-slate-500/10',
    quickActions: [
      { label: 'Santé du système', msg: 'Vérifie la santé complète du système' },
      { label: 'Env vars', msg: 'Quelles variables d\'environnement sont configurées ou manquantes?' },
      { label: 'Status intégrations', msg: 'Quel est le statut de toutes les intégrations (Stripe, Twilio, Gmail, Meta)?' },
      { label: 'Rapport système', msg: 'Génère un rapport complet de l\'état du système' },
    ],
  },
  {
    id: 'nova', name: 'Nova', emoji: '💬', role: 'Closer Chatbot',
    desc: 'Chatbot site web — collecte leads, génère devis',
    color: 'emerald',
    ring: 'ring-emerald-500/40', bg: 'bg-emerald-600', text: 'text-emerald-400',
    border: 'border-emerald-500/20', glow: 'shadow-emerald-500/10',
    quickActions: [
      { label: 'Stats chatbot', msg: 'Donne-moi les statistiques du chatbot Nova' },
      { label: 'Conversations actives', msg: 'Montre-moi les conversations en cours et en attente' },
      { label: 'Devis en attente appro', msg: 'Quels devis générés par Nova attendent mon approbation?' },
      { label: 'Leads from chatbot', msg: 'Quels leads sont arrivés via le chatbot aujourd\'hui?' },
    ],
  },
] as const;

type AgentId = (typeof AGENTS)[number]['id'];

// ─── Activity conseil helper ───────────────────────────────────────────────

function getConseil(id: AgentId, activity: ActivityData): string {
  switch (id) {
    case 'marcel':
      return activity.marcel?.messages
        ? `${activity.marcel.messages} messages en mémoire partagée`
        : 'Demande-moi n\'importe quoi!';
    case 'hunter': {
      const h = activity.hunter;
      if (!h) return 'Score tes leads maintenant';
      if (h.chauds > 0) return `🔥 ${h.chauds} lead${h.chauds > 1 ? 's' : ''} chaud${h.chauds > 1 ? 's' : ''} à contacter!`;
      if (h.nouveaux > 0) return `⚡ ${h.nouveaux} nouveau${h.nouveaux > 1 ? 'x' : ''} lead${h.nouveaux > 1 ? 's' : ''} aujourd'hui`;
      if (h.tièdes > 0) return `${h.tièdes} leads tièdes — score-les!`;
      return 'Lance un scoring de leads';
    }
    case 'aria': {
      const cnt = activity.aria?.emails_today ?? 0;
      return cnt > 0 ? `${cnt} email${cnt > 1 ? 's' : ''} traité${cnt > 1 ? 's' : ''} aujourd'hui` : 'Vérifie ta boîte Gmail';
    }
    case 'rex': {
      const r = activity.rex;
      if (!r) return 'Génère des relances SMS';
      if (r.en_attente > 0) return `${r.en_attente} devis en attente — relance par SMS!`;
      if (r.devis_today > 0) return `${r.devis_today} devis créé${r.devis_today > 1 ? 's' : ''} aujourd'hui`;
      return 'Aucune relance urgente';
    }
    case 'iris': {
      const i = activity.iris;
      if (!i) return 'Analyse tes finances';
      if (i.actifs > 0) return `${i.actifs} devis actifs · Pipeline: ${i.pipeline}`;
      return `Revenus confirmés: ${i.confirmes}`;
    }
    case 'sage':
      return 'Génère un post qui va envoyer!';
    case 'zara': {
      const z = activity.zara;
      if (!z) return 'Vérifie le calendrier';
      return z.a_venir > 0 ? `${z.a_venir} réservation${z.a_venir > 1 ? 's' : ''} à venir` : 'Aucune réservation';
    }
    case 'bolt':
      return 'Envoie un update à l\'équipe';
    case 'echo': {
      const e = activity.echo;
      if (!e) return 'Vérifie le système';
      const missing = e.env_total - e.env_ok;
      return missing > 0 ? `⚠️ ${missing} var${missing > 1 ? 's' : ''} manquante${missing > 1 ? 's' : ''}` : `✅ ${e.env_ok}/${e.env_total} vars OK`;
    }
    case 'nova': {
      const n = activity.nova;
      if (!n) return 'Vérifie le chatbot';
      if (n.en_attente > 0) return `⏳ ${n.en_attente} devis en attente d'approbation`;
      if (n.today > 0) return `${n.today} conversation${n.today > 1 ? 's' : ''} aujourd'hui`;
      return 'Chatbot actif sur novusepoxy.ca';
    }
    default: return '';
  }
}

function getMetrics(id: AgentId, activity: ActivityData): { label: string; value: string }[] {
  switch (id) {
    case 'marcel': return [
      { label: 'Historique', value: `${activity.marcel?.messages ?? 0} msgs` },
    ];
    case 'hunter': return [
      { label: 'Chauds', value: String(activity.hunter?.chauds ?? 0) },
      { label: 'Tièdes', value: String(activity.hunter?.tièdes ?? 0) },
      { label: 'Nouveaux', value: String(activity.hunter?.nouveaux ?? 0) },
    ];
    case 'aria': return [
      { label: 'Emails traités', value: String(activity.aria?.emails_today ?? 0) },
    ];
    case 'rex': return [
      { label: 'Devis du jour', value: String(activity.rex?.devis_today ?? 0) },
      { label: 'En attente', value: String(activity.rex?.en_attente ?? 0) },
    ];
    case 'iris': return [
      { label: 'Confirmés', value: activity.iris?.confirmes ?? '0$' },
      { label: 'Pipeline', value: activity.iris?.pipeline ?? '0$' },
      { label: 'Actifs', value: String(activity.iris?.actifs ?? 0) },
    ];
    case 'sage': return [
      { label: 'Posts générés', value: String(activity.sage?.posts ?? 0) },
    ];
    case 'zara': return [
      { label: 'À venir', value: String(activity.zara?.a_venir ?? 0) },
      { label: 'Confirmées', value: String(activity.zara?.confirmees_today ?? 0) },
    ];
    case 'bolt': return [
      { label: 'Notifications', value: String(activity.bolt?.notifications ?? 0) },
    ];
    case 'echo': return [
      { label: 'Env OK', value: `${activity.echo?.env_ok ?? 0}/${activity.echo?.env_total ?? 0}` },
    ];
    case 'nova': return [
      { label: 'Convos aujourd\'hui', value: String(activity.nova?.today ?? 0) },
      { label: 'En attente appro', value: String(activity.nova?.en_attente ?? 0) },
      { label: 'Devis générés', value: String(activity.nova?.devis_today ?? 0) },
    ];
    default: return [];
  }
}

function getTimelineEvents(activity: ActivityData): { emoji: string; text: string; agent: string }[] {
  const events: { emoji: string; text: string; agent: string }[] = [];
  if ((activity.hunter?.chauds ?? 0) > 0)
    events.push({ emoji: '🎯', text: `${activity.hunter!.chauds} leads chauds dans le CRM`, agent: 'Hunter' });
  if ((activity.nova?.today ?? 0) > 0)
    events.push({ emoji: '💬', text: `${activity.nova!.today} conversations chatbot`, agent: 'Nova' });
  if ((activity.nova?.en_attente ?? 0) > 0)
    events.push({ emoji: '⏳', text: `${activity.nova!.en_attente} devis en attente d'appro`, agent: 'Nova' });
  if ((activity.aria?.emails_today ?? 0) > 0)
    events.push({ emoji: '📧', text: `${activity.aria!.emails_today} emails traités`, agent: 'Aria' });
  if ((activity.rex?.en_attente ?? 0) > 0)
    events.push({ emoji: '📋', text: `${activity.rex!.en_attente} devis en attente`, agent: 'Rex' });
  if ((activity.iris?.actifs ?? 0) > 0)
    events.push({ emoji: '💰', text: `Pipeline ${activity.iris!.pipeline} · ${activity.iris!.actifs} actifs`, agent: 'Iris' });
  if ((activity.zara?.a_venir ?? 0) > 0)
    events.push({ emoji: '📅', text: `${activity.zara!.a_venir} réservations à venir`, agent: 'Zara' });
  if ((activity.echo?.env_ok ?? 0) > 0)
    events.push({ emoji: '✅', text: `Système: ${activity.echo!.env_ok}/${activity.echo!.env_total} vars OK`, agent: 'Echo' });
  if (events.length === 0)
    events.push({ emoji: '🚀', text: 'Mission Control actif — Demandez à vos agents!', agent: 'Système' });
  return events;
}

// ─── Chat Panel component ────────────────────────────────────────────────────

function ChatPanel({
  agentId,
  agentName,
  agentEmoji,
  agentColor,
  authorName,
  onClose,
  onLoadingChange,
}: {
  agentId: string;
  agentName: string;
  agentEmoji: string;
  agentColor: string;
  authorName: string;
  onClose: () => void;
  onLoadingChange: (loading: boolean) => void;
}) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const agent = AGENTS.find(a => a.id === agentId);

  const { messages, append, isLoading, error } = useChat({
    api: `/api/agents/${agentId}`,
    id: `agent-chat-${agentId}`,
  });

  useEffect(() => {
    onLoadingChange(isLoading);
  }, [isLoading, onLoadingChange]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    await append({ role: 'user', content: text });
  };

  const bgClass = `bg-${agentColor}-600`;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700/50 bg-slate-900 flex-shrink-0">
        <div className={`w-9 h-9 rounded-full ${bgClass} flex items-center justify-center text-lg flex-shrink-0`}>
          {agentEmoji}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold text-sm">{agentName}</p>
          <p className="text-slate-400 text-xs">{agent?.role}</p>
        </div>
        <div className="flex items-center gap-2">
          {isLoading ? (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-ping" />
              <span className="text-green-400 text-[10px] font-bold uppercase tracking-wider">ACTIF</span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-emerald-400 text-[10px] font-medium uppercase tracking-wider">EN LIGNE</span>
            </span>
          )}
          <button onClick={onClose} className="text-slate-400 hover:text-white transition text-lg leading-none ml-2">×</button>
        </div>
      </div>

      {/* Quick actions */}
      {agent && (
        <div className="flex gap-1.5 px-3 py-2 flex-wrap border-b border-slate-800 bg-slate-900/50 flex-shrink-0">
          {agent.quickActions.map(qa => (
            <button
              key={qa.label}
              onClick={() => { void append({ role: 'user', content: qa.msg }); }}
              disabled={isLoading}
              className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[11px] transition disabled:opacity-40 whitespace-nowrap"
            >
              {qa.label}
            </button>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-2 py-8">
            <span className="text-4xl">{agentEmoji}</span>
            <p className="text-slate-400 text-sm">Bonjour! Je suis {agentName}.<br />Que puis-je faire pour vous?</p>
          </div>
        )}
        {messages.map(m => {
          const isUser = m.role === 'user';
          const nameMatch = m.content.match(/^\[([^\]]+)\]:\s*([\s\S]*)$/);
          const displayText = isUser && nameMatch ? nameMatch[2] : m.content;
          const displayName = isUser && nameMatch ? nameMatch[1] : isUser ? authorName : agentName;
          return (
            <div key={m.id} className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'} items-end`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${isUser ? 'bg-slate-600' : bgClass}`}>
                {isUser ? displayName[0]?.toUpperCase() : agentEmoji}
              </div>
              <div className={`max-w-[82%] flex flex-col gap-0.5 ${isUser ? 'items-end' : 'items-start'}`}>
                <span className="text-[10px] text-slate-500 px-1">{displayName}</span>
                <div className={`rounded-xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                  isUser ? 'bg-slate-700 text-slate-100 rounded-br-sm' : 'bg-slate-800 border border-slate-700 text-slate-100 rounded-bl-sm'
                }`}>
                  {displayText}
                </div>
              </div>
            </div>
          );
        })}
        {isLoading && (
          <div className="flex gap-2 items-end">
            <div className={`w-7 h-7 rounded-full ${bgClass} flex items-center justify-center text-xs`}>{agentEmoji}</div>
            <div className="bg-slate-800 border border-slate-700 rounded-xl rounded-bl-sm px-3 py-2">
              <div className="flex gap-1">
                {[0, 150, 300].map(d => (
                  <div key={d} className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
                ))}
              </div>
            </div>
          </div>
        )}
        {error && <p className="text-red-400 text-xs text-center">{error.message}</p>}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-2.5 border-t border-slate-800 bg-slate-900 flex-shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
            placeholder={`Message à ${agentName}...`}
            rows={1}
            disabled={isLoading}
            className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 resize-none focus:outline-none focus:border-slate-500 transition"
            style={{ minHeight: '38px', maxHeight: '100px' }}
            onInput={e => {
              const t = e.target as HTMLTextAreaElement;
              t.style.height = 'auto';
              t.style.height = Math.min(t.scrollHeight, 100) + 'px';
            }}
          />
          <button
            onClick={() => void handleSend()}
            disabled={!input.trim() || isLoading}
            className={`w-9 h-9 rounded-lg ${bgClass} hover:opacity-90 disabled:bg-slate-700 disabled:text-slate-500 text-white flex items-center justify-center transition flex-shrink-0`}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
              <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Agent Card ──────────────────────────────────────────────────────────────

function AgentCard({
  agent,
  activity,
  isActive,
  isStreaming,
  isEnabled,
  onChat,
  onToggle,
}: {
  agent: (typeof AGENTS)[number];
  activity: ActivityData;
  isActive: boolean;
  isStreaming: boolean;
  isEnabled: boolean;
  onChat: (id: AgentId) => void;
  onToggle: (id: AgentId) => void;
}) {
  const conseil = getConseil(agent.id as AgentId, activity);
  const metrics = getMetrics(agent.id as AgentId, activity);
  const [showActions, setShowActions] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setShowActions(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Status indicator
  let statusDot: string;
  let statusText: string;
  let statusTextColor: string;
  if (!isEnabled) {
    statusDot = 'bg-red-500';
    statusText = 'DÉSACTIVÉ';
    statusTextColor = 'text-red-400';
  } else if (isStreaming) {
    statusDot = 'bg-green-400 animate-ping';
    statusText = 'ACTIF';
    statusTextColor = 'text-green-400';
  } else if (isActive) {
    statusDot = 'bg-emerald-400';
    statusText = 'EN LIGNE';
    statusTextColor = 'text-emerald-400';
  } else if (isEnabled) {
    statusDot = 'bg-emerald-400';
    statusText = 'ACTIF';
    statusTextColor = 'text-emerald-400';
  } else {
    statusDot = 'bg-slate-500';
    statusText = 'EN VEILLE';
    statusTextColor = 'text-slate-500';
  }

  return (
    <div className={`relative flex flex-col bg-slate-900 border ${agent.border} rounded-2xl p-4 shadow-lg ${agent.glow} hover:border-opacity-50 transition-all duration-200 group ${isStreaming ? 'ring-2 ring-green-500/30' : ''} ${!isEnabled ? 'opacity-50 grayscale' : ''}`}>
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-11 h-11 rounded-xl ${agent.bg} flex items-center justify-center text-xl flex-shrink-0 shadow-lg overflow-hidden`}>
          {agent.image ? (
            <img src={agent.image} alt={agent.name} className="w-full h-full object-cover" />
          ) : (
            agent.emoji
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-white font-bold text-base">{agent.name}</h3>
            <span className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${statusDot} flex-shrink-0`} />
              <span className={`text-[10px] font-semibold uppercase tracking-wider ${statusTextColor}`}>{statusText}</span>
            </span>
          </div>
          <p className={`text-xs font-medium ${agent.text}`}>{agent.role}</p>
        </div>
        {/* Toggle ON/OFF */}
        <button
          onClick={() => onToggle(agent.id as AgentId)}
          className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${isEnabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
          title={isEnabled ? 'Désactiver' : 'Activer'}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${isEnabled ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>

      {/* Description */}
      <p className="text-slate-500 text-xs mb-3 leading-relaxed">{agent.desc}</p>

      {/* Metrics */}
      {metrics.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {metrics.map(m => (
            <div key={m.label} className="flex flex-col items-center bg-slate-800/70 rounded-lg px-3 py-1.5 min-w-[60px]">
              <span className={`text-lg font-bold ${agent.text}`}>{m.value}</span>
              <span className="text-[10px] text-slate-500 mt-0.5">{m.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Conseil */}
      <div className={`flex items-start gap-2 bg-slate-800/50 rounded-lg px-3 py-2 mb-3 border ${agent.border}`}>
        <span className="text-base flex-shrink-0">💡</span>
        <p className="text-slate-300 text-xs leading-relaxed">{conseil}</p>
      </div>

      {/* Buttons */}
      <div className="flex gap-2 mt-auto">
        <button
          onClick={() => onChat(agent.id as AgentId)}
          disabled={!isEnabled}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg ${agent.bg} hover:opacity-90 text-white text-xs font-medium transition disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          <span>💬</span> Chat
        </button>
        <div className="relative" ref={dropRef}>
          <button
            onClick={() => setShowActions(v => !v)}
            className="flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-medium transition"
          >
            ⚡ <span className="text-slate-500">▾</span>
          </button>
          {showActions && (
            <div className="absolute right-0 bottom-full mb-1 w-52 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-20 overflow-hidden">
              {agent.quickActions.map(qa => (
                <button
                  key={qa.label}
                  onClick={() => { setShowActions(false); onChat(agent.id as AgentId); }}
                  className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 hover:text-white transition"
                >
                  {qa.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Terminal Section ────────────────────────────────────────────────────────

function TerminalSection() {
  const [output, setOutput] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [output]);

  const runCommand = useCallback(async (commandKey: string) => {
    setRunning(true);
    setCollapsed(false);
    setOutput(prev => [...prev, `\n$ ${COMMAND_LABELS[commandKey] ?? commandKey}\n`]);

    try {
      const res = await fetch('/api/terminal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: commandKey }),
      });

      if (!res.ok || !res.body) {
        setOutput(prev => [...prev, 'Erreur: commande non autorisée\n']);
        setRunning(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        setOutput(prev => [...prev, decoder.decode(value)]);
      }

      setOutput(prev => [...prev, '\n✓ Terminé\n']);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue';
      setOutput(prev => [...prev, `\nErreur: ${msg}\n`]);
    }

    setRunning(false);
  }, []);

  return (
    <div className="mt-6">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        {/* Terminal header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900">
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              <span className="w-3 h-3 rounded-full bg-red-500/80" />
              <span className="w-3 h-3 rounded-full bg-yellow-500/80" />
              <span className="w-3 h-3 rounded-full bg-green-500/80" />
            </div>
            <h2 className="text-white font-semibold text-sm flex items-center gap-2">
              💻 TERMINAL
              <span className="text-slate-500 text-xs font-normal">Novus Epoxy — Production</span>
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {running && (
              <span className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-green-400 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-green-400 text-[10px] font-bold uppercase">Exécution...</span>
              </span>
            )}
            {output.length > 0 && (
              <button
                onClick={() => setOutput([])}
                className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 text-[10px] transition"
              >
                Clear
              </button>
            )}
            <button
              onClick={() => setCollapsed(v => !v)}
              className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 text-xs transition"
            >
              {collapsed ? '▲ Ouvrir' : '▼ Réduire'}
            </button>
          </div>
        </div>

        {!collapsed && (
          <>
            {/* Quick command buttons */}
            <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-slate-800 bg-slate-900/50">
              <span className="text-slate-500 text-xs self-center mr-1">Commandes rapides:</span>
              {TERMINAL_COMMANDS.map(c => (
                <button
                  key={c.key}
                  onClick={() => void runCommand(c.key)}
                  disabled={running}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-medium transition disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* Terminal output */}
            <div
              ref={scrollRef}
              className="bg-black px-4 py-3 font-mono text-sm h-72 overflow-y-auto"
            >
              {output.length === 0 ? (
                <div className="text-slate-600 flex items-center gap-2">
                  <span className="text-green-500">$</span>
                  <span className="animate-pulse">▋</span>
                  <span className="text-slate-700 text-xs ml-2">Cliquez une commande pour commencer</span>
                </div>
              ) : (
                output.map((line, i) => (
                  <span
                    key={i}
                    className={
                      line.startsWith('\n$') ? 'text-cyan-400 font-bold' :
                      line.startsWith('\n✓') ? 'text-green-400 font-bold' :
                      line.startsWith('\nErreur') || line.startsWith('Erreur') ? 'text-red-400' :
                      'text-green-300/90'
                    }
                  >
                    {line}
                  </span>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MissionControlClient({ authorName, initialActivity }: Props) {
  const [activity, setActivity] = useState<ActivityData>(initialActivity);
  const [activeAgent, setActiveAgent] = useState<AgentId | null>(null);
  const [activeAgents, setActiveAgents] = useState<Set<string>>(new Set());
  const [loadingAgents, setLoadingAgents] = useState<Set<string>>(new Set());
  const [disabledAgents, setDisabledAgents] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const saved = localStorage.getItem('mc_disabled_agents');
      return saved ? new Set(JSON.parse(saved) as string[]) : new Set();
    } catch { return new Set(); }
  });
  const [now, setNow] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);

  const handleToggleAgent = useCallback((id: AgentId) => {
    setDisabledAgents(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      localStorage.setItem('mc_disabled_agents', JSON.stringify([...next]));
      return next;
    });
  }, []);

  // Live clock
  useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  // Refresh activity
  const refreshActivity = useCallback(async () => {
    try {
      const res = await fetch('/api/agents/activity');
      if (res.ok) setActivity(await res.json() as ActivityData);
    } catch { /* noop */ }
  }, []);

  // Close panel on ESC
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClosePanel(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  // Track active agent in set
  const handleOpenChat = useCallback((id: AgentId) => {
    setActiveAgent(id);
    setActiveAgents(prev => new Set(prev).add(id));
  }, []);

  const handleClosePanel = useCallback(() => {
    if (activeAgent) {
      setActiveAgents(prev => {
        const next = new Set(prev);
        next.delete(activeAgent);
        return next;
      });
      setLoadingAgents(prev => {
        const next = new Set(prev);
        next.delete(activeAgent);
        return next;
      });
    }
    setActiveAgent(null);
  }, [activeAgent]);

  const handleLoadingChange = useCallback((loading: boolean) => {
    if (!activeAgent) return;
    if (loading) {
      setLoadingAgents(prev => new Set(prev).add(activeAgent));
    } else {
      setLoadingAgents(prev => {
        const next = new Set(prev);
        next.delete(activeAgent);
        return next;
      });
    }
  }, [activeAgent]);

  const timeline = getTimelineEvents(activity);
  const activeAgentData = AGENTS.find(a => a.id === activeAgent);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 backdrop-blur px-6 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              🚀 <span>Mission Control</span>
              <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-normal">{AGENTS.length - disabledAgents.size} AGENTS ACTIFS</span>
            </h1>
            <p className="text-slate-500 text-xs mt-0.5">Quartier général IA — Novus Epoxy</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-slate-400 text-sm font-mono">{now}</span>
            <button
              onClick={() => void refreshActivity()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs transition"
            >
              🔄 Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="px-6 py-5">
        {/* Timeline */}
        <div className="mb-6">
          <h2 className="text-xs text-slate-500 uppercase tracking-widest font-semibold mb-2">📡 Activité aujourd&apos;hui</h2>
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
            {timeline.map((ev, i) => (
              <div key={i} className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 whitespace-nowrap flex-shrink-0">
                <span className="text-base">{ev.emoji}</span>
                <div>
                  <p className="text-slate-200 text-xs font-medium">{ev.text}</p>
                  <p className="text-slate-500 text-[10px]">{ev.agent}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Agent grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {AGENTS.map(agent => (
            <AgentCard
              key={agent.id}
              agent={agent}
              activity={activity}
              isActive={activeAgents.has(agent.id)}
              isStreaming={loadingAgents.has(agent.id)}
              isEnabled={!disabledAgents.has(agent.id)}
              onChat={handleOpenChat}
              onToggle={handleToggleAgent}
            />
          ))}
        </div>

        {/* Terminal */}
        <TerminalSection />
      </div>

      {/* Chat overlay backdrop */}
      {activeAgent && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
          onClick={handleClosePanel}
        />
      )}

      {/* Chat slide-in panel */}
      <div
        ref={panelRef}
        className={`fixed top-0 right-0 h-full w-full sm:w-[480px] bg-slate-900 border-l border-slate-700 z-50 flex flex-col shadow-2xl transition-transform duration-300 ${
          activeAgent ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {activeAgent && activeAgentData && (
          <ChatPanel
            agentId={activeAgent}
            agentName={activeAgentData.name}
            agentEmoji={activeAgentData.emoji}
            agentColor={activeAgentData.color}
            authorName={authorName}
            onClose={handleClosePanel}
            onLoadingChange={handleLoadingChange}
          />
        )}
      </div>
    </div>
  );
}
