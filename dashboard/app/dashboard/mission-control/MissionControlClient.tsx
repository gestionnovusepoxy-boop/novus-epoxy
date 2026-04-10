'use client';

import { useChat } from 'ai/react';
import { useEffect, useRef, useState, useCallback } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ActivityData {
  marcel?:  { messages: number; label: string };
  hunter?:  { chauds: number; tiedes: number; froids: number; nouveaux: number; total_leads: number; prospects_envoyes: number; prospects_semaine: number; last_action: string | null };
  aria?:    { emails_today: number; total_envoyes: number; ouverts: number; cliques: number; semaine: number; last_action: string | null; leads_importes_today: number; closer_today: number; suivis_semaine: number; reponses_semaine: number; offres_today: number };
  rex?:     { devis_today: number; en_attente: number; envoyes: number; total: number };
  iris?:    { confirmes: string; pipeline: string; actifs: number };
  sage?:    { total_photos: number; total_videos: number; featured: number; total_items: number; last_scan: string | null };
  zara?:    { a_venir: number; confirmees_today: number; total_confirmes: number; prochain: string | null };
  bolt?:    { notifications: number };
  echo?:    { env_ok: number; env_total: number; env_missing: string[] };
  nova?:    { today: number; en_attente: number; devis_today: number; total_devis: number; total_convos: number };
  jason?:   { total_leads: number; chauds: number; emails_envoyes: number; relances: number; convertis: number; leads_semaine: number };
  health?:  Record<string, 'green' | 'yellow' | 'red'>;
}

interface AgentLiveStatus {
  status: 'running' | 'veille' | 'erreur';
  detail: string;
  lastCheck?: string;
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
    id: 'aria', name: 'Aria', emoji: '📧', role: 'Closer Automatique',
    desc: 'Import leads, offres, closer, suivis 48h/5j, détection réponses',
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
    id: 'sage', name: 'Sage', emoji: '✍️', role: 'Content & Portfolio',
    desc: 'Portfolio auto — scanne Google Drive, classifie, upload',
    color: 'pink',
    ring: 'ring-pink-500/40', bg: 'bg-pink-600', text: 'text-pink-400',
    border: 'border-pink-500/20', glow: 'shadow-pink-500/10',
    quickActions: [
      { label: '📸 Scanner Drive', msg: 'sage-scan-drive' },
      { label: '👁️ Preview Drive', msg: 'sage-preview-drive' },
      { label: 'Post Instagram', msg: 'Génère un post Instagram percutant pour Novus Epoxy avec des hashtags' },
      { label: 'Post avant/après', msg: 'Génère un post style avant/après pour un projet époxy flake garage' },
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
  {
    id: 'jason', name: 'Denis', emoji: '🏗️', role: 'Prospecteur Avance',
    desc: 'Prospection autonome — emails, SMS, leads de Jason',
    color: 'yellow',
    ring: 'ring-yellow-500/40', bg: 'bg-yellow-600', text: 'text-yellow-400',
    border: 'border-yellow-500/20', glow: 'shadow-yellow-500/10',
    quickActions: [
      { label: 'Mes leads', msg: 'Montre-moi tous mes leads de prospection' },
      { label: 'Leads chauds', msg: 'Quels sont mes leads chauds à contacter en priorité?' },
      { label: 'Envoyer prospection', msg: 'Génère et envoie un email + SMS de prospection pour mon lead le plus chaud' },
      { label: 'Stats prospection', msg: 'Donne-moi mes statistiques de prospection: emails envoyés, relances, conversions' },
    ],
  },
] as const;

type AgentId = (typeof AGENTS)[number]['id'];

// ─── Activity conseil helper ───────────────────────────────────────────────

function getConseil(id: AgentId, activity: ActivityData): string {
  const healthStatus = activity.health?.[id] ?? 'green';
  // Show health warning first if agent has a problem
  if (healthStatus === 'red') {
    const reasons: Record<string, string> = {
      hunter: 'API Claude non configurée',
      aria: 'Google API non configurée',
      rex: 'Twilio non configuré',
      sage: 'Google Drive API non configurée',
      bolt: 'Telegram Bot non configuré',
      nova: 'API Claude non configurée',
      jason: 'API Claude non configurée',
    };
    return `⛔ ${reasons[id] ?? 'Service non disponible'}`;
  }

  switch (id) {
    case 'marcel':
      return activity.marcel?.messages
        ? `${activity.marcel.messages} messages en mémoire partagée`
        : 'Demande-moi n\'importe quoi!';
    case 'hunter': {
      const h = activity.hunter;
      if (!h) return 'Score tes leads maintenant';
      if (h.chauds > 0) return `🔥 ${h.chauds} lead${h.chauds > 1 ? 's' : ''} chaud${h.chauds > 1 ? 's' : ''} à closer! · ${h.prospects_envoyes} prospects envoyés`;
      if (h.nouveaux > 0) return `⚡ ${h.nouveaux} nouveau${h.nouveaux > 1 ? 'x' : ''} lead${h.nouveaux > 1 ? 's' : ''} · ${h.total_leads} leads au total`;
      if (h.tiedes > 0) return `${h.tiedes} leads tièdes à scorer · ${h.prospects_semaine} prospects cette semaine`;
      return h.last_action ? `Dernière action ${h.last_action}` : 'Lance un scoring de leads';
    }
    case 'aria': {
      const a = activity.aria;
      if (!a) return 'Vérifie ta boîte Gmail';
      const parts = [];
      if (a.leads_importes_today > 0) parts.push(`${a.leads_importes_today} leads importés`);
      if (a.offres_today > 0) parts.push(`${a.offres_today} offres envoyées`);
      if (a.closer_today > 0) parts.push(`${a.closer_today} réponses closer`);
      if (parts.length > 0) return parts.join(' · ');
      if (a.semaine > 0) return `${a.semaine} emails cette semaine · ${a.reponses_semaine} réponses`;
      return a.last_action ? `Dernière activité ${a.last_action}` : 'Aucun email récent';
    }
    case 'rex': {
      const r = activity.rex;
      if (!r) return 'Génère des relances SMS';
      if (r.en_attente > 0) return `${r.en_attente} devis en attente — relance par SMS!`;
      if (r.devis_today > 0) return `${r.devis_today} devis créé${r.devis_today > 1 ? 's' : ''} aujourd'hui · ${r.envoyes} envoyés`;
      return `${r.total} devis au total · ${r.envoyes} envoyés`;
    }
    case 'iris': {
      const i = activity.iris;
      if (!i) return 'Analyse tes finances';
      if (i.actifs > 0) return `${i.actifs} devis actifs · Pipeline: ${i.pipeline}`;
      return `Revenus confirmés: ${i.confirmes}`;
    }
    case 'sage': {
      const s = activity.sage;
      if (!s) return 'Scanne le Drive pour du contenu!';
      if (healthStatus === 'yellow') return `⚠️ Aucun scan récent · ${s.total_photos} photos, ${s.total_videos} vidéos au portfolio`;
      return `${s.total_photos} photos + ${s.total_videos} vidéos · ${s.featured} featured${s.last_scan ? ` · Scan ${s.last_scan}` : ''}`;
    }
    case 'zara': {
      const z = activity.zara;
      if (!z) return 'Vérifie le calendrier';
      if (z.a_venir > 0 && z.prochain) {
        const prochainDate = new Date(z.prochain).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
        return `${z.a_venir} réservation${z.a_venir > 1 ? 's' : ''} à venir · Prochain: ${prochainDate}`;
      }
      return z.a_venir > 0 ? `${z.a_venir} réservation${z.a_venir > 1 ? 's' : ''} à venir` : 'Aucune réservation planifiée';
    }
    case 'bolt':
      return 'Envoie un update à l\'équipe';
    case 'echo': {
      const e = activity.echo;
      if (!e) return 'Vérifie le système';
      const missing = e.env_total - e.env_ok;
      if (missing > 0) return `⚠️ ${missing} var${missing > 1 ? 's' : ''} manquante${missing > 1 ? 's' : ''}: ${e.env_missing?.join(', ')}`;
      return `✅ ${e.env_ok}/${e.env_total} vars configurées — système opérationnel`;
    }
    case 'nova': {
      const n = activity.nova;
      if (!n) return 'Vérifie le chatbot';
      if (n.en_attente > 0) return `⏳ ${n.en_attente} devis en attente d'approbation!`;
      if (n.today > 0) return `${n.today} conversation${n.today > 1 ? 's' : ''} aujourd'hui · ${n.total_convos} total`;
      return `${n.total_convos} conversations au total · ${n.total_devis} devis générés`;
    }
    case 'jason': {
      const j = activity.jason;
      if (!j) return 'Importe tes leads et lance la prospection!';
      if (j.chauds > 0) return `🔥 ${j.chauds} lead${j.chauds > 1 ? 's' : ''} chaud${j.chauds > 1 ? 's' : ''} · ${j.emails_envoyes} emails envoyés`;
      if (j.leads_semaine > 0) return `${j.leads_semaine} leads cette semaine · ${j.convertis} convertis`;
      return `${j.total_leads} leads au total · ${j.emails_envoyes} emails envoyés`;
    }
    default: return '';
  }
}

function getMetrics(id: AgentId, activity: ActivityData): { label: string; value: string }[] {
  switch (id) {
    case 'marcel': return [
      { label: 'Mémoire', value: `${activity.marcel?.messages ?? 0} msgs` },
    ];
    case 'hunter': {
      const h = activity.hunter;
      return [
        { label: 'Leads chauds', value: String(h?.chauds ?? 0) },
        { label: 'Leads tièdes', value: String(h?.tiedes ?? 0) },
        { label: 'Prospects envoyés', value: String(h?.prospects_envoyes ?? 0) },
        { label: 'Cette semaine', value: String(h?.prospects_semaine ?? 0) },
      ];
    }
    case 'aria': {
      const a = activity.aria;
      return [
        { label: 'Leads importés (auj)', value: String(a?.leads_importes_today ?? 0) },
        { label: 'Offres envoyées (auj)', value: String(a?.offres_today ?? 0) },
        { label: 'Closer réponses (auj)', value: String(a?.closer_today ?? 0) },
        { label: 'Suivis cette semaine', value: String(a?.suivis_semaine ?? 0) },
        { label: 'Réponses détectées', value: String(a?.reponses_semaine ?? 0) },
        { label: 'Emails total', value: String(a?.total_envoyes ?? 0) },
      ];
    }
    case 'rex': return [
      { label: 'Devis envoyés', value: String(activity.rex?.envoyes ?? 0) },
      { label: 'En attente', value: String(activity.rex?.en_attente ?? 0) },
      { label: "Aujourd'hui", value: String(activity.rex?.devis_today ?? 0) },
      { label: 'Total devis', value: String(activity.rex?.total ?? 0) },
    ];
    case 'iris': return [
      { label: 'Confirmés', value: activity.iris?.confirmes ?? '0$' },
      { label: 'Pipeline', value: activity.iris?.pipeline ?? '0$' },
      { label: 'Devis actifs', value: String(activity.iris?.actifs ?? 0) },
    ];
    case 'sage': {
      const s = activity.sage;
      return [
        { label: 'Photos', value: String(s?.total_photos ?? 0) },
        { label: 'Vidéos', value: String(s?.total_videos ?? 0) },
        { label: 'Featured', value: String(s?.featured ?? 0) },
        { label: 'Total items', value: String(s?.total_items ?? 0) },
      ];
    }
    case 'zara': {
      const z = activity.zara;
      const prochainLabel = z?.prochain
        ? new Date(z.prochain).toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' })
        : '—';
      return [
        { label: 'À venir', value: String(z?.a_venir ?? 0) },
        { label: 'Confirmées', value: String(z?.total_confirmes ?? 0) },
        { label: 'Prochain job', value: prochainLabel },
      ];
    }
    case 'bolt': return [
      { label: 'Notifications', value: String(activity.bolt?.notifications ?? 0) },
    ];
    case 'echo': {
      const e = activity.echo;
      const missing = (e?.env_missing?.length ?? 0);
      return [
        { label: 'Env OK', value: `${e?.env_ok ?? 0}/${e?.env_total ?? 0}` },
        { label: 'Manquantes', value: missing > 0 ? String(missing) : '0' },
      ];
    }
    case 'nova': {
      const n = activity.nova;
      return [
        { label: "Aujourd'hui", value: String(n?.today ?? 0) },
        { label: 'Attente appro', value: String(n?.en_attente ?? 0) },
        { label: 'Devis générés', value: String(n?.total_devis ?? 0) },
        { label: 'Total convos', value: String(n?.total_convos ?? 0) },
      ];
    }
    case 'jason': {
      const j = activity.jason;
      return [
        { label: 'Leads', value: String(j?.total_leads ?? 0) },
        { label: 'Chauds', value: String(j?.chauds ?? 0) },
        { label: 'Emails envoyés', value: String(j?.emails_envoyes ?? 0) },
        { label: 'Convertis', value: String(j?.convertis ?? 0) },
      ];
    }
    default: return [];
  }
}

function getTimelineEvents(activity: ActivityData): { emoji: string; text: string; agent: string }[] {
  const events: { emoji: string; text: string; agent: string }[] = [];
  // Health alerts first
  if (activity.health) {
    const redAgents = Object.entries(activity.health).filter(([, v]) => v === 'red').map(([k]) => k);
    if (redAgents.length > 0)
      events.push({ emoji: '🔴', text: `${redAgents.length} agent${redAgents.length > 1 ? 's' : ''} en erreur: ${redAgents.join(', ')}`, agent: 'Système' });
  }
  if ((activity.hunter?.chauds ?? 0) > 0)
    events.push({ emoji: '🎯', text: `${activity.hunter!.chauds} leads chauds · ${activity.hunter!.prospects_envoyes} prospects envoyés`, agent: 'Hunter' });
  if ((activity.nova?.en_attente ?? 0) > 0)
    events.push({ emoji: '⏳', text: `${activity.nova!.en_attente} devis en attente d'approbation`, agent: 'Nova' });
  if ((activity.nova?.today ?? 0) > 0)
    events.push({ emoji: '💬', text: `${activity.nova!.today} conversations chatbot aujourd'hui`, agent: 'Nova' });
  if ((activity.aria?.leads_importes_today ?? 0) > 0)
    events.push({ emoji: '📥', text: `${activity.aria!.leads_importes_today} leads importés aujourd'hui`, agent: 'Aria' });
  if ((activity.aria?.offres_today ?? 0) > 0)
    events.push({ emoji: '📧', text: `${activity.aria!.offres_today} offres envoyées · ${activity.aria!.closer_today} réponses closer`, agent: 'Aria' });
  if ((activity.aria?.reponses_semaine ?? 0) > 0)
    events.push({ emoji: '🔥', text: `${activity.aria!.reponses_semaine} leads ont répondu cette semaine`, agent: 'Aria' });
  if ((activity.rex?.en_attente ?? 0) > 0)
    events.push({ emoji: '📱', text: `${activity.rex!.en_attente} devis en attente de réponse`, agent: 'Rex' });
  if ((activity.iris?.actifs ?? 0) > 0)
    events.push({ emoji: '💰', text: `Pipeline ${activity.iris!.pipeline} · ${activity.iris!.actifs} devis actifs`, agent: 'Iris' });
  if ((activity.zara?.a_venir ?? 0) > 0)
    events.push({ emoji: '📅', text: `${activity.zara!.a_venir} réservations à venir`, agent: 'Zara' });
  if ((activity.sage?.total_items ?? 0) > 0)
    events.push({ emoji: '📸', text: `Portfolio: ${activity.sage!.total_photos} photos + ${activity.sage!.total_videos} vidéos`, agent: 'Sage' });
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
  liveStatus,
  onChat,
  onToggle,
  onTest,
  onRestart,
}: {
  agent: (typeof AGENTS)[number];
  activity: ActivityData;
  isActive: boolean;
  isStreaming: boolean;
  isEnabled: boolean;
  liveStatus?: AgentLiveStatus;
  onChat: (id: AgentId) => void;
  onToggle: (id: AgentId) => void;
  onTest: (id: AgentId) => void;
  onRestart: (id: AgentId) => void;
}) {
  const conseil = getConseil(agent.id as AgentId, activity);
  const metrics = getMetrics(agent.id as AgentId, activity);
  const [showActions, setShowActions] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setShowActions(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Clear feedback after 4s
  useEffect(() => {
    if (!actionFeedback) return;
    const t = setTimeout(() => setActionFeedback(null), 4000);
    return () => clearTimeout(t);
  }, [actionFeedback]);

  // Status indicator — uses live status from /api/agents/status if available, falls back to health
  const resolvedStatus = liveStatus?.status;
  const agentHealth = activity.health?.[agent.id as string] ?? 'green';
  let statusDot: string;
  let statusText: string;
  let statusTextColor: string;
  if (!isEnabled) {
    statusDot = 'bg-red-500';
    statusText = 'DESACTIVE';
    statusTextColor = 'text-red-400';
  } else if (isStreaming) {
    statusDot = 'bg-green-400 animate-ping';
    statusText = 'ACTIF';
    statusTextColor = 'text-green-400';
  } else if (resolvedStatus === 'erreur' || (!resolvedStatus && agentHealth === 'red')) {
    statusDot = 'bg-red-500 animate-pulse';
    statusText = 'Erreur';
    statusTextColor = 'text-red-400';
  } else if (resolvedStatus === 'veille' || (!resolvedStatus && agentHealth === 'yellow')) {
    statusDot = 'bg-yellow-400';
    statusText = 'En veille';
    statusTextColor = 'text-yellow-400';
  } else if (resolvedStatus === 'running') {
    statusDot = 'bg-emerald-400 animate-[pulse_2s_ease-in-out_infinite]';
    statusText = 'Actif';
    statusTextColor = 'text-emerald-400';
  } else {
    statusDot = 'bg-emerald-400';
    statusText = 'Actif';
    statusTextColor = 'text-emerald-400';
  }

  return (
    <div className={`relative flex flex-col bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800/80 border ${agent.border} rounded-2xl p-4 shadow-lg ${agent.glow} hover:shadow-xl hover:border-opacity-60 transition-all duration-200 group ${isStreaming ? 'ring-2 ring-green-500/30' : ''} ${!isEnabled ? 'opacity-50 grayscale' : ''}`}>
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-11 h-11 rounded-xl ${agent.bg} flex items-center justify-center text-xl flex-shrink-0 shadow-lg overflow-hidden`}>
          {(agent as Record<string, unknown>).image ? (
            <img src={(agent as Record<string, unknown>).image as string} alt={agent.name} className="w-full h-full object-cover" />
          ) : (
            agent.emoji
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-white font-bold text-base">{agent.name}</h3>
            <span className="flex items-center gap-1.5">
              <span className="relative flex-shrink-0">
                <span className={`block w-2.5 h-2.5 rounded-full ${statusDot}`} />
                {(statusText === 'Actif' || statusText === 'ACTIF') && (
                  <span className={`absolute inset-0 w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping opacity-75`} />
                )}
              </span>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${statusTextColor}`}>{statusText}</span>
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
        <div className={`grid gap-2 mb-3 ${metrics.length >= 4 ? 'grid-cols-2' : metrics.length === 3 ? 'grid-cols-3' : metrics.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {metrics.map(m => {
            const isZero = m.value === '0' || m.value === '—';
            return (
              <div key={m.label} className="flex flex-col items-center bg-gradient-to-b from-slate-800/90 to-slate-800/50 rounded-lg px-2 py-2 border border-slate-700/30">
                <span className={`text-2xl font-extrabold tracking-tight ${isZero ? 'text-slate-600' : agent.text}`}>{m.value}</span>
                <span className="text-[10px] text-slate-400 mt-1 text-center leading-tight font-medium">{m.label}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Conseil */}
      <div className={`flex items-start gap-2 bg-slate-800/50 rounded-lg px-3 py-2 mb-3 border ${agent.border}`}>
        <span className="text-base flex-shrink-0">💡</span>
        <p className="text-slate-300 text-xs leading-relaxed">{conseil}</p>
      </div>

      {/* Live status detail */}
      {liveStatus && (
        <p className={`text-[10px] mb-2 text-center ${
          liveStatus.status === 'erreur' ? 'text-red-400' :
          liveStatus.status === 'veille' ? 'text-yellow-400' :
          'text-slate-500'
        }`}>
          {liveStatus.detail}
        </p>
      )}

      {/* Last activity */}
      {(() => {
        const lastAction = (() => {
          switch (agent.id) {
            case 'hunter': return activity.hunter?.last_action;
            case 'aria': return activity.aria?.last_action;
            case 'sage': return activity.sage?.last_scan ? `Scan ${activity.sage.last_scan}` : null;
            default: return null;
          }
        })();
        return lastAction ? (
          <p className="text-[10px] text-slate-600 mb-2 text-center">Derniere activite: {lastAction}</p>
        ) : null;
      })()}

      {/* Action feedback */}
      {actionFeedback && (
        <div className="bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-1.5 mb-2 text-center">
          <p className="text-xs text-slate-300">{actionFeedback}</p>
        </div>
      )}

      {/* Buttons */}
      <div className="flex gap-2 mt-auto">
        <button
          onClick={() => onChat(agent.id as AgentId)}
          disabled={!isEnabled}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg ${agent.bg} hover:opacity-90 hover:scale-[1.02] text-white text-sm font-bold transition-all duration-150 shadow-md disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100`}
        >
          <span>💬</span> Chat
        </button>
        <button
          onClick={() => { onTest(agent.id as AgentId); setActionFeedback('Verification...'); }}
          title="Tester"
          className="flex items-center gap-1 px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-medium transition"
        >
          🧪
        </button>
        <button
          onClick={() => { onRestart(agent.id as AgentId); setActionFeedback('Redemarrage...'); }}
          title="Redemarrer"
          className="flex items-center gap-1 px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-medium transition"
        >
          🔄
        </button>
        <div className="relative" ref={dropRef}>
          <button
            onClick={() => setShowActions(v => !v)}
            className="flex items-center gap-1 px-2.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-medium transition"
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
  const [liveStatuses, setLiveStatuses] = useState<Record<string, AgentLiveStatus>>({});
  const [statusLoading, setStatusLoading] = useState(false);
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

  // Fetch live statuses for all agents
  const refreshStatuses = useCallback(async () => {
    setStatusLoading(true);
    try {
      const res = await fetch('/api/agents/status');
      if (res.ok) {
        const data = await res.json() as Record<string, AgentLiveStatus>;
        setLiveStatuses(data);
      }
    } catch { /* noop */ }
    setStatusLoading(false);
  }, []);

  // Test a single agent
  const handleTestAgent = useCallback(async (id: AgentId) => {
    try {
      const res = await fetch(`/api/agents/status?agent=${id}`);
      if (res.ok) {
        const data = await res.json() as Record<string, AgentLiveStatus>;
        setLiveStatuses(prev => ({ ...prev, ...data }));
      }
    } catch { /* noop */ }
  }, []);

  // Restart/trigger a single agent
  const handleRestartAgent = useCallback(async (id: AgentId) => {
    try {
      const res = await fetch('/api/agents/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: id }),
      });
      if (res.ok) {
        // After restart, re-check the agent status
        setTimeout(() => { void handleTestAgent(id); }, 2000);
      }
    } catch { /* noop */ }
  }, [handleTestAgent]);

  // Fetch activity on mount + every 30 seconds
  useEffect(() => {
    void refreshActivity();
    const interval = setInterval(() => { void refreshActivity(); }, 30000);
    return () => clearInterval(interval);
  }, [refreshActivity]);

  // Auto-refresh statuses every 60 seconds
  useEffect(() => {
    void refreshStatuses();
    const interval = setInterval(() => { void refreshStatuses(); }, 60000);
    return () => clearInterval(interval);
  }, [refreshStatuses]);

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

  // Compute live status summary
  const statusEntries = Object.values(liveStatuses);
  const runningCount = statusEntries.filter(s => s.status === 'running').length;
  const veilleCount = statusEntries.filter(s => s.status === 'veille').length;
  const erreurCount = statusEntries.filter(s => s.status === 'erreur').length;
  const totalChecked = statusEntries.length;

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 backdrop-blur px-6 py-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              🚀 <span>Mission Control</span>
              <span className="text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-normal">{AGENTS.length - disabledAgents.size} AGENTS ACTIFS</span>
            </h1>
            <p className="text-slate-500 text-xs mt-0.5">Quartier general IA — Novus Epoxy</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Live status summary bar */}
            {totalChecked > 0 && (
              <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5">
                <span className="text-slate-400 text-xs">Tous les systemes:</span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-emerald-400 text-xs font-semibold">{runningCount}</span>
                </span>
                {veilleCount > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-yellow-400" />
                    <span className="text-yellow-400 text-xs font-semibold">{veilleCount}</span>
                  </span>
                )}
                {erreurCount > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    <span className="text-red-400 text-xs font-semibold">{erreurCount}</span>
                  </span>
                )}
                <span className="text-slate-600 text-xs">/ {totalChecked}</span>
              </div>
            )}
            <span className="text-slate-400 text-sm font-mono">{now}</span>
            <button
              onClick={() => { void refreshActivity(); void refreshStatuses(); }}
              disabled={statusLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs transition disabled:opacity-50"
            >
              {statusLoading ? (
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : '🔄'} Tout verifier
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
              liveStatus={liveStatuses[agent.id]}
              onChat={handleOpenChat}
              onToggle={handleToggleAgent}
              onTest={handleTestAgent}
              onRestart={handleRestartAgent}
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
