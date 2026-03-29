'use client';

import { useState, useCallback } from 'react';
import { PollingProvider } from '@/components/polling-provider';
import { formatMoney } from '@/lib/pricing';

interface Travail {
  id: number;
  client_nom: string;
  client_email: string;
  client_tel: string | null;
  client_adresse: string | null;
  type_service: string;
  superficie: number;
  total: number;
  depot_requis: number;
  statut: string;
  jour1_date: string | null;
  jour2_date: string | null;
  jour1_slot: string | null;
  jour2_slot: string | null;
  booking_statut: string | null;
}

const SERVICE_LABEL: Record<string, string> = {
  flake: 'Flocon',
  metallique: 'Metallique',
  commercial: 'Commercial',
  couleur_unie: 'Couleur unie',
  quartz: 'Quartz',
  antiderapant: 'Antiderapant',
  meulage: 'Meulage au diamant',
};

const STATUT_BADGE: Record<string, { label: string; cls: string }> = {
  depot_paye: { label: 'Depot paye', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  planifie:   { label: 'Planifie',   cls: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' },
  complete:   { label: 'Complete',   cls: 'bg-green-500/20 text-green-300 border-green-500/30' },
};

function formatDateFr(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' });
}

function slotLabel(slot: string | null): string {
  if (slot === 'matin') return '8h-12h';
  if (slot === 'apres-midi') return '12h-16h';
  return slot || '';
}

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function isThisWeek(dateStr: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayOfWeek = today.getDay();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);

  const target = new Date(dateStr + 'T00:00:00');
  return target >= startOfWeek && target <= endOfWeek;
}

function JobCard({ job, onComplete }: { job: Travail; onComplete: () => void }) {
  const [loading, setLoading] = useState(false);

  async function handleComplete() {
    if (!confirm(`Marquer le travail de ${job.client_nom} comme complete?`)) return;
    setLoading(true);
    try {
      await fetch('/api/travaux/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteId: job.id }),
      });
      onComplete();
    } catch {
      alert('Erreur lors de la mise a jour.');
    } finally {
      setLoading(false);
    }
  }

  const badge = STATUT_BADGE[job.statut] || STATUT_BADGE.depot_paye;
  const balance = Number(job.total) - Number(job.depot_requis);
  const days = job.jour1_date ? daysUntil(job.jour1_date) : null;

  let daysLabel = '';
  if (days !== null) {
    if (days === 0) daysLabel = 'Aujourd\'hui';
    else if (days === 1) daysLabel = 'Demain';
    else if (days < 0) daysLabel = 'En cours';
    else daysLabel = `Dans ${days} jours`;
  }

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3 hover:border-slate-600 transition">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-white font-semibold text-base">{job.client_nom}</h3>
          {job.client_tel && (
            <a href={`tel:${job.client_tel}`} className="text-amber-400 text-sm hover:underline">
              {job.client_tel}
            </a>
          )}
        </div>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full border whitespace-nowrap ${badge.cls}`}>
          {badge.label}
        </span>
      </div>

      {job.client_adresse && (
        <p className="text-slate-400 text-sm">{job.client_adresse}</p>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span className="text-slate-300">
          {SERVICE_LABEL[job.type_service] || job.type_service} — {job.superficie} pi2
        </span>
      </div>

      {job.jour1_date && (
        <div className="bg-slate-900/50 rounded-lg p-3 space-y-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Jour 1:</span>
            <span className="text-white font-medium">{formatDateFr(job.jour1_date)}</span>
            <span className="text-slate-400">{slotLabel(job.jour1_slot)}</span>
          </div>
          {job.jour2_date && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-500">Jour 2:</span>
              <span className="text-white font-medium">{formatDateFr(job.jour2_date)}</span>
              <span className="text-slate-400">{slotLabel(job.jour2_slot)}</span>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span className="text-slate-400">Total: <span className="text-white font-medium">{formatMoney(Number(job.total))}</span></span>
        <span className="text-slate-400">Depot: <span className="text-emerald-400">{formatMoney(Number(job.depot_requis))}</span></span>
        <span className="text-slate-400">Solde: <span className="text-amber-400 font-medium">{formatMoney(balance)}</span></span>
      </div>

      <div className="flex items-center justify-between pt-1">
        {daysLabel && (
          <span className={`text-sm font-medium ${days !== null && days <= 1 ? 'text-amber-400' : 'text-slate-400'}`}>
            {daysLabel}
          </span>
        )}
        {!daysLabel && <span />}
        <button
          onClick={handleComplete}
          disabled={loading}
          className="bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
        >
          {loading ? 'En cours...' : 'Marquer complete'}
        </button>
      </div>
    </div>
  );
}

function Section({ title, jobs, onRefresh }: { title: string; jobs: Travail[]; onRefresh: () => void }) {
  if (jobs.length === 0) return null;
  return (
    <div className="space-y-3">
      <h3 className="text-slate-400 text-sm font-semibold uppercase tracking-wider">{title}</h3>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {jobs.map(job => (
          <JobCard key={job.id} job={job} onComplete={onRefresh} />
        ))}
      </div>
    </div>
  );
}

function PageContent() {
  const [data, setData] = useState<Travail[]>([]);

  const load = useCallback(async () => {
    const res = await fetch('/api/travaux');
    if (!res.ok) return;
    const json = await res.json();
    setData(json.data ?? []);
  }, []);

  // Group jobs
  const thisWeek: Travail[] = [];
  const upcoming: Travail[] = [];
  const noDates: Travail[] = [];

  for (const job of data) {
    if (!job.jour1_date) {
      noDates.push(job);
    } else if (isThisWeek(job.jour1_date)) {
      thisWeek.push(job);
    } else {
      upcoming.push(job);
    }
  }

  return (
    <PollingProvider onRefresh={load}>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">Travaux en cours</h2>
          <span className="text-slate-400 text-sm">{data.length} travaux actifs</span>
        </div>

        {data.length === 0 && (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-12 text-center">
            <p className="text-slate-500 text-sm">Aucun travail en cours</p>
          </div>
        )}

        <Section title="Cette semaine" jobs={thisWeek} onRefresh={load} />
        <Section title="Prochaines semaines" jobs={upcoming} onRefresh={load} />
        <Section title="En attente de dates" jobs={noDates} onRefresh={load} />
      </div>
    </PollingProvider>
  );
}

export default function TravauxPage() {
  return <PageContent />;
}
