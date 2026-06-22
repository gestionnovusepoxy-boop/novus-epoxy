'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatMoney } from '@/lib/pricing';

/* ─── Types (miroir de lib/roas.ts) ─── */
interface RoasRow {
  source: string;
  leads: number;
  devis: number;
  signes: number;
  revenu: number;
  taux_lead_devis: number;
  taux_devis_signe: number;
  taux_lead_signe: number;
  revenu_par_lead: number;
  depense_cad: number | null;
  roas: number | null;
  cpl_cad: number | null;
}
interface RoasTotals {
  leads: number;
  devis: number;
  signes: number;
  revenu: number;
  depense_cad: number;
  roas: number | null;
  taux_lead_signe: number;
}
interface RoasReport {
  rows: RoasRow[];
  totals: RoasTotals;
  meta_spend_total_cad: number;
  generated_at: string;
}

const PERIODES: { value: string; label: string }[] = [
  { value: 'all', label: 'Tout' },
  { value: '365d', label: '12 mois' },
  { value: '90d', label: '90 jours' },
  { value: '30d', label: '30 jours' },
];

/* Étiquettes lisibles pour les sources connues */
const SOURCE_LABEL: Record<string, string> = {
  'facebook-leadad': 'Facebook (lead ad)',
  'facebook-zapier': 'Facebook (Zapier)',
  facebook: 'Facebook',
  'site-web': 'Site web',
  'google-maps': 'Google Maps',
  jason: 'Prospection (Denis)',
  'csv-aria': 'Import CSV (Aria)',
  cloud: 'Cloud',
  homestars: 'HomeStars',
  houzz: 'Houzz',
  ghl: 'GoHighLevel',
  cms: 'Site CMS',
  prospection: 'Prospection',
};
function sourceLabel(s: string): string {
  return SOURCE_LABEL[s] ?? s;
}

function Pct({ v }: { v: number }) {
  return <span>{v.toFixed(1)} %</span>;
}

export default function RoasPage() {
  const [periode, setPeriode] = useState('all');
  const [data, setData] = useState<RoasReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/roas?periode=${p}`);
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      const json: RoasReport = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(periode); }, [periode, load]);

  const t = data?.totals;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* En-tête */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <span>📈</span> ROAS / Rendement par source
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Performance de chaque source de lead : leads → devis → contrats signés, revenu réel et dépense publicitaire.
          </p>
        </div>
        <div className="flex gap-1 bg-slate-800 rounded-lg p-1">
          {PERIODES.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriode(p.value)}
              className={`px-3 py-1.5 rounded-md text-sm transition ${
                periode === p.value
                  ? 'bg-slate-600 text-white font-medium'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Cartes totaux */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
          <p className="text-slate-400 text-xs uppercase tracking-wide">Revenu signé</p>
          <p className="text-3xl font-bold text-emerald-400 mt-1">
            {t ? formatMoney(t.revenu) : '—'}
          </p>
          <p className="text-slate-500 text-xs mt-1">
            {t ? `${t.signes} contrat${t.signes > 1 ? 's' : ''} signé${t.signes > 1 ? 's' : ''}` : ''}
          </p>
        </div>
        <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
          <p className="text-slate-400 text-xs uppercase tracking-wide">Dépense pub (Meta)</p>
          <p className="text-3xl font-bold text-amber-400 mt-1">
            {t ? formatMoney(t.depense_cad) : '—'}
          </p>
          <p className="text-slate-500 text-xs mt-1">
            {data ? `Total connu : ${formatMoney(data.meta_spend_total_cad)} CAD` : ''}
          </p>
        </div>
        <div className="bg-slate-800 rounded-xl p-5 border border-slate-700">
          <p className="text-slate-400 text-xs uppercase tracking-wide">ROAS global</p>
          <p className="text-3xl font-bold text-sky-400 mt-1">
            {t && t.roas != null ? `${t.roas.toFixed(2)}×` : '—'}
          </p>
          <p className="text-slate-500 text-xs mt-1">
            {t ? <>Conversion lead→signé : <Pct v={t.taux_lead_signe} /></> : ''}
          </p>
        </div>
      </div>

      {/* États */}
      {loading && <p className="text-slate-400 text-sm py-8 text-center">Chargement…</p>}
      {error && (
        <p className="text-red-400 text-sm py-8 text-center bg-red-950/30 rounded-lg border border-red-900">
          {error}
        </p>
      )}

      {/* Tableau */}
      {!loading && !error && data && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 text-xs uppercase tracking-wide border-b border-slate-700">
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium text-right">Leads</th>
                  <th className="px-4 py-3 font-medium text-right">Devis</th>
                  <th className="px-4 py-3 font-medium text-right">Signés</th>
                  <th className="px-4 py-3 font-medium text-right">Lead→Devis</th>
                  <th className="px-4 py-3 font-medium text-right">Devis→Signé</th>
                  <th className="px-4 py-3 font-medium text-right">Revenu</th>
                  <th className="px-4 py-3 font-medium text-right">Rev / lead</th>
                  <th className="px-4 py-3 font-medium text-right">Dépense</th>
                  <th className="px-4 py-3 font-medium text-right">CPL</th>
                  <th className="px-4 py-3 font-medium text-right">ROAS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/60">
                {data.rows.map((r) => (
                  <tr key={r.source} className="hover:bg-slate-700/30 transition">
                    <td className="px-4 py-3 text-white font-medium">{sourceLabel(r.source)}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{r.leads}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{r.devis}</td>
                    <td className="px-4 py-3 text-right text-emerald-400 font-medium">{r.signes}</td>
                    <td className="px-4 py-3 text-right text-slate-400"><Pct v={r.taux_lead_devis} /></td>
                    <td className="px-4 py-3 text-right text-slate-400"><Pct v={r.taux_devis_signe} /></td>
                    <td className="px-4 py-3 text-right text-white">{formatMoney(r.revenu)}</td>
                    <td className="px-4 py-3 text-right text-slate-300">{formatMoney(r.revenu_par_lead)}</td>
                    <td className="px-4 py-3 text-right text-amber-400">
                      {r.depense_cad != null ? formatMoney(r.depense_cad) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-400">
                      {r.cpl_cad != null ? formatMoney(r.cpl_cad) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold">
                      {r.roas != null ? (
                        <span className={r.roas >= 1 ? 'text-sky-400' : 'text-red-400'}>
                          {r.roas.toFixed(2)}×
                        </span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-4 py-8 text-center text-slate-500">
                      Aucune donnée pour cette période.
                    </td>
                  </tr>
                )}
              </tbody>
              {t && data.rows.length > 0 && (
                <tfoot>
                  <tr className="border-t border-slate-600 bg-slate-800/80 font-semibold text-white">
                    <td className="px-4 py-3">Total</td>
                    <td className="px-4 py-3 text-right">{t.leads}</td>
                    <td className="px-4 py-3 text-right">{t.devis}</td>
                    <td className="px-4 py-3 text-right text-emerald-400">{t.signes}</td>
                    <td className="px-4 py-3 text-right text-slate-400">—</td>
                    <td className="px-4 py-3 text-right text-slate-400">—</td>
                    <td className="px-4 py-3 text-right">{formatMoney(t.revenu)}</td>
                    <td className="px-4 py-3 text-right text-slate-400">—</td>
                    <td className="px-4 py-3 text-right text-amber-400">{formatMoney(t.depense_cad)}</td>
                    <td className="px-4 py-3 text-right text-slate-400">—</td>
                    <td className="px-4 py-3 text-right text-sky-400">
                      {t.roas != null ? `${t.roas.toFixed(2)}×` : '—'}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      <p className="text-slate-600 text-xs mt-4">
        Devis reliés au lead par lien direct ou courriel. Contrats signés = statut dépôt payé / planifié / complété.
        Dépense Meta répartie au prorata des leads Facebook.
      </p>
    </div>
  );
}
