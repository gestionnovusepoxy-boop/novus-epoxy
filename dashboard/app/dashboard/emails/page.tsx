'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { PollingProvider } from '@/components/polling-provider';
import { fetchEmails, fetchEmailStats, type EmailLog, type EmailStats } from '@/lib/api';
import { formatDate } from '@/lib/utils';

const BADGE: Record<EmailLog['statut'], string> = {
  sent:        'bg-slate-500/20 text-slate-300 border-slate-500/30',
  delivered:   'bg-blue-500/20 text-blue-300 border-blue-500/30',
  opened:      'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  clicked:     'bg-amber-500/20 text-amber-300 border-amber-500/30',
  bounced:     'bg-red-500/20 text-red-300 border-red-500/30',
  complained:  'bg-rose-500/20 text-rose-300 border-rose-500/30',
};

const LABEL: Record<EmailLog['statut'], string> = {
  sent:       'Envoyé',
  delivered:  'Livré',
  opened:     'Ouvert',
  clicked:    'Cliqué',
  bounced:    'Bounce',
  complained: 'Spam',
};

type TabKey = 'tous' | 'conversations' | 'prospection' | 'offres' | 'bounces';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'tous',           label: 'Tous' },
  { key: 'conversations',  label: 'Conversations' },
  { key: 'prospection',    label: 'Prospection' },
  { key: 'offres',         label: 'Offres' },
  { key: 'bounces',        label: 'Bounces' },
];

interface EmailDetail extends EmailLog {
  html_body?: string | null;
  direction?: string;
}

interface ConversationRow {
  destinataire: string;
  email_count: number;
  last_date: string;
  last_sujet: string | null;
  last_statut: EmailLog['statut'];
}

function PageContent() {
  const [tab, setTab]         = useState<TabKey>('tous');
  const [data, setData]       = useState<EmailLog[]>([]);
  const [convos, setConvos]   = useState<ConversationRow[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [search, setSearch]   = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [stats, setStats]     = useState<EmailStats | null>(null);
  const [selected, setSelected]       = useState<EmailDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [expandedConvo, setExpandedConvo] = useState<string | null>(null);
  const [convoEmails, setConvoEmails]     = useState<EmailLog[]>([]);
  const [loadingConvo, setLoadingConvo]   = useState(false);

  // Reset page when tab or search changes
  useEffect(() => { setPage(1); }, [tab, search]);

  const loadStats = useCallback(async () => {
    try {
      const s = await fetchEmailStats();
      setStats(s);
    } catch { /* ignore */ }
  }, []);

  const load = useCallback(async () => {
    const apiTab = tab === 'tous' ? undefined : tab;
    const res = await fetchEmails({ page, limit: 25, tab: apiTab, search: search || undefined });
    if (tab === 'conversations') {
      setConvos(res.data as unknown as ConversationRow[]);
      setData([]);
    } else {
      setData(res.data);
      setConvos([]);
    }
    setTotal(res.total);
  }, [page, tab, search]);

  // Load stats on mount
  useEffect(() => { loadStats(); }, [loadStats]);

  const viewEmail = async (email: EmailLog) => {
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/emails/${email.id}`);
      if (res.ok) {
        const detail = await res.json();
        setSelected(detail);
      } else {
        setSelected({ ...email, html_body: null });
      }
    } catch {
      setSelected({ ...email, html_body: null });
    }
    setLoadingDetail(false);
  };

  const expandConversation = async (destinataire: string) => {
    if (expandedConvo === destinataire) {
      setExpandedConvo(null);
      setConvoEmails([]);
      return;
    }
    setExpandedConvo(destinataire);
    setLoadingConvo(true);
    try {
      const res = await fetchEmails({ page: 1, limit: 100, search: destinataire });
      setConvoEmails(res.data.filter(e => e.destinataire === destinataire));
    } catch {
      setConvoEmails([]);
    }
    setLoadingConvo(false);
  };

  const handleSearch = () => {
    setSearch(searchInput);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  // Client-side filter display (already done server-side, but keep for instant UX)
  const filteredData = useMemo(() => data, [data]);

  const totalPages = Math.ceil(total / 25);

  // KPI calculations
  const totalEnvoyes = stats ? stats.total - stats.bounced : 0;
  const tauxLivraison = stats && totalEnvoyes > 0 ? ((stats.delivered / totalEnvoyes) * 100).toFixed(1) : '0';
  const tauxOuverture = stats && stats.delivered > 0 ? ((stats.opened / stats.delivered) * 100).toFixed(1) : '0';

  return (
    <PollingProvider onRefresh={load}>
      <div className="p-3 sm:p-6 space-y-4 sm:space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">Emails</h2>
          <span className="text-slate-400 text-sm">{stats?.total ?? 0} au total</span>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <p className="text-slate-400 text-xs font-medium uppercase tracking-wider">Total envoyés</p>
            <p className="text-2xl font-bold text-white mt-1">{totalEnvoyes.toLocaleString('fr-CA')}</p>
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <p className="text-slate-400 text-xs font-medium uppercase tracking-wider">Taux livraison</p>
            <p className="text-2xl font-bold text-blue-400 mt-1">{tauxLivraison}%</p>
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <p className="text-slate-400 text-xs font-medium uppercase tracking-wider">Taux ouverture</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">{tauxOuverture}%</p>
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <p className="text-slate-400 text-xs font-medium uppercase tracking-wider">Bounces</p>
            <p className="text-2xl font-bold text-red-400 mt-1">{(stats?.bounced ?? 0).toLocaleString('fr-CA')}</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-900/50 rounded-lg p-1 overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition whitespace-nowrap ${
                tab === t.key
                  ? 'bg-slate-700 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="flex gap-2">
          <input
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Rechercher par destinataire ou sujet..."
            className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500"
          />
          <button
            onClick={handleSearch}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition"
          >
            Rechercher
          </button>
          {search && (
            <button
              onClick={() => { setSearch(''); setSearchInput(''); }}
              className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm rounded-lg transition"
            >
              Effacer
            </button>
          )}
        </div>

        {/* Content */}
        {tab === 'conversations' ? (
          /* Conversations view */
          <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-900/50">
                  <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Destinataire</th>
                  <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Emails</th>
                  <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Dernier sujet</th>
                  <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Statut</th>
                  <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Dernier email</th>
                </tr>
              </thead>
              <tbody>
                {convos.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-8 text-slate-500 text-sm">Aucune conversation</td></tr>
                )}
                {convos.map(c => (
                  <ConversationGroup
                    key={c.destinataire}
                    convo={c}
                    isExpanded={expandedConvo === c.destinataire}
                    onToggle={() => expandConversation(c.destinataire)}
                    emails={expandedConvo === c.destinataire ? convoEmails : []}
                    loading={expandedConvo === c.destinataire && loadingConvo}
                    onViewEmail={viewEmail}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* Standard table view */
          <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-900/50">
                  <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Destinataire</th>
                  <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Sujet</th>
                  <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Statut</th>
                  <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Ouvert le</th>
                  <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Envoyé le</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-8 text-slate-500 text-sm">Aucun email</td></tr>
                )}
                {filteredData.map(e => (
                  <tr key={e.id} className="border-b border-slate-700 hover:bg-slate-700/50 cursor-pointer transition" onClick={() => viewEmail(e)}>
                    <td className="px-4 py-3 text-white text-sm">{e.destinataire}</td>
                    <td className="px-4 py-3 text-slate-300 text-sm max-w-xs truncate">{e.sujet ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded border ${BADGE[e.statut]}`}>
                        {LABEL[e.statut]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{e.opened_at ? formatDate(e.opened_at) : '—'}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{formatDate(e.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {total > 25 && (
          <div className="flex gap-2 justify-end">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-3 py-1.5 bg-slate-700 rounded text-sm text-white disabled:opacity-40">Précédent</button>
            <span className="px-3 py-1.5 text-slate-400 text-sm">Page {page} / {totalPages}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages}
              className="px-3 py-1.5 bg-slate-700 rounded text-sm text-white disabled:opacity-40">Suivant</button>
          </div>
        )}
      </div>

      {/* Email detail panel */}
      {(selected || loadingDetail) && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setSelected(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative w-full max-w-2xl bg-slate-800 border-l border-slate-700 h-full overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-slate-800 border-b border-slate-700 px-6 py-4 flex items-center justify-between z-10">
              <h3 className="text-lg font-bold text-white">Email</h3>
              <button onClick={() => setSelected(null)} className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white text-xl transition">&times;</button>
            </div>
            {loadingDetail ? (
              <div className="p-6 text-slate-400">Chargement...</div>
            ) : selected && (
              <div className="p-6 space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">À</span>
                    <span className="text-white">{selected.destinataire}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Sujet</span>
                    <span className="text-white text-right max-w-[300px]">{selected.sujet}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Statut</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded border ${BADGE[selected.statut]}`}>{LABEL[selected.statut]}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Envoyé</span>
                    <span className="text-slate-300">{formatDate(selected.created_at)}</span>
                  </div>
                  {selected.opened_at && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Ouvert</span>
                      <span className="text-green-400">{formatDate(selected.opened_at)}</span>
                    </div>
                  )}
                </div>

                {selected.html_body ? (
                  <div className="mt-4">
                    <h4 className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-2">Contenu</h4>
                    <div className="bg-white rounded-lg p-4 overflow-auto max-h-[60vh]">
                      <iframe
                        srcDoc={selected.html_body}
                        sandbox=""
                        className="w-full min-h-[400px] border-0"
                        title="Email content"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 p-4 bg-slate-900/50 rounded-lg">
                    <p className="text-slate-500 text-sm">Contenu non disponible (emails envoyés avant la mise à jour)</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </PollingProvider>
  );
}

/* Conversation group sub-component */
function ConversationGroup({
  convo,
  isExpanded,
  onToggle,
  emails,
  loading,
  onViewEmail,
}: {
  convo: ConversationRow;
  isExpanded: boolean;
  onToggle: () => void;
  emails: EmailLog[];
  loading: boolean;
  onViewEmail: (e: EmailLog) => void;
}) {
  return (
    <>
      <tr
        className="border-b border-slate-700 hover:bg-slate-700/50 cursor-pointer transition"
        onClick={onToggle}
      >
        <td className="px-4 py-3 text-white text-sm">
          <span className="mr-2 text-slate-500 text-xs">{isExpanded ? '▼' : '▶'}</span>
          {convo.destinataire}
        </td>
        <td className="px-4 py-3 text-slate-300 text-sm">
          <span className="bg-slate-700 text-slate-300 text-xs font-medium px-2 py-0.5 rounded-full">
            {convo.email_count}
          </span>
        </td>
        <td className="px-4 py-3 text-slate-300 text-sm max-w-xs truncate">{convo.last_sujet ?? '—'}</td>
        <td className="px-4 py-3">
          {convo.last_statut && BADGE[convo.last_statut] ? (
            <span className={`text-xs font-medium px-2 py-0.5 rounded border ${BADGE[convo.last_statut]}`}>
              {LABEL[convo.last_statut]}
            </span>
          ) : (
            <span className="text-slate-500 text-xs">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{formatDate(convo.last_date)}</td>
      </tr>
      {isExpanded && (
        loading ? (
          <tr><td colSpan={5} className="px-8 py-3 text-slate-500 text-sm bg-slate-900/30">Chargement...</td></tr>
        ) : (
          emails.map(e => (
            <tr
              key={e.id}
              className="border-b border-slate-700/50 hover:bg-slate-700/30 cursor-pointer transition bg-slate-900/20"
              onClick={() => onViewEmail(e)}
            >
              <td className="px-4 py-2 pl-10 text-slate-400 text-xs">{e.destinataire}</td>
              <td className="px-4 py-2 text-slate-400 text-xs" />
              <td className="px-4 py-2 text-slate-400 text-xs max-w-xs truncate">{e.sujet ?? '—'}</td>
              <td className="px-4 py-2">
                <span className={`text-xs font-medium px-2 py-0.5 rounded border ${BADGE[e.statut]}`}>
                  {LABEL[e.statut]}
                </span>
              </td>
              <td className="px-4 py-2 text-slate-500 text-xs whitespace-nowrap">{formatDate(e.created_at)}</td>
            </tr>
          ))
        )
      )}
    </>
  );
}

export default function EmailsPage() {
  return <PageContent />;
}
