'use client';

import { useState, useCallback, useRef } from 'react';
import { PollingProvider } from '@/components/polling-provider';
import { formatDate } from '@/lib/utils';
import { formatMoney } from '@/lib/pricing';

interface BankTx {
  id: number; date_tx: string; description: string; montant: number; type: 'debit' | 'credit';
  reconciled: boolean; invoice_numero: string | null; expense_fournisseur: string | null; notes: string | null;
}

function PageContent() {
  const [data, setData]     = useState<BankTx[]>([]);
  const [total, setTotal]   = useState(0);
  const [page, setPage]     = useState(1);
  const [filter, setFilter] = useState('');
  const [importing, setImporting] = useState(false);
  const [matching, setMatching]   = useState(false);
  const [msg, setMsg]             = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ page: String(page), limit: '50' });
    if (filter) qs.set('reconciled', filter);
    const res = await fetch(`/api/bank/transactions?${qs}`);
    const json = await res.json();
    setData(json.data ?? []);
    setTotal(json.total ?? 0);
  }, [page, filter]);

  async function handleImportCSV(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true); setMsg('');

    const text = await file.text();
    const lines = text.trim().split('\n');
    const transactions: { date_tx: string; description: string; montant: number; type: string }[] = [];

    // Parse CSV — supports common Canadian bank formats
    for (let idx = 1; idx < lines.length; idx++) {
      const cols = lines[idx].split(',').map(c => c.replace(/^"|"$/g, '').trim());
      if (cols.length < 3) continue;

      // Try to detect format: Date, Description, Amount OR Date, Description, Debit, Credit
      const dateStr = cols[0];
      const desc = cols[1];

      let montant = 0;
      let type: 'debit' | 'credit' = 'debit';

      if (cols.length >= 4 && (cols[2] || cols[3])) {
        // Format: Date, Desc, Debit, Credit
        const debit = parseFloat(cols[2].replace(/[^0-9.-]/g, '')) || 0;
        const credit = parseFloat(cols[3].replace(/[^0-9.-]/g, '')) || 0;
        if (credit > 0) { montant = credit; type = 'credit'; }
        else { montant = Math.abs(debit); type = 'debit'; }
      } else {
        // Format: Date, Desc, Amount (negative = debit)
        const val = parseFloat(cols[2].replace(/[^0-9.-]/g, '')) || 0;
        montant = Math.abs(val);
        type = val >= 0 ? 'credit' : 'debit';
      }

      if (!dateStr || !desc || montant === 0) continue;

      // Parse date (try YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY)
      let date_tx = dateStr;
      if (dateStr.includes('/')) {
        const parts = dateStr.split('/');
        if (parts[0].length === 4) date_tx = dateStr;
        else if (parseInt(parts[0]) > 12) date_tx = `${parts[2]}-${parts[1]}-${parts[0]}`;
        else date_tx = `${parts[2]}-${parts[0]}-${parts[1]}`;
      }

      transactions.push({ date_tx, description: desc, montant, type });
    }

    if (transactions.length === 0) {
      setMsg('Aucune transaction trouvee dans le fichier');
      setImporting(false);
      return;
    }

    const res = await fetch('/api/bank/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactions }),
    });
    const json = await res.json();
    setMsg(`${json.imported} transactions importees`);
    setImporting(false);
    if (fileRef.current) fileRef.current.value = '';
    load();
  }

  async function handleAutoMatch() {
    setMatching(true); setMsg('');
    const res = await fetch('/api/bank/auto-match', { method: 'POST' });
    const json = await res.json();
    setMsg(`${json.matched} transactions reconciliees automatiquement`);
    setMatching(false);
    load();
  }

  const totalCredits = data.filter(t => t.type === 'credit').reduce((s, t) => s + Number(t.montant), 0);
  const totalDebits = data.filter(t => t.type === 'debit').reduce((s, t) => s + Number(t.montant), 0);
  const nbReconciled = data.filter(t => t.reconciled).length;

  return (
    <PollingProvider onRefresh={load}>
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">Reconciliation bancaire</h2>
          <div className="flex items-center gap-3">
            <label className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold rounded-lg px-4 py-2 text-sm transition cursor-pointer">
              {importing ? 'Import...' : 'Importer CSV'}
              <input type="file" accept=".csv" ref={fileRef} onChange={handleImportCSV} className="hidden" />
            </label>
            <button onClick={handleAutoMatch} disabled={matching}
              className="bg-green-500 hover:bg-green-400 disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2 text-sm transition">
              {matching ? 'Matching...' : 'Auto-reconcilier'}
            </button>
          </div>
        </div>

        {msg && (
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg px-4 py-2">
            <p className="text-blue-400 text-sm">{msg}</p>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-white">{total}</p>
            <p className="text-slate-400 text-xs">Transactions</p>
          </div>
          <div className="bg-slate-800 border border-green-500/30 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-green-400">{formatMoney(totalCredits)}</p>
            <p className="text-slate-400 text-xs">Credits (entrees)</p>
          </div>
          <div className="bg-slate-800 border border-red-500/30 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-red-400">{formatMoney(totalDebits)}</p>
            <p className="text-slate-400 text-xs">Debits (sorties)</p>
          </div>
          <div className="bg-slate-800 border border-amber-500/30 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-amber-400">{nbReconciled}/{data.length}</p>
            <p className="text-slate-400 text-xs">Reconcilies</p>
          </div>
        </div>

        {/* Filter */}
        <div className="flex gap-3">
          <select value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500">
            <option value="">Toutes</option>
            <option value="false">Non reconciliees</option>
            <option value="true">Reconciliees</option>
          </select>
        </div>

        {/* Table */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-900/50">
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Date</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Description</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Montant</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Type</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Lie a</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Statut</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-slate-500 text-sm">Aucune transaction. Importez un CSV de votre banque.</td></tr>
              )}
              {data.map(tx => (
                <tr key={tx.id} className="border-b border-slate-700 hover:bg-slate-750 transition">
                  <td className="px-4 py-3 text-slate-300 text-sm">{formatDate(tx.date_tx)}</td>
                  <td className="px-4 py-3 text-white text-sm">{tx.description}</td>
                  <td className={`px-4 py-3 text-sm font-medium ${tx.type === 'credit' ? 'text-green-400' : 'text-red-400'}`}>
                    {tx.type === 'credit' ? '+' : '-'}{formatMoney(Math.abs(Number(tx.montant)))}
                  </td>
                  <td className="px-4 py-3 text-slate-300 text-sm">{tx.type === 'credit' ? 'Entree' : 'Sortie'}</td>
                  <td className="px-4 py-3 text-sm">
                    {tx.invoice_numero && <span className="text-amber-400">Facture {tx.invoice_numero}</span>}
                    {tx.expense_fournisseur && <span className="text-purple-400">{tx.expense_fournisseur}</span>}
                    {!tx.invoice_numero && !tx.expense_fournisseur && <span className="text-slate-500">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-1 rounded ${tx.reconciled ? 'bg-green-500/20 text-green-400' : 'bg-slate-500/20 text-slate-400'}`}>
                      {tx.reconciled ? 'Reconcilie' : 'En attente'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {total > 50 && (
          <div className="flex gap-2 justify-end">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-3 py-1.5 bg-slate-700 rounded text-sm text-white disabled:opacity-40">Precedent</button>
            <span className="px-3 py-1.5 text-slate-400 text-sm">Page {page} / {Math.ceil(total / 50)}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil(total / 50)}
              className="px-3 py-1.5 bg-slate-700 rounded text-sm text-white disabled:opacity-40">Suivant</button>
          </div>
        )}
      </div>
    </PollingProvider>
  );
}

export default function BanquePage() {
  return <PageContent />;
}
