'use client';

import { useState, useCallback } from 'react';
import { StatsCard } from '@/components/stats-card';
import { VisitesChart } from '@/components/visites-chart';
import { ConversionsChart } from '@/components/conversions-chart';
import { PollingProvider } from '@/components/polling-provider';
import { fetchStats, type StatsResponse } from '@/lib/api';
import { formatNumber } from '@/lib/utils';

function PageContent() {
  const [stats, setStats]   = useState<StatsResponse | null>(null);
  const [periode, setPeriode] = useState<'7d' | '30d' | '90d'>('30d');

  const load = useCallback(async () => {
    setStats(await fetchStats(periode));
  }, [periode]);

  return (
    <PollingProvider onRefresh={load}>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">Statistiques</h2>
          <div className="flex gap-2">
            {(['7d', '30d', '90d'] as const).map(p => (
              <button key={p} onClick={() => setPeriode(p)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                  periode === p ? 'bg-amber-500 text-slate-900' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>
                {p === '7d' ? '7 jours' : p === '30d' ? '30 jours' : '90 jours'}
              </button>
            ))}
          </div>
        </div>

        {stats && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatsCard titre="Visites"          valeur={stats.metriques.visites}           variation={stats.metriques.visites_variation}   icon="👁" />
              <StatsCard titre="Visiteurs uniques" valeur={stats.metriques.visiteurs_uniques} variation={stats.metriques.visiteurs_variation} icon="👤" />
              <StatsCard titre="Soumissions"      valeur={stats.metriques.leads}             variation={stats.metriques.leads_variation}     icon="📋" />
              <StatsCard titre="Taux conversion"  valeur={stats.metriques.taux_conversion}   variation={stats.metriques.taux_variation}      suffixe="%" icon="🎯" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <VisitesChart data={stats.serie_visites} />
              <ConversionsChart data={stats.serie_leads} />
            </div>

            {/* Top pages */}
            <div className="bg-slate-800 border border-slate-700 rounded-xl">
              <div className="p-5 border-b border-slate-700">
                <h3 className="text-white font-semibold">Pages les plus visitées</h3>
              </div>
              <div className="divide-y divide-slate-700">
                {stats.top_pages.map((p, i) => (
                  <div key={p.url_path} className="flex items-center justify-between px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className="text-slate-500 text-sm w-5">{i + 1}</span>
                      <span className="text-slate-300 text-sm font-mono">{p.url_path}</span>
                    </div>
                    <span className="text-white text-sm font-medium">{formatNumber(p.vues)} vues</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </PollingProvider>
  );
}

export default function StatsPage() {
  return <PageContent />;
}
