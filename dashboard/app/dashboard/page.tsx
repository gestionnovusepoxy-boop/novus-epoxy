'use client';

import { useState, useCallback } from 'react';
import { StatsCard } from '@/components/stats-card';
import { VisitesChart } from '@/components/visites-chart';
import { ConversionsChart } from '@/components/conversions-chart';
import { PollingProvider, usePolling } from '@/components/polling-provider';
import { fetchStats, fetchSubmissions, type StatsResponse, type Submission } from '@/lib/api';
import { formatDate } from '@/lib/utils';

function RefreshBadge() {
  const { lastRefresh, isRefreshing } = usePolling();
  return (
    <span className="text-xs text-slate-500">
      {isRefreshing ? '🔄 Actualisation...' : lastRefresh ? `Dernière mise à jour: ${formatDate(lastRefresh.toISOString())}` : ''}
    </span>
  );
}

function DashboardContent() {
  const [stats, setStats]               = useState<StatsResponse | null>(null);
  const [soumissions, setSoumissions]   = useState<Submission[]>([]);
  const [periode, setPeriode]           = useState<'7d' | '30d' | '90d'>('30d');

  const loadData = useCallback(async () => {
    const [s, sub] = await Promise.all([
      fetchStats(periode),
      fetchSubmissions({ limit: 5, statut: 'nouveau' }),
    ]);
    setStats(s);
    setSoumissions(sub.data);
  }, [periode]);

  return (
    <PollingProvider onRefresh={loadData}>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white">Vue d'ensemble</h2>
            <RefreshBadge />
          </div>
          <div className="flex gap-2">
            {(['7d', '30d', '90d'] as const).map(p => (
              <button
                key={p}
                onClick={() => setPeriode(p)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                  periode === p
                    ? 'bg-amber-500 text-slate-900'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                {p === '7d' ? '7 jours' : p === '30d' ? '30 jours' : '90 jours'}
              </button>
            ))}
          </div>
        </div>

        {/* Métriques */}
        {stats && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatsCard
                titre="Visites"
                valeur={stats.metriques.visites}
                variation={stats.metriques.visites_variation}
                icon="👁"
              />
              <StatsCard
                titre="Visiteurs uniques"
                valeur={stats.metriques.visiteurs_uniques}
                variation={stats.metriques.visiteurs_variation}
                icon="👤"
              />
              <StatsCard
                titre="Soumissions"
                valeur={stats.metriques.leads}
                variation={stats.metriques.leads_variation}
                icon="📋"
              />
              <StatsCard
                titre="Taux de conversion"
                valeur={stats.metriques.taux_conversion}
                variation={stats.metriques.taux_variation}
                suffixe="%"
                icon="🎯"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <VisitesChart data={stats.serie_visites} />
              <ConversionsChart data={stats.serie_leads} />
            </div>
          </>
        )}

        {/* Nouvelles soumissions */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl">
          <div className="flex items-center justify-between p-5 border-b border-slate-700">
            <h3 className="text-white font-semibold">Nouvelles soumissions</h3>
            <a href="/dashboard/soumissions" className="text-amber-400 hover:text-amber-300 text-sm transition">
              Voir tout →
            </a>
          </div>
          <div className="divide-y divide-slate-700">
            {soumissions.length === 0 && (
              <p className="text-slate-500 text-sm p-5">Aucune nouvelle soumission</p>
            )}
            {soumissions.map(s => (
              <div key={s.id} className="flex items-center justify-between p-4">
                <div>
                  <p className="text-white text-sm font-medium">{s.nom}</p>
                  <p className="text-slate-400 text-xs">{s.email} · {s.service ?? '—'}</p>
                </div>
                <p className="text-slate-500 text-xs">{formatDate(s.created_at)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </PollingProvider>
  );
}

export default function DashboardPage() {
  return <DashboardContent />;
}
