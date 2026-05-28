'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatDate } from '@/lib/utils';
import { formatMoney } from '@/lib/pricing';

interface Client {
  id: number; nom: string; email: string; telephone: string | null; adresse: string | null; notes: string | null; created_at: string;
}

interface Quote {
  id: number; type_service: string; superficie: number; total: number; statut: string; created_at: string;
}

interface Invoice {
  id: number; numero: string; total: number; statut: string; depot_paye: boolean; final_paye: boolean; created_at: string;
}

const SERVICE_LABEL: Record<string, string> = { flake: 'Flocon', metallique: 'Métallique', couleur_unie: 'Couleur unie', quartz: 'Quartz', antiderapant: 'Antidérapant', commercial: 'Commercial', meulage: 'Meulage diamant' };

export default function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [client, setClient]     = useState<Client | null>(null);
  const [quotes, setQuotes]     = useState<Quote[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    fetch(`/api/clients/${id}`)
      .then(r => r.json())
      .then(data => {
        setClient(data.client);
        setQuotes(data.quotes ?? []);
        setInvoices(data.invoices ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-6 text-slate-400">Chargement...</div>;
  if (!client) return <div className="p-6 text-red-400">Client introuvable</div>;

  const totalRevenue = invoices.filter(i => i.statut === 'completee').reduce((sum, i) => sum + Number(i.total), 0);

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <button onClick={() => router.push('/dashboard/clients')} className="text-slate-400 hover:text-white text-sm mb-2 block transition">
          &larr; Retour aux clients
        </button>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h2 className="text-2xl font-bold text-white">{client.nom}</h2>
          <Link
            href={`/dashboard/devis/nouveau?clientId=${client.id}`}
            className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold rounded-lg px-4 py-2 text-sm transition whitespace-nowrap"
          >
            + Nouveau devis
          </Link>
        </div>
      </div>

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><p className="text-slate-500">Courriel</p><p className="text-white">{client.email}</p></div>
          <div><p className="text-slate-500">Telephone</p><p className="text-white">{client.telephone ?? '—'}</p></div>
          <div><p className="text-slate-500">Adresse</p><p className="text-white">{client.adresse ?? '—'}</p></div>
          <div><p className="text-slate-500">Client depuis</p><p className="text-white">{formatDate(client.created_at)}</p></div>
        </div>
        {client.notes && <p className="text-slate-400 text-sm mt-4 pt-4 border-t border-slate-700">{client.notes}</p>}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-white">{quotes.length}</p>
          <p className="text-slate-400 text-xs">Devis</p>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-white">{invoices.length}</p>
          <p className="text-slate-400 text-xs">Factures</p>
        </div>
        <div className="bg-slate-800 border border-amber-500/30 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-amber-400">{formatMoney(totalRevenue)}</p>
          <p className="text-slate-400 text-xs">Revenue total</p>
        </div>
      </div>

      {/* Devis */}
      {quotes.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
          <h3 className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-4">Devis</h3>
          <div className="space-y-2">
            {quotes.map(q => (
              <Link key={q.id} href={`/dashboard/devis/${q.id}`}
                className="flex justify-between items-center p-3 rounded-lg hover:bg-slate-700 transition">
                <div>
                  <span className="text-white text-sm">{SERVICE_LABEL[q.type_service]} — {q.superficie} pi²</span>
                  <span className="text-slate-500 text-xs ml-2">{q.statut}</span>
                </div>
                <div className="text-right">
                  <span className="text-white font-medium text-sm">{formatMoney(Number(q.total))}</span>
                  <p className="text-slate-500 text-xs">{formatDate(q.created_at)}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Factures */}
      {invoices.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
          <h3 className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-4">Factures</h3>
          <div className="space-y-2">
            {invoices.map(inv => (
              <Link key={inv.id} href={`/dashboard/factures/${inv.id}`}
                className="flex justify-between items-center p-3 rounded-lg hover:bg-slate-700 transition">
                <div>
                  <span className="text-amber-400 font-mono text-sm">{inv.numero}</span>
                  <span className="text-slate-500 text-xs ml-2">{inv.statut}</span>
                </div>
                <div className="text-right">
                  <span className="text-white font-medium text-sm">{formatMoney(Number(inv.total))}</span>
                  <div className="text-xs">
                    <span className={inv.depot_paye ? 'text-green-400' : 'text-red-400'}>{inv.depot_paye ? '30%' : ''}</span>
                    {inv.final_paye && <span className="text-green-400 ml-1">70%</span>}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
