'use client';

import { useState, useCallback } from 'react';
import { PollingProvider } from '@/components/polling-provider';
import { formatMoney } from '@/lib/pricing';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface QuarterData {
  trimestre: string;
  periode: string;
  deadline: string;
  revenue: number;
  depenses: number;
  tps_percu: number;
  tps_paye: number;
  tps_net: number;
  tvq_percu: number;
  tvq_paye: number;
  tvq_net: number;
}

interface OutstandingInvoice {
  id: number;
  numero: string;
  client_nom: string;
  total: number;
  depot_montant: number;
  depot_paye: boolean;
  final_montant: number;
  final_paye: boolean;
  date_emission: string;
  statut: string;
  jours_depuis: number;
}

interface TopExpense {
  fournisseur: string;
  description: string | null;
  montant_ttc: number;
  date_depense: string;
  categorie: string;
}

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
  revenus_mensuels: { mois: string; revenue: number; depenses: number; profit: number }[];
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
  trimestriel: QuarterData[];
  factures_impayees: OutstandingInvoice[];
  top_depenses: TopExpense[];
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

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  const borderColor = color === 'green' ? 'border-green-500/30' : color === 'red' ? 'border-red-500/30' : color === 'amber' ? 'border-amber-500/30' : 'border-slate-700';
  const textColor = color === 'green' ? 'text-green-400' : color === 'red' ? 'text-red-400' : color === 'amber' ? 'text-amber-400' : 'text-white';
  return (
    <div className={`bg-slate-800 border ${borderColor} rounded-xl p-5`}>
      <p className="text-slate-400 text-xs font-medium uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${textColor}`}>{value}</p>
      {sub && <p className="text-slate-500 text-xs mt-1">{sub}</p>}
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
    Revenus: Number(r.revenue),
    Depenses: Number(r.depenses),
    Profit: Number(r.profit),
  }));

  // Current quarter
  const currentQ = Math.ceil((new Date().getMonth() + 1) / 3);

  // Aging buckets for outstanding invoices
  const aging = { current: 0, d30: 0, d60: 0, d90: 0 };
  (data?.factures_impayees ?? []).forEach(inv => {
    const owed = Number(inv.total) - (inv.depot_paye ? Number(inv.depot_montant) : 0) - (inv.final_paye ? Number(inv.final_montant) : 0);
    if (inv.jours_depuis > 90) aging.d90 += owed;
    else if (inv.jours_depuis > 60) aging.d60 += owed;
    else if (inv.jours_depuis > 30) aging.d30 += owed;
    else aging.current += owed;
  });
  const totalOwed = aging.current + aging.d30 + aging.d60 + aging.d90;

  return (
    <PollingProvider onRefresh={load}>
      <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h2 className="text-xl sm:text-2xl font-bold text-white">Comptabilite</h2>
          <div className="flex items-center gap-2 sm:gap-3">
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
            {/* === SECTION 1: VUE D'ENSEMBLE === */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
              <StatCard label="Revenus" value={formatMoney(data.revenue_total)} sub={`${data.nb_completees} factures`} color="green" />
              <StatCard label="Depenses" value={formatMoney(data.depenses_total)} sub={`${data.nb_depenses} depenses`} color="red" />
              <StatCard label="Profit net" value={formatMoney(data.profit_net)} color={data.profit_net >= 0 ? 'amber' : 'red'} />
              <StatCard label="A recevoir" value={formatMoney(totalOwed)} sub={`${data.factures_impayees.length} factures`} color={totalOwed > 0 ? 'amber' : undefined} />
            </div>

            {/* === SECTION 2: TRIMESTRES TPS/TVQ === */}
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-3 sm:p-6">
              <h3 className="text-white font-semibold mb-4">TPS/TVQ par trimestre</h3>
              <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
                <table className="w-full text-xs sm:text-sm min-w-[700px]">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="text-left py-2 text-slate-400 font-medium">Trimestre</th>
                      <th className="text-right py-2 text-slate-400 font-medium">Revenus</th>
                      <th className="text-right py-2 text-slate-400 font-medium">Depenses</th>
                      <th className="text-right py-2 text-slate-400 font-medium">TPS percu</th>
                      <th className="text-right py-2 text-slate-400 font-medium">TPS paye</th>
                      <th className="text-right py-2 text-slate-400 font-medium">TPS a remettre</th>
                      <th className="text-right py-2 text-slate-400 font-medium">TVQ percu</th>
                      <th className="text-right py-2 text-slate-400 font-medium">TVQ paye</th>
                      <th className="text-right py-2 text-slate-400 font-medium">TVQ a remettre</th>
                      <th className="text-right py-2 text-slate-400 font-medium">Date limite</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.trimestriel.map(q => {
                      const isCurrentQ = q.trimestre === `T${currentQ}` && year === new Date().getFullYear();
                      const deadlineDate = new Date(q.deadline);
                      const isOverdue = deadlineDate < new Date() && (q.tps_net > 0 || q.tvq_net > 0);
                      return (
                        <tr key={q.trimestre} className={`border-b border-slate-700/50 ${isCurrentQ ? 'bg-amber-500/5' : ''}`}>
                          <td className="py-3">
                            <span className={`font-medium ${isCurrentQ ? 'text-amber-400' : 'text-white'}`}>{q.trimestre}</span>
                            {isCurrentQ && <span className="text-xs text-amber-400 ml-2">En cours</span>}
                          </td>
                          <td className="text-right text-green-400">{formatMoney(q.revenue)}</td>
                          <td className="text-right text-red-400">{formatMoney(q.depenses)}</td>
                          <td className="text-right text-slate-300">{formatMoney(q.tps_percu)}</td>
                          <td className="text-right text-slate-300">{formatMoney(q.tps_paye)}</td>
                          <td className={`text-right font-medium ${q.tps_net > 0 ? 'text-amber-400' : 'text-green-400'}`}>{formatMoney(q.tps_net)}</td>
                          <td className="text-right text-slate-300">{formatMoney(q.tvq_percu)}</td>
                          <td className="text-right text-slate-300">{formatMoney(q.tvq_paye)}</td>
                          <td className={`text-right font-medium ${q.tvq_net > 0 ? 'text-amber-400' : 'text-green-400'}`}>{formatMoney(q.tvq_net)}</td>
                          <td className={`text-right text-xs ${isOverdue ? 'text-red-400 font-medium' : 'text-slate-500'}`}>
                            {q.deadline.slice(5)}
                            {isOverdue && ' !'}
                          </td>
                        </tr>
                      );
                    })}
                    {/* Total row */}
                    <tr className="border-t-2 border-slate-600 font-medium">
                      <td className="py-3 text-white">Total {year}</td>
                      <td className="text-right text-green-400">{formatMoney(data.revenue_total)}</td>
                      <td className="text-right text-red-400">{formatMoney(data.depenses_total)}</td>
                      <td className="text-right text-slate-300">{formatMoney(data.tps_total)}</td>
                      <td className="text-right text-slate-300">{formatMoney(data.tps_depenses)}</td>
                      <td className="text-right text-amber-400">{formatMoney(data.tps_total - data.tps_depenses)}</td>
                      <td className="text-right text-slate-300">{formatMoney(data.tvq_total)}</td>
                      <td className="text-right text-slate-300">{formatMoney(data.tvq_depenses)}</td>
                      <td className="text-right text-amber-400">{formatMoney(data.tvq_total - data.tvq_depenses)}</td>
                      <td></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* === SECTION 3: GRAPHIQUE REVENUS vs DEPENSES === */}
            {chartData.some(d => d.Revenus > 0 || d.Depenses > 0) && (
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
                <h3 className="text-white font-semibold mb-4">Revenus vs Depenses par mois</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={chartData}>
                    <XAxis dataKey="mois" stroke="#64748b" fontSize={12} />
                    <YAxis stroke="#64748b" fontSize={12} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                    <Tooltip
                      contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                      labelStyle={{ color: '#94a3b8' }}
                      formatter={(value) => [formatMoney(Number(value)), '']}
                    />
                    <Legend />
                    <Bar dataKey="Revenus" fill="#22c55e" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Depenses" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* === SECTION 4: COMPTES A RECEVOIR === */}
            {data.factures_impayees.length > 0 && (
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
                <h3 className="text-white font-semibold mb-4">Comptes a recevoir</h3>

                {/* Aging bars */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                  <div className="bg-slate-700/50 rounded-lg p-3 text-center">
                    <p className="text-green-400 font-bold text-lg">{formatMoney(aging.current)}</p>
                    <p className="text-slate-400 text-xs">0-30 jours</p>
                  </div>
                  <div className="bg-slate-700/50 rounded-lg p-3 text-center">
                    <p className="text-yellow-400 font-bold text-lg">{formatMoney(aging.d30)}</p>
                    <p className="text-slate-400 text-xs">31-60 jours</p>
                  </div>
                  <div className="bg-slate-700/50 rounded-lg p-3 text-center">
                    <p className="text-orange-400 font-bold text-lg">{formatMoney(aging.d60)}</p>
                    <p className="text-slate-400 text-xs">61-90 jours</p>
                  </div>
                  <div className="bg-slate-700/50 rounded-lg p-3 text-center">
                    <p className="text-red-400 font-bold text-lg">{formatMoney(aging.d90)}</p>
                    <p className="text-slate-400 text-xs">90+ jours</p>
                  </div>
                </div>

                {/* Invoice list */}
                <div className="space-y-2">
                  {data.factures_impayees.map(inv => {
                    const depotDu = !inv.depot_paye ? Number(inv.depot_montant) : 0;
                    const soldeDu = !inv.final_paye ? Number(inv.final_montant) : 0;
                    const totalDu = depotDu + soldeDu;
                    const ageColor = inv.jours_depuis > 90 ? 'text-red-400' : inv.jours_depuis > 60 ? 'text-orange-400' : inv.jours_depuis > 30 ? 'text-yellow-400' : 'text-slate-400';
                    return (
                      <div key={inv.id} className="flex flex-col sm:flex-row sm:items-center justify-between border border-slate-700 rounded-lg px-3 sm:px-4 py-2 gap-1 sm:gap-0">
                        <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
                          <span className="text-white font-medium text-sm">{inv.client_nom}</span>
                          <span className="text-slate-500 text-xs">#{inv.numero}</span>
                          {depotDu > 0 && <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded">Depot: {formatMoney(depotDu)}</span>}
                          {soldeDu > 0 && <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded">Solde: {formatMoney(soldeDu)}</span>}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-white font-medium text-sm">{formatMoney(totalDu)}</span>
                          <span className={`text-xs ${ageColor}`}>{inv.jours_depuis}j</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* === SECTION 5: DEPENSES PAR CATEGORIE === */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {data.depenses_par_categorie && data.depenses_par_categorie.length > 0 && (
                <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
                  <h3 className="text-white font-semibold mb-4">Depenses par categorie</h3>
                  <div className="space-y-3">
                    {data.depenses_par_categorie.map((c: { categorie: string; total: number; count: number }) => {
                      const pct = data.depenses_total > 0 ? (Number(c.total) / data.depenses_total) * 100 : 0;
                      return (
                        <div key={c.categorie} className="flex items-center gap-3">
                          <span className="text-slate-300 text-sm w-28 truncate">{CAT_LABEL[c.categorie] ?? c.categorie}</span>
                          <div className="flex-1 bg-slate-700 rounded-full h-3">
                            <div className="bg-amber-500 h-3 rounded-full" style={{ width: `${Math.max(pct, 2)}%` }} />
                          </div>
                          <span className="text-white font-medium text-sm w-24 text-right">{formatMoney(Number(c.total))}</span>
                          <span className="text-slate-500 text-xs w-10 text-right">{pct.toFixed(0)}%</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Top 10 depenses */}
              {data.top_depenses && data.top_depenses.length > 0 && (
                <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
                  <h3 className="text-white font-semibold mb-4">Plus grosses depenses</h3>
                  <div className="space-y-2">
                    {data.top_depenses.map((e: TopExpense, idx: number) => (
                      <div key={idx} className="flex items-center justify-between py-1.5 border-b border-slate-700/50 last:border-0">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <span className="text-slate-500 text-xs w-5">{idx + 1}.</span>
                          <span className="text-white text-sm font-medium truncate">{e.fournisseur}</span>
                          <span className="text-slate-500 text-xs truncate">{CAT_LABEL[e.categorie] ?? e.categorie}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-slate-400 text-xs">{String(e.date_depense).slice(0, 10)}</span>
                          <span className="text-red-400 font-medium text-sm">{formatMoney(Number(e.montant_ttc))}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* === SECTION 6: COLLECTES & RECONCILIATION === */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
                <h3 className="text-white font-semibold mb-4">Paiements & Encaissements</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div>
                    <p className="text-slate-400 text-xs uppercase tracking-wider">Paiements recus</p>
                    <p className="text-white text-xl font-bold mt-1">{formatMoney(data.total_paiements)}</p>
                    <p className="text-slate-500 text-xs">{data.nb_paiements} paiements</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs uppercase tracking-wider">Depots recus</p>
                    <p className="text-white text-xl font-bold mt-1">{formatMoney(data.depots_recus)}</p>
                    <p className="text-slate-500 text-xs">{data.nb_depots} depots</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs uppercase tracking-wider">Depots en attente</p>
                    <p className="text-amber-400 text-xl font-bold mt-1">{formatMoney(data.depots_en_attente)}</p>
                  </div>
                  <div>
                    <p className="text-slate-400 text-xs uppercase tracking-wider">Soldes en attente</p>
                    <p className="text-amber-400 text-xl font-bold mt-1">{formatMoney(data.soldes_en_attente)}</p>
                  </div>
                </div>
              </div>

              {/* Bank reconciliation */}
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
                <h3 className="text-white font-semibold mb-4">Reconciliation bancaire</h3>
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <span className="text-slate-300 text-sm">
                      {data.nb_reconciled_bank} / {data.nb_transactions_bank} transactions
                    </span>
                    {data.nb_transactions_bank > 0 && (
                      <div className="flex-1 bg-slate-700 rounded-full h-3">
                        <div className="bg-green-500 h-3 rounded-full transition-all" style={{ width: `${(data.nb_reconciled_bank / data.nb_transactions_bank) * 100}%` }} />
                      </div>
                    )}
                    {data.nb_transactions_bank > 0 && (
                      <span className="text-slate-400 text-sm font-medium">{((data.nb_reconciled_bank / data.nb_transactions_bank) * 100).toFixed(0)}%</span>
                    )}
                  </div>

                  {/* Factures par statut */}
                  {data.par_statut.length > 0 && (
                    <div>
                      <p className="text-slate-400 text-xs uppercase tracking-wider mb-3">Factures par statut</p>
                      <div className="grid grid-cols-3 gap-2">
                        {data.par_statut.map(s => (
                          <div key={s.statut} className="text-center bg-slate-700/30 rounded-lg p-2">
                            <p className="text-xl font-bold text-white">{s.count}</p>
                            <p className="text-slate-400 text-xs">{STATUT_LABEL[s.statut] ?? s.statut}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </PollingProvider>
  );
}

export default function ComptabilitePage() {
  return <PageContent />;
}
