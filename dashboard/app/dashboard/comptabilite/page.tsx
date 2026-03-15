'use client';

import { useState, useCallback } from 'react';
import { PollingProvider } from '@/components/polling-provider';
import { formatMoney } from '@/lib/pricing';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface AccountingData {
  year: number;
  revenue_total: number;
  tps_total: number;
  tvq_total: number;
  nb_completees: number;
  depots_recus: number;
  nb_depots: number;
  depots_en_attente: number;
  soldes_en_attente: number;
  par_statut: { statut: string; count: number }[];
  revenus_mensuels: { mois: string; revenue: number }[];
  total_paiements: number;
  nb_paiements: number;
  nb_factures: number;
  depenses_total: number;
  depenses_ht: number;
  tps_depenses: number;
  tvq_depenses: number;
  nb_depenses: number;
  depenses_par_categorie: { categorie: string; total: number; count: number }[];
  profit_net: number;
  nb_transactions_bank: number;
  nb_reconciled_bank: number;
}

const MOIS_LABEL: Record<string, string> = {
  '01': 'Jan', '02': 'Fev', '03': 'Mar', '04': 'Avr', '05': 'Mai', '06': 'Jun',
  '07': 'Jul', '08': 'Aou', '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec',
};

const CAT_LABEL: Record<string, string> = {
  materiaux: 'Materiaux', sous_traitance: 'Sous-traitance', transport: 'Transport',
  equipement: 'Equipement', marketing: 'Marketing', loyer: 'Loyer',
  assurance: 'Assurance', admin: 'Administration', autre: 'Autre',
};

const STATUT_LABEL: Record<string, string> = {
  brouillon: 'Brouillon', envoyee: 'Envoyee', depot_recu: 'Depot recu',
  travaux_en_cours: 'Travaux', completee: 'Completee', annulee: 'Annulee',
};

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`bg-slate-800 border rounded-xl p-5 ${accent ? 'border-amber-500/30' : 'border-slate-700'}`}>
      <p className="text-slate-400 text-xs font-medium uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${accent ? 'text-amber-400' : 'text-white'}`}>{value}</p>
    </div>
  );
}

function PageContent() {
  const [data, setData] = useState<AccountingData | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());

  const load = useCallback(async () => {
    const res = await fetch(`/api/accounting?year=${year}`);
    const json = await res.json();
    setData(json);
  }, [year]);

  const chartData = (data?.revenus_mensuels ?? []).map(r => ({
    mois: MOIS_LABEL[r.mois.split('-')[1]] ?? r.mois,
    revenue: Number(r.revenue),
  }));

  return (
    <PollingProvider onRefresh={load}>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">Comptabilite</h2>
          <div className="flex items-center gap-3">
            <select value={year} onChange={e => setYear(parseInt(e.target.value))}
              className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500">
              {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <a href={`/api/accounting/export?year=${year}`}
              className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold rounded-lg px-4 py-2 text-sm transition">
              Exporter CSV
            </a>
          </div>
        </div>

        {data && (
          <>
            {/* Profit */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-slate-800 border border-green-500/30 rounded-xl p-5">
                <p className="text-slate-400 text-xs font-medium uppercase tracking-wider">Revenus</p>
                <p className="text-2xl font-bold mt-1 text-green-400">{formatMoney(data.revenue_total)}</p>
              </div>
              <div className="bg-slate-800 border border-red-500/30 rounded-xl p-5">
                <p className="text-slate-400 text-xs font-medium uppercase tracking-wider">Depenses</p>
                <p className="text-2xl font-bold mt-1 text-red-400">{formatMoney(data.depenses_total)}</p>
              </div>
              <div className={`bg-slate-800 border rounded-xl p-5 ${data.profit_net >= 0 ? 'border-amber-500/30' : 'border-red-500/30'}`}>
                <p className="text-slate-400 text-xs font-medium uppercase tracking-wider">Profit net</p>
                <p className={`text-2xl font-bold mt-1 ${data.profit_net >= 0 ? 'text-amber-400' : 'text-red-400'}`}>{formatMoney(data.profit_net)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Paiements recus" value={formatMoney(data.total_paiements)} />
              <StatCard label="Depots en attente" value={formatMoney(data.depots_en_attente)} />
              <StatCard label="Soldes en attente" value={formatMoney(data.soldes_en_attente)} />
              <StatCard label="Factures" value={String(data.nb_factures)} />
            </div>

            {/* Taxes */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="TPS percu" value={formatMoney(data.tps_total)} />
              <StatCard label="TPS paye" value={formatMoney(data.tps_depenses)} />
              <StatCard label="TVQ percu" value={formatMoney(data.tvq_total)} />
              <StatCard label="TVQ paye" value={formatMoney(data.tvq_depenses)} />
            </div>

            {/* Tax remittance */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
                <p className="text-slate-400 text-xs font-medium uppercase tracking-wider">TPS a remettre</p>
                <p className="text-xl font-bold mt-1 text-white">{formatMoney(data.tps_total - data.tps_depenses)}</p>
                <p className="text-slate-500 text-xs mt-1">Percu {formatMoney(data.tps_total)} - Paye {formatMoney(data.tps_depenses)}</p>
              </div>
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
                <p className="text-slate-400 text-xs font-medium uppercase tracking-wider">TVQ a remettre</p>
                <p className="text-xl font-bold mt-1 text-white">{formatMoney(data.tvq_total - data.tvq_depenses)}</p>
                <p className="text-slate-500 text-xs mt-1">Percu {formatMoney(data.tvq_total)} - Paye {formatMoney(data.tvq_depenses)}</p>
              </div>
            </div>

            {/* Expenses by category */}
            {data.depenses_par_categorie && data.depenses_par_categorie.length > 0 && (
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
                <h3 className="text-white font-semibold mb-4">Depenses par categorie</h3>
                <div className="space-y-3">
                  {data.depenses_par_categorie.map((c: { categorie: string; total: number; count: number }) => {
                    const pct = data.depenses_total > 0 ? (Number(c.total) / data.depenses_total) * 100 : 0;
                    return (
                      <div key={c.categorie} className="flex items-center gap-4">
                        <span className="text-slate-300 text-sm w-32">{CAT_LABEL[c.categorie] ?? c.categorie}</span>
                        <div className="flex-1 bg-slate-700 rounded-full h-3">
                          <div className="bg-amber-500 h-3 rounded-full" style={{ width: `${Math.max(pct, 2)}%` }} />
                        </div>
                        <span className="text-white font-medium text-sm w-28 text-right">{formatMoney(Number(c.total))}</span>
                        <span className="text-slate-500 text-xs w-12 text-right">{pct.toFixed(0)}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Bank reconciliation status */}
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
              <h3 className="text-white font-semibold mb-4">Reconciliation bancaire</h3>
              <div className="flex items-center gap-4">
                <span className="text-slate-300 text-sm">
                  {data.nb_reconciled_bank} / {data.nb_transactions_bank} transactions reconciliees
                </span>
                {data.nb_transactions_bank > 0 && (
                  <div className="flex-1 bg-slate-700 rounded-full h-3">
                    <div className="bg-green-500 h-3 rounded-full" style={{ width: `${(data.nb_reconciled_bank / data.nb_transactions_bank) * 100}%` }} />
                  </div>
                )}
              </div>
            </div>

            {/* Revenue Chart */}
            {chartData.length > 0 && (
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
                <h3 className="text-white font-semibold mb-4">Revenus mensuels</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={chartData}>
                    <XAxis dataKey="mois" stroke="#64748b" fontSize={12} />
                    <YAxis stroke="#64748b" fontSize={12} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                      labelStyle={{ color: '#94a3b8' }}
                      formatter={(value) => [formatMoney(Number(value)), 'Revenue']}
                    />
                    <Bar dataKey="revenue" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Par statut */}
            {data.par_statut.length > 0 && (
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
                <h3 className="text-white font-semibold mb-4">Factures par statut</h3>
                <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                  {data.par_statut.map(s => (
                    <div key={s.statut} className="text-center">
                      <p className="text-2xl font-bold text-white">{s.count}</p>
                      <p className="text-slate-400 text-xs">{STATUT_LABEL[s.statut] ?? s.statut}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </PollingProvider>
  );
}

export default function ComptabilitePage() {
  return <PageContent />;
}
