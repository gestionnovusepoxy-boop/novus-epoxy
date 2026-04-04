'use client';

import { useState, useCallback, useRef } from 'react';
import { PollingProvider } from '@/components/polling-provider';
import { formatDate } from '@/lib/utils';
import { formatMoney } from '@/lib/pricing';

const CATEGORIES = ['materiaux', 'sous_traitance', 'transport', 'equipement', 'marketing', 'loyer', 'assurance', 'admin', 'autre'] as const;
const CAT_LABEL: Record<string, string> = {
  materiaux: 'Materiaux', sous_traitance: 'Sous-traitance', transport: 'Transport',
  equipement: 'Equipement', marketing: 'Marketing', loyer: 'Loyer',
  assurance: 'Assurance', admin: 'Administration', autre: 'Autre',
};
const METHODES = ['virement', 'cheque', 'comptant', 'carte', 'autre'] as const;
const METHODE_LABEL: Record<string, string> = { virement: 'Virement', cheque: 'Cheque', comptant: 'Comptant', carte: 'Carte', autre: 'Autre' };

const TPS_RATE = 0.05;
const TVQ_RATE = 0.09975;

interface Expense {
  id: number; date_depense: string; fournisseur: string; description: string | null;
  categorie: string; montant_ht: number; tps: number; tvq: number; montant_ttc: number;
  methode: string | null; reconciled: boolean; created_at: string; receipt_url: string | null;
  quote_id: number | null; notes: string | null;
}

interface ScanResult {
  file: string;
  data?: {
    fournisseur?: string; date_depense?: string; description?: string;
    montant_ht?: number; tps?: number; tvq?: number; montant_ttc?: number;
    categorie?: string; reference?: string | null;
  };
  error?: string;
  duplicate?: boolean;
  saved?: boolean;
  saving?: boolean;
}

interface RecurringExpense {
  id: number; fournisseur: string; description: string | null;
  categorie: string; montant_ht: number; tps: number; tvq: number; montant_ttc: number;
  methode: string | null; frequence: string; jour_du_mois: number;
  actif: boolean; derniere_creation: string | null;
}

const FREQ_LABEL: Record<string, string> = { mensuel: 'Mensuel', hebdomadaire: 'Hebdomadaire', annuel: 'Annuel' };

function PageContent() {
  const [data, setData]       = useState<Expense[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [categorie, setCat]   = useState('');
  const [search, setSearch]   = useState('');
  const [viewingReceipt, setViewingReceipt] = useState<{ url: string; fournisseur: string } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState('');
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const scanRef = useRef<HTMLInputElement>(null);
  const [showRecurring, setShowRecurring] = useState(false);
  const [recurring, setRecurring] = useState<RecurringExpense[]>([]);
  const [showRecForm, setShowRecForm] = useState(false);
  const [recForm, setRecForm] = useState({
    fournisseur: '', description: '', categorie: 'loyer',
    montant_ht: '', taxable: true, methode: 'virement',
    frequence: 'mensuel', jour_du_mois: '1',
  });

  const recHt = parseFloat(recForm.montant_ht) || 0;
  const recTps = recForm.taxable ? Math.round(recHt * TPS_RATE * 100) / 100 : 0;
  const recTvq = recForm.taxable ? Math.round(recHt * TVQ_RATE * 100) / 100 : 0;
  const recTtc = Math.round((recHt + recTps + recTvq) * 100) / 100;

  async function loadRecurring() {
    const res = await fetch('/api/expenses/recurring');
    if (res.ok) setRecurring(await res.json());
  }

  async function handleRecSubmit(e: React.FormEvent) {
    e.preventDefault();
    await fetch('/api/expenses/recurring', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fournisseur: recForm.fournisseur, description: recForm.description || null,
        categorie: recForm.categorie, montant_ht: recHt, tps: recTps, tvq: recTvq,
        methode: recForm.methode, frequence: recForm.frequence,
        jour_du_mois: parseInt(recForm.jour_du_mois) || 1,
      }),
    });
    setRecForm({ fournisseur: '', description: '', categorie: 'loyer', montant_ht: '', taxable: true, methode: 'virement', frequence: 'mensuel', jour_du_mois: '1' });
    setShowRecForm(false);
    loadRecurring();
  }

  async function toggleRecurring(id: number, actif: boolean) {
    await fetch(`/api/expenses/recurring/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actif }),
    });
    loadRecurring();
  }

  async function deleteRecurring(id: number) {
    if (!window.confirm('Supprimer cette depense recurrente?')) return;
    await fetch(`/api/expenses/recurring/${id}`, { method: 'DELETE' });
    loadRecurring();
  }

  // Form state
  const [form, setForm] = useState({
    date_depense: new Date().toISOString().slice(0, 10),
    fournisseur: '', description: '', categorie: 'materiaux',
    montant_ht: '', taxable: true, methode: 'carte', reference: '',
  });

  const ht = parseFloat(form.montant_ht) || 0;
  const tpsCalc = form.taxable ? Math.round(ht * TPS_RATE * 100) / 100 : 0;
  const tvqCalc = form.taxable ? Math.round(ht * TVQ_RATE * 100) / 100 : 0;
  const ttcCalc = Math.round((ht + tpsCalc + tvqCalc) * 100) / 100;

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ page: String(page), limit: '25' });
    if (categorie) qs.set('categorie', categorie);
    if (search) qs.set('search', search);
    const res = await fetch(`/api/expenses?${qs}`);
    const json = await res.json();
    setData(json.data ?? []);
    setTotal(json.total ?? 0);
    loadRecurring();
  }, [page, categorie, search]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await fetch('/api/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date_depense: form.date_depense, fournisseur: form.fournisseur,
        description: form.description || null, categorie: form.categorie,
        montant_ht: ht, tps: tpsCalc, tvq: tvqCalc,
        methode: form.methode, reference: form.reference || null,
      }),
    });
    setForm({ date_depense: new Date().toISOString().slice(0, 10), fournisseur: '', description: '', categorie: 'materiaux', montant_ht: '', taxable: true, methode: 'carte', reference: '' });
    setShowForm(false);
    load();
  }

  async function handleDelete(id: number) {
    if (!window.confirm('Supprimer cette dépense?')) return;
    await fetch(`/api/expenses/${id}`, { method: 'DELETE' });
    load();
  }

  async function handleScan(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setScanning(true);
    setScanResults([]);
    setScanProgress(`Analyse de ${files.length} recu${files.length > 1 ? 's' : ''} en cours...`);

    const fd = new FormData();
    for (let i = 0; i < files.length; i++) {
      fd.append('photos', files[i]);
    }

    try {
      const res = await fetch('/api/expenses/scan', { method: 'POST', body: fd });
      const json = await res.json();

      if (!res.ok) {
        setScanProgress(json.error || 'Erreur lors du scan');
        setScanning(false);
        return;
      }

      const results: ScanResult[] = json.results ?? [];
      setScanResults(results);

      const ok = results.filter(r => r.data && !r.error).length;
      const dups = results.filter(r => r.duplicate).length;
      const errs = results.filter(r => r.error).length;
      let msg = `${ok} recu${ok > 1 ? 's' : ''} analyse${ok > 1 ? 's' : ''}`;
      if (dups > 0) msg += ` — ${dups} doublon${dups > 1 ? 's' : ''} detecte${dups > 1 ? 's' : ''}`;
      if (errs > 0) msg += ` — ${errs} erreur${errs > 1 ? 's' : ''}`;
      setScanProgress(msg);
    } catch {
      setScanProgress('Erreur de connexion');
    }
    setScanning(false);
    if (scanRef.current) scanRef.current.value = '';
  }

  async function saveScanResult(index: number) {
    const r = scanResults[index];
    if (!r.data) return;

    setScanResults(prev => prev.map((item, i) => i === index ? { ...item, saving: true } : item));

    const d = r.data;
    const montantHt = d.montant_ht ?? 0;
    const tps = d.tps ?? 0;
    const tvq = d.tvq ?? 0;

    await fetch('/api/expenses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date_depense: d.date_depense || new Date().toISOString().slice(0, 10),
        fournisseur: d.fournisseur || 'Inconnu',
        description: d.description || null,
        categorie: (CATEGORIES as readonly string[]).includes(d.categorie ?? '') ? d.categorie : 'autre',
        montant_ht: montantHt, tps, tvq,
        methode: 'carte', reference: d.reference || null,
      }),
    });

    setScanResults(prev => prev.map((item, i) => i === index ? { ...item, saved: true, saving: false } : item));
    load();
  }

  async function saveAllScanResults() {
    const toSave = scanResults
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.data && !r.error && !r.duplicate && !r.saved);

    for (const { i } of toSave) {
      await saveScanResult(i);
    }
  }

  return (
    <PollingProvider onRefresh={load}>
      <div className="p-3 sm:p-6 space-y-4 sm:space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h2 className="text-xl sm:text-2xl font-bold text-white">Depenses</h2>
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <span className="text-slate-400 text-sm">{total} au total</span>
            <label className={`${scanning ? 'bg-purple-400' : 'bg-purple-500 hover:bg-purple-400'} text-white font-semibold rounded-lg px-4 py-2 text-sm transition cursor-pointer`}>
              {scanning ? 'Analyse...' : 'Scanner des recus'}
              <input type="file" accept="image/*" multiple ref={scanRef} onChange={handleScan} className="hidden" disabled={scanning} />
            </label>
            <button onClick={() => setShowForm(!showForm)}
              className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold rounded-lg px-4 py-2 text-sm transition">
              {showForm ? 'Fermer' : '+ Nouvelle depense'}
            </button>
          </div>
        </div>

        {/* Scan progress */}
        {scanProgress && (
          <div className={`border rounded-lg px-4 py-2 ${scanning ? 'bg-purple-500/10 border-purple-500/30' : 'bg-blue-500/10 border-blue-500/30'}`}>
            <p className={`text-sm ${scanning ? 'text-purple-400' : 'text-blue-400'}`}>{scanProgress}</p>
          </div>
        )}

        {/* Scan results review */}
        {scanResults.length > 0 && (
          <div className="bg-slate-800 border border-purple-500/30 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-semibold">Recus scannes — verifiez et enregistrez</h3>
              {scanResults.some(r => r.data && !r.error && !r.duplicate && !r.saved) && (
                <button onClick={saveAllScanResults}
                  className="bg-green-500 hover:bg-green-400 text-white font-semibold rounded-lg px-4 py-2 text-sm transition">
                  Tout enregistrer
                </button>
              )}
            </div>
            <div className="space-y-3">
              {scanResults.map((r, idx) => (
                <div key={idx} className={`border rounded-lg p-4 ${
                  r.saved ? 'border-green-500/30 bg-green-500/5' :
                  r.duplicate ? 'border-yellow-500/30 bg-yellow-500/5' :
                  r.error ? 'border-red-500/30 bg-red-500/5' :
                  'border-slate-600 bg-slate-700/50'
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <span className="text-slate-400 text-xs shrink-0">{r.file}</span>
                      {r.error && <span className="text-red-400 text-sm">{r.error}</span>}
                      {r.data && (
                        <>
                          <span className="text-white font-medium text-sm truncate">{r.data.fournisseur}</span>
                          <span className="text-slate-400 text-sm">{r.data.date_depense}</span>
                          <span className="text-slate-300 text-xs truncate">{r.data.description}</span>
                          <span className="text-amber-400 text-sm font-medium shrink-0">
                            {formatMoney(r.data.montant_ttc ?? 0)}
                          </span>
                          <span className="text-slate-500 text-xs shrink-0">
                            {CAT_LABEL[(r.data.categorie ?? 'autre')] ?? r.data.categorie}
                          </span>
                          {r.data.tps != null && r.data.tps > 0 && (
                            <span className="text-slate-500 text-xs shrink-0">
                              TPS {formatMoney(r.data.tps)} + TVQ {formatMoney(r.data.tvq ?? 0)}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      {r.duplicate && !r.saved && (
                        <span className="text-yellow-400 text-xs font-medium px-2 py-1 bg-yellow-500/20 rounded">Doublon</span>
                      )}
                      {r.saved ? (
                        <span className="text-green-400 text-xs font-medium px-2 py-1 bg-green-500/20 rounded">Enregistre</span>
                      ) : r.data && !r.error ? (
                        <button onClick={() => saveScanResult(idx)} disabled={r.saving}
                          className={`text-sm font-medium px-3 py-1.5 rounded transition ${
                            r.duplicate
                              ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30'
                              : 'bg-green-500 hover:bg-green-400 text-white'
                          } disabled:opacity-50`}>
                          {r.saving ? '...' : r.duplicate ? 'Forcer' : 'Enregistrer'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => { setScanResults([]); setScanProgress(''); }}
              className="text-slate-400 hover:text-white text-sm transition">
              Fermer les resultats
            </button>
          </div>
        )}

        {/* Form */}
        {showForm && (
          <form onSubmit={handleSubmit} className="bg-slate-800 border border-slate-700 rounded-xl p-3 sm:p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Date *</label>
                <input type="date" required value={form.date_depense} onChange={e => setForm({ ...form, date_depense: e.target.value })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500" />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Fournisseur *</label>
                <input required value={form.fournisseur} onChange={e => setForm({ ...form, fournisseur: e.target.value })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500" />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Categorie *</label>
                <select value={form.categorie} onChange={e => setForm({ ...form, categorie: e.target.value })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500">
                  {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Methode</label>
                <select value={form.methode} onChange={e => setForm({ ...form, methode: e.target.value })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500">
                  {METHODES.map(m => <option key={m} value={m}>{METHODE_LABEL[m]}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Montant HT *</label>
                <input type="number" step="0.01" min="0" required value={form.montant_ht}
                  onChange={e => setForm({ ...form, montant_ht: e.target.value })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500" />
              </div>
              <div className="flex items-end gap-2 pb-1">
                <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={form.taxable} onChange={e => setForm({ ...form, taxable: e.target.checked })}
                    className="rounded" />
                  Taxable
                </label>
                {form.taxable && ht > 0 && (
                  <span className="text-slate-500 text-xs">TPS {formatMoney(tpsCalc)} + TVQ {formatMoney(tvqCalc)}</span>
                )}
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Total TTC</label>
                <p className="text-white font-bold text-lg py-2">{formatMoney(ttcCalc)}</p>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Reference</label>
                <input value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })}
                  placeholder="No. facture fournisseur"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500" />
              </div>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Description</label>
              <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500" />
            </div>
            <button type="submit" className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold rounded-lg px-6 py-2.5 text-sm transition">
              Ajouter la depense
            </button>
          </form>
        )}

        {/* Recurring Expenses */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <button onClick={() => setShowRecurring(!showRecurring)}
            className="flex items-center justify-between w-full">
            <div className="flex items-center gap-3">
              <span className="text-lg">🔄</span>
              <span className="text-white font-semibold">Depenses recurrentes</span>
              <span className="text-slate-400 text-sm">{recurring.filter(r => r.actif).length} actives</span>
            </div>
            <span className="text-slate-400">{showRecurring ? '▲' : '▼'}</span>
          </button>

          {showRecurring && (
            <div className="mt-4 space-y-3">
              {recurring.map(r => (
                <div key={r.id} className={`flex items-center justify-between border rounded-lg px-4 py-3 ${r.actif ? 'border-slate-600 bg-slate-700/30' : 'border-slate-700 bg-slate-800/50 opacity-60'}`}>
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <span className="text-white font-medium text-sm truncate">{r.fournisseur}</span>
                    {r.description && <span className="text-slate-400 text-xs truncate">{r.description}</span>}
                    <span className="text-slate-500 text-xs">{CAT_LABEL[r.categorie]}</span>
                    <span className="text-amber-400 text-sm font-medium">{formatMoney(Number(r.montant_ttc))}</span>
                    <span className="text-slate-400 text-xs">{FREQ_LABEL[r.frequence]} — jour {r.jour_du_mois}</span>
                  </div>
                  <div className="flex items-center gap-2 ml-3">
                    <button onClick={() => toggleRecurring(r.id, !r.actif)}
                      className={`text-xs px-2 py-1 rounded ${r.actif ? 'bg-green-500/20 text-green-400' : 'bg-slate-600 text-slate-400'}`}>
                      {r.actif ? 'Actif' : 'Pause'}
                    </button>
                    <button onClick={() => deleteRecurring(r.id)} className="text-red-400 hover:text-red-300 text-xs">✕</button>
                  </div>
                </div>
              ))}

              {!showRecForm ? (
                <button onClick={() => setShowRecForm(true)}
                  className="text-amber-400 hover:text-amber-300 text-sm font-medium">+ Ajouter une depense recurrente</button>
              ) : (
                <form onSubmit={handleRecSubmit} className="border border-slate-600 rounded-lg p-4 space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Fournisseur *</label>
                      <input required value={recForm.fournisseur} onChange={e => setRecForm({ ...recForm, fournisseur: e.target.value })}
                        placeholder="Ex: Hydro-Quebec" className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Categorie *</label>
                      <select value={recForm.categorie} onChange={e => setRecForm({ ...recForm, categorie: e.target.value })}
                        className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500">
                        {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Montant HT *</label>
                      <input type="number" step="0.01" min="0" required value={recForm.montant_ht}
                        onChange={e => setRecForm({ ...recForm, montant_ht: e.target.value })}
                        className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Total TTC</label>
                      <p className="text-white font-bold text-sm py-2">{formatMoney(recTtc)}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Frequence</label>
                      <select value={recForm.frequence} onChange={e => setRecForm({ ...recForm, frequence: e.target.value })}
                        className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500">
                        <option value="mensuel">Mensuel</option>
                        <option value="hebdomadaire">Hebdomadaire</option>
                        <option value="annuel">Annuel</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Jour du mois</label>
                      <input type="number" min="1" max="28" value={recForm.jour_du_mois}
                        onChange={e => setRecForm({ ...recForm, jour_du_mois: e.target.value })}
                        className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">Methode</label>
                      <select value={recForm.methode} onChange={e => setRecForm({ ...recForm, methode: e.target.value })}
                        className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500">
                        {METHODES.map(m => <option key={m} value={m}>{METHODE_LABEL[m]}</option>)}
                      </select>
                    </div>
                    <div className="flex items-end gap-2 pb-1">
                      <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                        <input type="checkbox" checked={recForm.taxable} onChange={e => setRecForm({ ...recForm, taxable: e.target.checked })} className="rounded" />
                        Taxable
                      </label>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Description</label>
                    <input value={recForm.description} onChange={e => setRecForm({ ...recForm, description: e.target.value })}
                      className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500" />
                  </div>
                  <div className="flex gap-2">
                    <button type="submit" className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold rounded-lg px-4 py-2 text-sm transition">Ajouter</button>
                    <button type="button" onClick={() => setShowRecForm(false)} className="text-slate-400 hover:text-white text-sm">Annuler</button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="flex gap-2 sm:gap-3 flex-wrap">
          <input type="text" placeholder="Rechercher fournisseur..." value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 w-full sm:w-64" />
          <select value={categorie} onChange={e => { setCat(e.target.value); setPage(1); }}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500">
            <option value="">Toutes les categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
          </select>
        </div>

        {/* Table */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-900/50">
                <th className="text-left px-2 sm:px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Date</th>
                <th className="text-left px-2 sm:px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Fournisseur</th>
                <th className="text-left px-2 sm:px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Categorie</th>
                <th className="text-left px-2 sm:px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">HT</th>
                <th className="text-left px-2 sm:px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">TTC</th>
                <th className="text-left px-2 sm:px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Reconcilie</th>
                <th className="text-left px-2 sm:px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider"></th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr><td colSpan={7} className="text-center py-8 text-slate-500 text-sm">Aucune depense</td></tr>
              )}
              {data.map(exp => (
                <tr key={exp.id} className="border-b border-slate-700 hover:bg-slate-700/50 transition">
                  <td className="px-2 sm:px-4 py-3 text-slate-300 text-xs sm:text-sm whitespace-nowrap">{formatDate(exp.date_depense)}</td>
                  <td className="px-2 sm:px-4 py-3">
                    <div className="flex items-center gap-2">
                      {exp.receipt_url && (
                        <button
                          onClick={() => setViewingReceipt({ url: exp.receipt_url!, fournisseur: exp.fournisseur })}
                          className="flex-shrink-0 w-8 h-8 rounded bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 hover:bg-amber-500/30 transition"
                          title="Voir la facture"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        </button>
                      )}
                      <div>
                        <div className="flex items-center gap-1.5">
                          <p className="text-white text-xs sm:text-sm font-medium">{exp.fournisseur}</p>
                          {exp.quote_id && (
                            <a href={`/dashboard/travaux?projet=${exp.quote_id}`} className="text-[10px] bg-blue-500/20 text-blue-400 border border-blue-500/30 px-1.5 py-0.5 rounded hover:bg-blue-500/30 transition">
                              Projet #{exp.quote_id}
                            </a>
                          )}
                        </div>
                        {exp.description && <p className="text-slate-400 text-xs">{exp.description}</p>}
                        {exp.notes && <p className="text-amber-400/70 text-[10px] italic mt-0.5">{exp.notes}</p>}
                        <button
                          onClick={() => {
                            const note = prompt('Note interne (pas envoyee au comptable):', exp.notes || '');
                            if (note !== null) {
                              fetch('/api/expenses', {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ id: exp.id, notes: note }),
                              }).then(() => load());
                            }
                          }}
                          className="text-[10px] text-slate-600 hover:text-slate-400 transition mt-0.5"
                        >
                          {exp.notes ? 'Modifier note' : '+ Note'}
                        </button>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 sm:px-4 py-3 text-slate-300 text-xs sm:text-sm">{CAT_LABEL[exp.categorie]}</td>
                  <td className="px-2 sm:px-4 py-3 text-slate-300 text-xs sm:text-sm">{formatMoney(Number(exp.montant_ht))}</td>
                  <td className="px-2 sm:px-4 py-3 text-white text-xs sm:text-sm font-medium">{formatMoney(Number(exp.montant_ttc))}</td>
                  <td className="px-2 sm:px-4 py-3">
                    <span className={`text-xs ${exp.reconciled ? 'text-green-400' : 'text-slate-500'}`}>
                      {exp.reconciled ? 'Oui' : 'Non'}
                    </span>
                  </td>
                  <td className="px-2 sm:px-4 py-3">
                    <button onClick={() => handleDelete(exp.id)} className="text-red-400 hover:text-red-300 text-xs">Supprimer</button>
                  </td>
                </tr>
              ))}
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
        {/* Receipt Photo Viewer Modal */}
        {viewingReceipt && (
          <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setViewingReceipt(null)}>
            <div className="relative max-w-3xl w-full max-h-[90vh] flex flex-col items-center" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between w-full mb-3">
                <h3 className="text-white font-bold text-lg">Facture — {viewingReceipt.fournisseur}</h3>
                <button
                  onClick={() => setViewingReceipt(null)}
                  className="w-10 h-10 bg-slate-800 hover:bg-slate-700 text-white rounded-full flex items-center justify-center text-xl transition"
                >
                  &times;
                </button>
              </div>
              <img
                src={viewingReceipt.url}
                alt={`Facture ${viewingReceipt.fournisseur}`}
                className="max-h-[80vh] w-auto rounded-xl border border-slate-700 object-contain"
              />
            </div>
          </div>
        )}
      </div>
    </PollingProvider>
  );
}

export default function DepensesPage() {
  return <PageContent />;
}
