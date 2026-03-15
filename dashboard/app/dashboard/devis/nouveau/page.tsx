'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createQuote, type ServiceType } from '@/lib/api';
import { SERVICES, calculateQuote, formatMoney } from '@/lib/pricing';

export default function NouveauDevisPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  const [form, setForm] = useState({
    client_nom: '',
    client_email: '',
    client_tel: '',
    client_adresse: '',
    type_service: 'flake' as ServiceType,
    superficie: '',
    etat_plancher: '',
    notes: '',
  });

  const sup = parseFloat(form.superficie) || 0;
  const preview = sup > 0 ? calculateQuote(form.type_service, sup) : null;

  function update(field: string, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const quote = await createQuote({
        client_nom: form.client_nom,
        client_email: form.client_email,
        client_tel: form.client_tel || undefined,
        client_adresse: form.client_adresse || undefined,
        type_service: form.type_service,
        superficie: sup,
        etat_plancher: form.etat_plancher || undefined,
        notes: form.notes || undefined,
      });
      router.push(`/dashboard/devis/${quote.id}`);
    } catch {
      setError('Erreur lors de la creation du devis');
      setLoading(false);
    }
  }

  return (
    <div className="p-6 max-w-3xl">
      <h2 className="text-2xl font-bold text-white mb-6">Nouveau devis</h2>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2 mb-4">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Client */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-4">
          <h3 className="text-white font-semibold text-sm uppercase tracking-wider">Client</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Nom *</label>
              <input
                required value={form.client_nom} onChange={e => update('client_nom', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Courriel *</label>
              <input
                type="email" required value={form.client_email} onChange={e => update('client_email', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Telephone</label>
              <input
                type="tel" value={form.client_tel} onChange={e => update('client_tel', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Adresse</label>
              <input
                value={form.client_adresse} onChange={e => update('client_adresse', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>
        </div>

        {/* Projet */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 space-y-4">
          <h3 className="text-white font-semibold text-sm uppercase tracking-wider">Projet</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Type de service *</label>
              <select
                value={form.type_service} onChange={e => update('type_service', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500"
              >
                {Object.entries(SERVICES).map(([key, { label, prix }]) => (
                  <option key={key} value={key}>{label} — {formatMoney(prix)}/pi²</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Superficie (pi²) *</label>
              <input
                type="number" min="1" step="0.01" required
                value={form.superficie} onChange={e => update('superficie', e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Etat du plancher</label>
            <input
              value={form.etat_plancher} onChange={e => update('etat_plancher', e.target.value)}
              placeholder="Ex: Beton brut, peinture existante..."
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">Notes</label>
            <textarea
              rows={3} value={form.notes} onChange={e => update('notes', e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500 resize-none"
            />
          </div>
        </div>

        {/* Preview prix */}
        {preview && (
          <div className="bg-slate-800 border border-amber-500/30 rounded-xl p-6">
            <h3 className="text-amber-400 font-semibold text-sm uppercase tracking-wider mb-4">Apercu du prix</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-slate-300">
                <span>{SERVICES[form.type_service].label} x {sup} pi²</span>
                <span>{formatMoney(preview.sous_total)}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>TPS (5%)</span>
                <span>{formatMoney(preview.tps)}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>TVQ (9,975%)</span>
                <span>{formatMoney(preview.tvq)}</span>
              </div>
              <div className="flex justify-between text-white font-bold text-lg pt-2 border-t border-slate-700">
                <span>Total</span>
                <span>{formatMoney(preview.total)}</span>
              </div>
              <div className="flex justify-between text-amber-400 font-medium">
                <span>Depot requis (30%)</span>
                <span>{formatMoney(preview.depot_requis)}</span>
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="submit" disabled={loading}
            className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 font-semibold rounded-lg px-6 py-2.5 text-sm transition"
          >
            {loading ? 'Creation...' : 'Creer le devis'}
          </button>
          <button
            type="button" onClick={() => router.back()}
            className="bg-slate-700 hover:bg-slate-600 text-white rounded-lg px-6 py-2.5 text-sm transition"
          >
            Annuler
          </button>
        </div>
      </form>
    </div>
  );
}
