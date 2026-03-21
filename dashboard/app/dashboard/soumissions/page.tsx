'use client';

import { useState, useCallback } from 'react';
import { PollingProvider } from '@/components/polling-provider';
import { fetchSubmissions, updateSubmissionStatus, type Submission } from '@/lib/api';
import { formatDate } from '@/lib/utils';

const STATUTS = ['nouveau', 'lu', 'en_traitement', 'ferme'] as const;

const BADGE: Record<Submission['statut'], string> = {
  nouveau:        'bg-blue-500/20 text-blue-300 border-blue-500/30',
  lu:             'bg-slate-500/20 text-slate-300 border-slate-500/30',
  en_traitement:  'bg-amber-500/20 text-amber-300 border-amber-500/30',
  ferme:          'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
};

const LABEL: Record<Submission['statut'], string> = {
  nouveau:        'Nouveau',
  lu:             'Lu',
  en_traitement:  'En traitement',
  ferme:          'Fermé',
};

function SubmissionRow({ s, onUpdate }: { s: Submission; onUpdate: () => void }) {
  const [loading, setLoading] = useState(false);

  async function handleStatut(statut: Submission['statut']) {
    setLoading(true);
    await updateSubmissionStatus(s.id, statut);
    onUpdate();
    setLoading(false);
  }

  return (
    <tr className="border-b border-slate-700 hover:bg-slate-700/50 transition">
      <td className="px-4 py-3">
        <p className="text-white text-sm font-medium">{s.nom}</p>
        <p className="text-slate-400 text-xs">{s.email}</p>
      </td>
      <td className="px-4 py-3 text-slate-300 text-sm">{s.telephone ?? '—'}</td>
      <td className="px-4 py-3 text-slate-300 text-sm">{s.service ?? '—'}</td>
      <td className="px-4 py-3">
        <select
          value={s.statut}
          disabled={loading}
          onChange={e => handleStatut(e.target.value as Submission['statut'])}
          className={`text-xs font-medium px-2 py-1 rounded border bg-transparent cursor-pointer ${BADGE[s.statut]}`}
        >
          {STATUTS.map(st => (
            <option key={st} value={st} className="bg-slate-800 text-white">
              {LABEL[st]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{formatDate(s.created_at)}</td>
    </tr>
  );
}

function PageContent() {
  const [data, setData]       = useState<Submission[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [statut, setStatut]   = useState('');
  const [search, setSearch]   = useState('');

  const load = useCallback(async () => {
    const res = await fetchSubmissions({ page, limit: 25, statut: statut || undefined, search: search || undefined });
    setData(res.data);
    setTotal(res.total);
  }, [page, statut, search]);

  return (
    <PollingProvider onRefresh={load}>
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">Soumissions</h2>
          <span className="text-slate-400 text-sm">{total} au total</span>
        </div>

        {/* Filtres */}
        <div className="flex gap-3 flex-wrap">
          <input
            type="text"
            placeholder="Rechercher nom ou email…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 w-64"
          />
          <select
            value={statut}
            onChange={e => { setStatut(e.target.value); setPage(1); }}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
          >
            <option value="">Tous les statuts</option>
            {STATUTS.map(st => <option key={st} value={st}>{LABEL[st]}</option>)}
          </select>
        </div>

        {/* Table */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-900/50">
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Client</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Téléphone</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Service</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Statut</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Date</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr><td colSpan={5} className="text-center py-8 text-slate-500 text-sm">Aucune soumission</td></tr>
              )}
              {data.map(s => <SubmissionRow key={s.id} s={s} onUpdate={load} />)}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > 25 && (
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 bg-slate-700 rounded text-sm text-white disabled:opacity-40"
            >
              ← Précédent
            </button>
            <span className="px-3 py-1.5 text-slate-400 text-sm">
              Page {page} / {Math.ceil(total / 25)}
            </span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page >= Math.ceil(total / 25)}
              className="px-3 py-1.5 bg-slate-700 rounded text-sm text-white disabled:opacity-40"
            >
              Suivant →
            </button>
          </div>
        )}
      </div>
    </PollingProvider>
  );
}

export default function SoumissionsPage() {
  return <PageContent />;
}
