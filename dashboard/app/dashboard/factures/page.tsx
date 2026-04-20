'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { PollingProvider } from '@/components/polling-provider';
import { formatDate } from '@/lib/utils';
import { formatMoney } from '@/lib/pricing';

type InvoiceStatut = 'brouillon' | 'envoyee' | 'depot_recu' | 'travaux_en_cours' | 'completee' | 'annulee';

interface InvoiceRow {
  id: number;
  numero: string;
  client_nom: string;
  client_email: string;
  type_service: string;
  total: number;
  depot_montant: number;
  depot_paye: boolean;
  final_montant: number;
  final_paye: boolean;
  statut: InvoiceStatut;
  created_at: string;
}

const STATUTS: InvoiceStatut[] = ['brouillon', 'envoyee', 'depot_recu', 'travaux_en_cours', 'completee', 'annulee'];

const BADGE: Record<InvoiceStatut, string> = {
  brouillon:        'bg-slate-500/20 text-slate-300 border-slate-500/30',
  envoyee:          'bg-blue-500/20 text-blue-300 border-blue-500/30',
  depot_recu:       'bg-amber-500/20 text-amber-300 border-amber-500/30',
  travaux_en_cours: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  completee:        'bg-green-500/20 text-green-300 border-green-500/30',
  annulee:          'bg-red-500/20 text-red-300 border-red-500/30',
};

const LABEL: Record<InvoiceStatut, string> = {
  brouillon:        'Brouillon',
  envoyee:          'Envoyée',
  depot_recu:       'Dépôt reçu',
  travaux_en_cours: 'Travaux en cours',
  completee:        'Complétée',
  annulee:          'Annulée',
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

function InvoiceRow({ inv }: { inv: InvoiceRow }) {
  return (
    <tr className="border-b border-slate-700 hover:bg-slate-700/50 transition">
      <td className="px-4 py-3">
        <Link href={`/dashboard/factures/${inv.id}`} className="text-amber-400 hover:underline font-mono text-sm font-medium">
          {inv.numero}
        </Link>
      </td>
      <td className="px-4 py-3">
        <p className="text-white text-sm font-medium">{inv.client_nom}</p>
        <p className="text-slate-400 text-xs">{inv.client_email}</p>
      </td>
      <td className="px-4 py-3 text-slate-300 text-sm">{SERVICE_LABEL[inv.type_service] ?? inv.type_service}</td>
      <td className="px-4 py-3 text-white text-sm font-medium">{formatMoney(Number(inv.total))}</td>
      <td className="px-4 py-3">
        <div className="text-xs">
          <span className={inv.depot_paye ? 'text-green-400' : 'text-red-400'}>
            {inv.depot_paye ? '30% recu' : '30% en attente'}
          </span>
          <br/>
          <span className={inv.final_paye ? 'text-green-400' : 'text-slate-500'}>
            {inv.final_paye ? '70% recu' : '70% restant'}
          </span>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={`text-xs font-medium px-2 py-1 rounded border ${BADGE[inv.statut]}`}>
          {LABEL[inv.statut]}
        </span>
      </td>
      <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{formatDate(inv.created_at)}</td>
    </tr>
  );
}

function PageContent() {
  const [data, setData]     = useState<InvoiceRow[]>([]);
  const [total, setTotal]   = useState(0);
  const [page, setPage]     = useState(1);
  const [statut, setStatut] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    qs.set('page', String(page));
    qs.set('limit', '25');
    if (statut) qs.set('statut', statut);
    if (search) qs.set('search', search);

    const res = await fetch(`/api/invoices?${qs}`);
    if (res.status === 401) { window.location.href = '/auth/signin'; return; }
    const json = await res.json();
    setData(json.data ?? []);
    setTotal(json.total ?? 0);
  }, [page, statut, search]);

  return (
    <PollingProvider onRefresh={load}>
      <div className="p-3 sm:p-6 space-y-4 sm:space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">Factures</h2>
          <div className="flex items-center gap-3">
            <span className="text-slate-400 text-sm">{total} au total</span>
            <Link
              href="/dashboard/factures/nouveau"
              className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold rounded-lg px-4 py-2 text-sm transition"
            >
              + Nouvelle facture
            </Link>
          </div>
        </div>

        <div className="flex gap-3 flex-wrap">
          <input
            type="text"
            placeholder="Rechercher client ou numero..."
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
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Numero</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Client</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Service</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Total</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Paiements</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Statut</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Date</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr><td colSpan={7} className="text-center py-8 text-slate-500 text-sm">Aucune facture</td></tr>
              )}
              {data.map(inv => <InvoiceRow key={inv.id} inv={inv} />)}
            </tbody>
          </table>
        </div>

        {total > 25 && (
          <div className="flex gap-2 justify-end">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-3 py-1.5 bg-slate-700 rounded text-sm text-white disabled:opacity-40">Précédent</button>
            <span className="px-3 py-1.5 text-slate-400 text-sm">Page {page} / {Math.ceil(total / 25)}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil(total / 25)}
              className="px-3 py-1.5 bg-slate-700 rounded text-sm text-white disabled:opacity-40">Suivant</button>
          </div>
        )}
      </div>
    </PollingProvider>
  );
}

export default function FacturesPage() {
  return <PageContent />;
}
