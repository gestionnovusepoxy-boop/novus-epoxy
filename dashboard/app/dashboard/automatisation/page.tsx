'use client';

import { useState, useEffect, useCallback } from 'react';

// Cron labels no longer needed — API returns label + schedule directly

const STATUT_LABELS: Record<string, string> = {
  brouillon: 'Brouillon',
  envoye: 'Envoye',
  contrat_signe: 'Signe',
  depot_paye: 'Depot paye',
  planifie: 'Planifie',
  complete: 'Complete',
  refuse: 'Refuse',
  annule: 'Annule',
};

interface AutoData {
  crons: { path: string; label: string; schedule: string; status: 'actif' | 'manquant'; missing?: boolean }[];
  missingCrons?: string[];
  sms: { total: number; sent: number; failed: number };
  emails: { total: number; delivered: number; opened: number; bounced: number };
  leads: { today: number; total: number; prospected: number };
  quotes: { statut: string; cnt: number }[];
  bookings: number;
  agentMemories: { key: string; cnt: number }[];
  submissions: number;
  conversations: number;
}

function StatusDot({ status }: { status: 'green' | 'yellow' | 'red' }) {
  const colors = {
    green: 'bg-green-400 shadow-green-400/50',
    yellow: 'bg-yellow-400 shadow-yellow-400/50',
    red: 'bg-red-400 shadow-red-400/50',
  };
  return (
    <span className={`inline-block w-2.5 h-2.5 rounded-full shadow-lg ${colors[status]}`} />
  );
}

// Status helpers removed — crons are now shown with their Vercel schedule

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="w-full bg-slate-700 rounded-full h-2.5">
      <div
        className="h-2.5 rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

export default function AutomatisationPage() {
  const [data, setData] = useState<AutoData | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/automation');
      if (res.ok) {
        setData(await res.json());
        setLastUpdate(new Date());
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold text-white">Automatisation</h2>
          <p className="text-slate-400 text-sm mt-0.5">Tout ce qui roule automatiquement</p>
        </div>
        <div className="text-right">
          {lastUpdate && (
            <p className="text-slate-500 text-xs">
              Derniere mise a jour: {lastUpdate.toLocaleTimeString('fr-CA')}
            </p>
          )}
          <button
            onClick={load}
            className="text-amber-400 text-xs hover:text-amber-300 transition-colors mt-1"
          >
            Rafraichir
          </button>
        </div>
      </div>

      {/* Loading skeleton */}
      {loading && !data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-slate-800 border border-slate-700 rounded-xl p-5 animate-pulse">
              <div className="h-3 w-16 bg-slate-700 rounded mb-3" />
              <div className="h-8 w-24 bg-slate-700 rounded" />
            </div>
          ))}
        </div>
      )}

      {data && (
        <>
          {/* Row 1: Quick KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              <div className="flex items-center gap-2">
                <StatusDot status={data.leads.today > 0 ? 'green' : 'yellow'} />
                <p className="text-slate-400 text-[10px] uppercase tracking-wider">Leads aujourd'hui</p>
              </div>
              <p className="text-2xl font-bold text-white mt-2">{data.leads.today}</p>
              <p className="text-slate-500 text-xs mt-1">{data.leads.total} total / {data.leads.prospected} prospectes</p>
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              <div className="flex items-center gap-2">
                <StatusDot status={data.sms.failed > 5 ? 'red' : data.sms.failed > 0 ? 'yellow' : 'green'} />
                <p className="text-slate-400 text-[10px] uppercase tracking-wider">SMS aujourd'hui</p>
              </div>
              <p className="text-2xl font-bold text-white mt-2">{data.sms.sent}</p>
              <p className="text-slate-500 text-xs mt-1">{data.sms.failed} echoues</p>
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              <div className="flex items-center gap-2">
                <StatusDot status={data.emails.bounced > 3 ? 'red' : data.emails.bounced > 0 ? 'yellow' : 'green'} />
                <p className="text-slate-400 text-[10px] uppercase tracking-wider">Emails aujourd'hui</p>
              </div>
              <p className="text-2xl font-bold text-white mt-2">{data.emails.total}</p>
              <p className="text-slate-500 text-xs mt-1">{data.emails.delivered} livres / {data.emails.opened} ouverts</p>
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              <div className="flex items-center gap-2">
                <StatusDot status={data.conversations > 0 ? 'green' : 'yellow'} />
                <p className="text-slate-400 text-[10px] uppercase tracking-wider">Conversations</p>
              </div>
              <p className="text-2xl font-bold text-blue-400 mt-2">{data.conversations}</p>
              <p className="text-slate-500 text-xs mt-1">actives</p>
            </div>

            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              <div className="flex items-center gap-2">
                <StatusDot status="green" />
                <p className="text-slate-400 text-[10px] uppercase tracking-wider">Soumissions</p>
              </div>
              <p className="text-2xl font-bold text-amber-400 mt-2">{data.submissions}</p>
              <p className="text-slate-500 text-xs mt-1">aujourd'hui</p>
            </div>
          </div>

          {/* Row 2: Crons + SMS limit */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Crons */}
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-white font-semibold text-sm">Taches automatiques (Crons)</h3>
                <span className="text-xs text-slate-400">
                  {data.crons.filter(c => c.status === 'actif').length}/{data.crons.length} actifs
                  {data.missingCrons && data.missingCrons.length > 0 && (
                    <span className="text-red-400 ml-2">{data.missingCrons.length} manquants</span>
                  )}
                </span>
              </div>
              {data.crons.length === 0 ? (
                <p className="text-slate-500 text-sm">Aucune donnee de cron trouvee</p>
              ) : (
                <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                  {data.crons.map(c => {
                    const isActive = c.status === 'actif';
                    return (
                      <div key={c.path} className="flex items-center justify-between py-1.5 border-b border-slate-700/50 last:border-0">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <StatusDot status={isActive ? 'green' : 'red'} />
                          <p className="text-white text-sm truncate">{c.label}</p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-slate-400 text-xs">{c.schedule}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            isActive ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                          }`}>
                            {isActive ? 'Actif' : 'Arrete'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* SMS Limit */}
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4">
              <h3 className="text-white font-semibold text-sm">SMS — Limite quotidienne</h3>
              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="text-slate-400">{data.sms.total} / 100 envoyes</span>
                  <span className={`font-medium ${data.sms.total >= 90 ? 'text-red-400' : data.sms.total >= 70 ? 'text-yellow-400' : 'text-green-400'}`}>
                    {data.sms.total}%
                  </span>
                </div>
                <ProgressBar
                  value={data.sms.total}
                  max={100}
                  color={data.sms.total >= 90 ? '#f87171' : data.sms.total >= 70 ? '#fbbf24' : '#4ade80'}
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-green-400">{data.sms.sent}</p>
                  <p className="text-[10px] text-slate-400">Envoyes</p>
                </div>
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-red-400">{data.sms.failed}</p>
                  <p className="text-[10px] text-slate-400">Echoues</p>
                </div>
                <div className="bg-slate-500/10 border border-slate-500/20 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-slate-300">{100 - data.sms.total}</p>
                  <p className="text-[10px] text-slate-400">Restants</p>
                </div>
              </div>
            </div>
          </div>

          {/* Row 3: Emails + Pipeline */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Emails today */}
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">
              <h3 className="text-white font-semibold text-sm">Emails aujourd'hui</h3>
              <div className="grid grid-cols-4 gap-2">
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-blue-400">{data.emails.total}</p>
                  <p className="text-[10px] text-slate-400">Total</p>
                </div>
                <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-green-400">{data.emails.delivered}</p>
                  <p className="text-[10px] text-slate-400">Livres</p>
                </div>
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-amber-400">{data.emails.opened}</p>
                  <p className="text-[10px] text-slate-400">Ouverts</p>
                </div>
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-center">
                  <p className="text-lg font-bold text-red-400">{data.emails.bounced}</p>
                  <p className="text-[10px] text-slate-400">Rebonds</p>
                </div>
              </div>
            </div>

            {/* Pipeline devis */}
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">
              <h3 className="text-white font-semibold text-sm">Pipeline devis</h3>
              {data.quotes.length === 0 ? (
                <p className="text-slate-500 text-sm">Aucun devis</p>
              ) : (
                <div className="space-y-2">
                  {data.quotes.map(q => {
                    const maxCnt = Math.max(...data.quotes.map(x => x.cnt));
                    const colors: Record<string, string> = {
                      brouillon: '#64748b', envoye: '#3b82f6', contrat_signe: '#f59e0b',
                      depot_paye: '#22c55e', planifie: '#06b6d4', complete: '#10b981',
                      refuse: '#ef4444', annule: '#6b7280',
                    };
                    return (
                      <div key={q.statut} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-300">{STATUT_LABELS[q.statut] || q.statut}</span>
                          <span className="text-white font-medium">{q.cnt}</span>
                        </div>
                        <ProgressBar value={q.cnt} max={maxCnt} color={colors[q.statut] || '#64748b'} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Row 4: Bookings + Agent Memories */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Reservations */}
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">
              <h3 className="text-white font-semibold text-sm">Reservations actives</h3>
              <div className="flex items-center gap-4">
                <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-lg p-4 text-center flex-1">
                  <p className="text-3xl font-bold text-cyan-400">{data.bookings}</p>
                  <p className="text-xs text-slate-400 mt-1">en attente ou confirmees</p>
                </div>
              </div>
            </div>

            {/* Agent Memories */}
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">
              <h3 className="text-white font-semibold text-sm">Memoire des agents</h3>
              {data.agentMemories.length === 0 ? (
                <p className="text-slate-500 text-sm">Aucune memoire stockee</p>
              ) : (
                <div className="space-y-2">
                  {data.agentMemories.map(m => {
                    const agentName = m.key.replace('agent_memory_', '').replace(/_/g, ' ');
                    return (
                      <div key={m.key} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <StatusDot status="green" />
                          <span className="text-white capitalize">{agentName}</span>
                        </div>
                        <span className="text-slate-400 text-xs">{m.cnt} entrees</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
