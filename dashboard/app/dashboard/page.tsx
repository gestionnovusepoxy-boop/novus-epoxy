'use client';

import { useState, useCallback } from 'react';
import { StatsCard } from '@/components/stats-card';
import { VisitesChart } from '@/components/visites-chart';
import { ConversionsChart } from '@/components/conversions-chart';
import { RevenusChart } from '@/components/revenus-chart';
import { PollingProvider, usePolling } from '@/components/polling-provider';
import { fetchStats, fetchSubmissions, type StatsResponse, type Submission } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import Link from 'next/link';
import { PipelineDonut, TopPagesBar } from '@/components/tremor-charts';

function RefreshBadge() {
  const { lastRefresh, isRefreshing } = usePolling();
  return (
    <span className="text-xs text-slate-500">
      {isRefreshing ? 'Actualisation...' : lastRefresh ? `Derniere mise a jour: ${formatDate(lastRefresh.toISOString())}` : ''}
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
            <h2 className="text-2xl font-bold text-white">Vue d&apos;ensemble</h2>
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

        {!stats && (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3 animate-pulse">
                <div className="h-3 w-16 bg-slate-700 rounded" />
                <div className="h-8 w-24 bg-slate-700 rounded" />
                <div className="h-2 w-12 bg-slate-700 rounded" />
              </div>
            ))}
          </div>
        )}

        {stats && (
          <>
            {/* Metriques principales */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <StatsCard
                titre="Revenus"
                valeur={stats.metriques.revenus}
                variation={stats.metriques.revenus_variation}
                suffixe=" $"
                icon="💰"
              />
              <StatsCard
                titre="Visites"
                valeur={stats.metriques.visites}
                variation={stats.metriques.visites_variation}
                icon="👁"
              />
              <StatsCard
                titre="Visiteurs"
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
                titre="Conversion"
                valeur={stats.metriques.taux_conversion}
                variation={stats.metriques.taux_variation}
                suffixe="%"
                icon="🎯"
              />
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <RevenusChart data={stats.serie_revenus} />
              <VisitesChart data={stats.serie_visites} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ConversionsChart data={stats.serie_leads} />
              <PipelineDonut pipeline={stats.pipeline} />
            </div>

            {/* Top pages */}
            {stats.top_pages && stats.top_pages.length > 0 && (
              <TopPagesBar pages={stats.top_pages} />
            )}

            {/* Bottom row: prochains RDV + nouvelles soumissions */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Prochains RDV */}
              <div className="bg-slate-800 border border-slate-700 rounded-xl">
                <div className="flex items-center justify-between p-5 border-b border-slate-700">
                  <h3 className="text-white font-semibold">Prochains rendez-vous</h3>
                  <Link href="/dashboard/calendrier" className="text-amber-400 hover:text-amber-300 text-sm transition">
                    Calendrier →
                  </Link>
                </div>
                <div className="divide-y divide-slate-700">
                  {stats.prochains_rdv.length === 0 ? (
                    <p className="text-slate-500 text-sm p-5">Aucun rendez-vous a venir</p>
                  ) : (
                    stats.prochains_rdv.map(rdv => (
                      <div key={rdv.id} className="flex items-center justify-between p-4">
                        <div>
                          <p className="text-white text-sm font-medium">{rdv.client_nom}</p>
                          <p className="text-slate-400 text-xs">
                            Jour 1: {new Date(rdv.jour1_date).toLocaleDateString('fr-CA')}
                            {rdv.jour1_slot ? ` (${rdv.jour1_slot})` : ''}
                          </p>
                          {rdv.jour2_date && (
                            <p className="text-slate-500 text-xs">
                              Jour 2: {new Date(rdv.jour2_date).toLocaleDateString('fr-CA')}
                              {rdv.jour2_slot ? ` (${rdv.jour2_slot})` : ''}
                            </p>
                          )}
                        </div>
                        <span className={`text-xs px-2 py-1 rounded font-medium ${
                          rdv.statut === 'confirme' ? 'bg-green-500/20 text-green-400' :
                          rdv.statut === 'en_attente' ? 'bg-amber-500/20 text-amber-400' :
                          'bg-slate-500/20 text-slate-400'
                        }`}>
                          {rdv.statut}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Nouvelles soumissions */}
              <div className="bg-slate-800 border border-slate-700 rounded-xl">
                <div className="flex items-center justify-between p-5 border-b border-slate-700">
                  <h3 className="text-white font-semibold">Nouvelles soumissions</h3>
                  <Link href="/dashboard/soumissions" className="text-amber-400 hover:text-amber-300 text-sm transition">
                    Voir tout →
                  </Link>
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
          </>
        )}
      </div>
    </PollingProvider>
  );
}

export default function DashboardPage() {
  return <DashboardContent />;
}
