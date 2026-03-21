'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { formatMoney } from '@/lib/pricing';

interface QuoteOption {
  id: number;
  client_nom: string;
  client_email: string;
  type_service: string;
  superficie: number;
  total: number;
  statut: string;
}

const SERVICE_LABEL: Record<string, string> = {
  flake: 'Flocon',
  metallique: 'Metallique',
  commercial: 'Commercial',
};

export default function NouvelleFacturePage() {
  const router = useRouter();
  const [quotes, setQuotes]     = useState<QuoteOption[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [loading, setLoading]   = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError]       = useState('');

  useEffect(() => {
    fetch('/api/quotes?limit=100&statut=approuve')
      .then(r => r.json())
      .then(json => {
        // Also fetch envoye, contrat_signe and depot_paye quotes
        return Promise.all([
          json.data ?? [],
          fetch('/api/quotes?limit=100&statut=envoye').then(r => r.json()).then(j => j.data ?? []),
          fetch('/api/quotes?limit=100&statut=contrat_signe').then(r => r.json()).then(j => j.data ?? []),
        ]);
      })
      .then(([approuve, envoye, contratSigne]) => {
        setQuotes([...approuve, ...envoye, ...contratSigne]);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  async function handleCreate() {
    if (!selected) return;
    setCreating(true);
    setError('');

    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quote_id: selected }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Erreur lors de la creation');
        if (json.invoice_id) router.push(`/dashboard/factures/${json.invoice_id}`);
        setCreating(false);
        return;
      }
      router.push(`/dashboard/factures/${json.id}`);
    } catch {
      setError('Erreur lors de la creation');
      setCreating(false);
    }
  }

  const selectedQuote = quotes.find(q => q.id === selected);

  return (
    <div className="p-6 max-w-3xl">
      <button onClick={() => router.push('/dashboard/factures')} className="text-slate-400 hover:text-white text-sm mb-4 block transition">
        &larr; Retour aux factures
      </button>
      <h2 className="text-2xl font-bold text-white mb-6">Nouvelle facture</h2>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2 mb-4">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-4">
        <h3 className="text-white font-semibold text-sm uppercase tracking-wider">Selectionner un devis approuve</h3>

        {loading ? (
          <p className="text-slate-400 text-sm">Chargement des devis...</p>
        ) : quotes.length === 0 ? (
          <p className="text-slate-400 text-sm">Aucun devis approuve disponible. Approuvez un devis d'abord.</p>
        ) : (
          <div className="space-y-2">
            {quotes.map(q => (
              <button
                key={q.id}
                onClick={() => setSelected(q.id)}
                className={`w-full text-left p-4 rounded-lg border transition ${
                  selected === q.id
                    ? 'border-amber-500 bg-amber-500/10'
                    : 'border-slate-600 bg-slate-700 hover:border-slate-500'
                }`}
              >
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-white font-medium">{q.client_nom}</p>
                    <p className="text-slate-400 text-xs">{q.client_email}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-white font-semibold">{formatMoney(Number(q.total))}</p>
                    <p className="text-slate-400 text-xs">{SERVICE_LABEL[q.type_service]} — {q.superficie} pi²</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedQuote && (
        <div className="bg-slate-800 border border-amber-500/30 rounded-xl p-6 mt-6">
          <h3 className="text-amber-400 font-semibold text-sm uppercase tracking-wider mb-4">Apercu de la facture</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-slate-300">
              <span>Client</span>
              <span className="text-white font-medium">{selectedQuote.client_nom}</span>
            </div>
            <div className="flex justify-between text-slate-300">
              <span>Service</span>
              <span>{SERVICE_LABEL[selectedQuote.type_service]} — {selectedQuote.superficie} pi²</span>
            </div>
            <div className="flex justify-between text-white font-bold text-lg pt-2 border-t border-slate-700">
              <span>Total</span>
              <span>{formatMoney(Number(selectedQuote.total))}</span>
            </div>
            <div className="flex justify-between text-amber-400 font-medium">
              <span>Depot 30%</span>
              <span>{formatMoney(Number(selectedQuote.total) * 0.3)}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Solde 70%</span>
              <span>{formatMoney(Number(selectedQuote.total) * 0.7)}</span>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-3 mt-6">
        <button
          onClick={handleCreate}
          disabled={!selected || creating}
          className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 font-semibold rounded-lg px-6 py-2.5 text-sm transition"
        >
          {creating ? 'Creation...' : 'Creer la facture'}
        </button>
        <button
          onClick={() => router.back()}
          className="bg-slate-700 hover:bg-slate-600 text-white rounded-lg px-6 py-2.5 text-sm transition"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}
