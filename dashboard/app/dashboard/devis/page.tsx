'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { PollingProvider } from '@/components/polling-provider';
import { fetchQuotes, updateQuote, deleteQuote, type Quote, type QuoteStatut } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { formatMoney } from '@/lib/pricing';

const STATUTS: QuoteStatut[] = ['brouillon', 'en_attente', 'approuve', 'envoye', 'contrat_signe', 'depot_paye', 'planifie', 'complete', 'refuse'];

const BADGE: Record<QuoteStatut, string> = {
  brouillon:      'bg-slate-500/20 text-slate-300 border-slate-500/30',
  en_attente:     'bg-blue-500/20 text-blue-300 border-blue-500/30',
  approuve:       'bg-amber-500/20 text-amber-300 border-amber-500/30',
  envoye:         'bg-purple-500/20 text-purple-300 border-purple-500/30',
  contrat_signe:  'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  depot_paye:     'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  planifie:       'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  complete:       'bg-green-500/20 text-green-300 border-green-500/30',
  refuse:         'bg-red-500/20 text-red-300 border-red-500/30',
};

const LABEL: Record<QuoteStatut, string> = {
  brouillon:      'Brouillon',
  en_attente:     'En attente',
  approuve:       'Approuvé',
  envoye:         'Envoyé',
  contrat_signe:  'Contrat signé',
  depot_paye:     'Dépôt payé',
  planifie:       'Planifié',
  complete:       'Complété',
  refuse:         'Refusé',
};

const SERVICE_LABEL: Record<string, string> = {
  flake: 'Flocon',
  metallique: 'Métallique',
  couleur_unie: 'Couleur unie',
  quartz: 'Quartz',
  antiderapant: 'Antidérapant',
  commercial: 'Commercial',
  meulage: 'Meulage diamant',
};

const PROTECTED_STATUTS: QuoteStatut[] = ['depot_paye', 'planifie', 'complete'];

function QuoteRow({ q, onUpdate }: { q: Quote; onUpdate: () => void }) {
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleStatut(statut: QuoteStatut) {
    setLoading(true);
    await updateQuote(q.id, { statut });
    onUpdate();
    setLoading(false);
  }

  async function handleDelete() {
    if (!confirm(`Supprimer le devis #${q.id} de ${q.client_nom}?\n\nCette action est irréversible.`)) return;
    setDeleting(true);
    try {
      await deleteQuote(q.id);
      onUpdate();
    } catch {
      alert('Impossible de supprimer ce devis.');
      setDeleting(false);
    }
  }

  const canDelete = !PROTECTED_STATUTS.includes(q.statut);

  return (
    <tr className={`border-b border-slate-700 hover:bg-slate-700/50 transition ${deleting ? 'opacity-40' : ''}`}>
      <td className="px-4 py-3">
        <Link href={`/dashboard/devis/${q.id}`} className="text-amber-400 hover:text-amber-300 text-sm font-bold">
          #{q.id}
        </Link>
      </td>
      <td className="px-4 py-3">
        <Link href={`/dashboard/devis/${q.id}`} className="hover:underline">
          <p className="text-white text-sm font-medium">{q.client_nom}</p>
          <p className="text-slate-400 text-xs">{q.client_email}</p>
        </Link>
      </td>
      <td className="px-4 py-3 text-slate-300 text-sm">{SERVICE_LABEL[q.type_service] ?? q.type_service}</td>
      <td className="px-4 py-3 text-slate-300 text-sm">{q.superficie} pi²</td>
      <td className="px-4 py-3 text-white text-sm font-medium">{formatMoney(Number(q.total))}</td>
      <td className="px-4 py-3">
        <select
          value={q.statut}
          disabled={loading}
          onChange={e => handleStatut(e.target.value as QuoteStatut)}
          className={`text-xs font-medium px-2 py-1 rounded border bg-transparent cursor-pointer ${BADGE[q.statut]}`}
        >
          {STATUTS.map(st => (
            <option key={st} value={st} className="bg-slate-800 text-white">
              {LABEL[st]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{formatDate(q.created_at)}</td>
      <td className="px-2 py-3">
        {canDelete && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            title="Supprimer ce devis"
            className="text-slate-500 hover:text-red-400 transition p-1 rounded hover:bg-red-500/10"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </button>
        )}
      </td>
    </tr>
  );
}

function PageContent() {
  const [data, setData]     = useState<Quote[]>([]);
  const [total, setTotal]   = useState(0);
  const [page, setPage]     = useState(1);
  const [statut, setStatut] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    const res = await fetchQuotes({ page, limit: 25, statut: statut || undefined, search: search || undefined });
    setData(res.data);
    setTotal(res.total);
  }, [page, statut, search]);

  return (
    <PollingProvider onRefresh={load}>
      <div className="p-3 sm:p-6 space-y-4 sm:space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">Devis</h2>
          <div className="flex items-center gap-3">
            <span className="text-slate-400 text-sm">{total} au total</span>
            <Link
              href="/dashboard/devis/nouveau"
              className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold rounded-lg px-4 py-2 text-sm transition"
            >
              + Nouveau devis
            </Link>
          </div>
        </div>

        <div className="flex gap-3 flex-wrap">
          <input
            type="text"
            placeholder="Rechercher nom ou email..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 w-full sm:w-64"
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

        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-900/50">
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">#</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Client</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Service</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Superficie</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Total</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Statut</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Date</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr><td colSpan={8} className="text-center py-8 text-slate-500 text-sm">Aucun devis</td></tr>
              )}
              {data.map(q => <QuoteRow key={q.id} q={q} onUpdate={load} />)}
            </tbody>
          </table>
        </div>

        {total > 25 && (
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 bg-slate-700 rounded text-sm text-white disabled:opacity-40"
            >
              Précédent
            </button>
            <span className="px-3 py-1.5 text-slate-400 text-sm">
              Page {page} / {Math.ceil(total / 25)}
            </span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page >= Math.ceil(total / 25)}
              className="px-3 py-1.5 bg-slate-700 rounded text-sm text-white disabled:opacity-40"
            >
              Suivant
            </button>
          </div>
        )}
      </div>
    </PollingProvider>
  );
}

export default function DevisPage() {
  return <PageContent />;
}
