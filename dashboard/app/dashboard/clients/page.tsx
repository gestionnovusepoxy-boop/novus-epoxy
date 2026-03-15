'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { PollingProvider } from '@/components/polling-provider';
import { formatDate } from '@/lib/utils';
import { formatMoney } from '@/lib/pricing';

interface ClientRow {
  id: number;
  nom: string;
  email: string;
  telephone: string | null;
  nb_devis: number;
  nb_factures: number;
  revenue_total: number;
  created_at: string;
}

function PageContent() {
  const [data, setData]     = useState<ClientRow[]>([]);
  const [total, setTotal]   = useState(0);
  const [page, setPage]     = useState(1);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ page: String(page), limit: '25' });
    if (search) qs.set('search', search);
    const res = await fetch(`/api/clients?${qs}`);
    const json = await res.json();
    setData(json.data ?? []);
    setTotal(json.total ?? 0);
  }, [page, search]);

  return (
    <PollingProvider onRefresh={load}>
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">Clients</h2>
          <span className="text-slate-400 text-sm">{total} au total</span>
        </div>

        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Rechercher nom ou email..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 w-64"
          />
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-900/50">
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Client</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Telephone</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Devis</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Factures</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Revenue</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Depuis</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-slate-500 text-sm">Aucun client</td></tr>
              )}
              {data.map(c => (
                <tr key={c.id} className="border-b border-slate-700 hover:bg-slate-750 transition">
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/clients/${c.id}`} className="hover:underline">
                      <p className="text-white text-sm font-medium">{c.nom}</p>
                      <p className="text-slate-400 text-xs">{c.email}</p>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-300 text-sm">{c.telephone ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-300 text-sm">{c.nb_devis}</td>
                  <td className="px-4 py-3 text-slate-300 text-sm">{c.nb_factures}</td>
                  <td className="px-4 py-3 text-white text-sm font-medium">{formatMoney(Number(c.revenue_total))}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{formatDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {total > 25 && (
          <div className="flex gap-2 justify-end">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-3 py-1.5 bg-slate-700 rounded text-sm text-white disabled:opacity-40">Precedent</button>
            <span className="px-3 py-1.5 text-slate-400 text-sm">Page {page} / {Math.ceil(total / 25)}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil(total / 25)}
              className="px-3 py-1.5 bg-slate-700 rounded text-sm text-white disabled:opacity-40">Suivant</button>
          </div>
        )}
      </div>
    </PollingProvider>
  );
}

export default function ClientsPage() {
  return <PageContent />;
}
