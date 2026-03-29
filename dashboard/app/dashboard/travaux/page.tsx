'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { PollingProvider } from '@/components/polling-provider';
import { formatMoney } from '@/lib/pricing';
import Link from 'next/link';

/* ─── Types ─── */
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

interface JobPhoto {
  id: number;
  quote_id: number;
  type: 'avant' | 'apres';
  url: string;
  filename: string;
  created_at: string;
}

/* ─── Constants ─── */
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

const CHECKLIST_ITEMS = [
  { key: 'photos_avant', label: 'Photos avant prises' },
  { key: 'prep_surface', label: 'Preparation surface terminee' },
  { key: 'epoxy_jour1', label: 'Application epoxy jour 1' },
  { key: 'finition_jour2', label: 'Finition jour 2' },
  { key: 'photos_apres', label: 'Photos apres prises' },
  { key: 'nettoyage', label: 'Nettoyage du chantier' },
  { key: 'client_satisfait', label: 'Client satisfait' },
];

const REQUIRED_FOR_COMPLETE = ['photos_apres', 'client_satisfait'];

/* ─── Helpers ─── */
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

/* ─── Photo Section ─── */
function PhotoSection({ quoteId }: { quoteId: number }) {
  const [photos, setPhotos] = useState<JobPhoto[]>([]);
  const [uploading, setUploading] = useState<'avant' | 'apres' | null>(null);
  const avantRef = useRef<HTMLInputElement>(null);
  const apresRef = useRef<HTMLInputElement>(null);

  const loadPhotos = useCallback(async () => {
    const res = await fetch(`/api/travaux/photos?quoteId=${quoteId}`);
    if (res.ok) {
      const json = await res.json();
      setPhotos(json.data ?? []);
    }
  }, [quoteId]);

  useEffect(() => { loadPhotos(); }, [loadPhotos]);

  async function handleUpload(type: 'avant' | 'apres', file: File) {
    setUploading(type);
    try {
      const form = new FormData();
      form.append('quoteId', String(quoteId));
      form.append('type', type);
      form.append('photo', file);
      const res = await fetch('/api/travaux/photos', { method: 'POST', body: form });
      if (res.ok) loadPhotos();
      else alert('Erreur lors du telechargement');
    } catch {
      alert('Erreur reseau');
    } finally {
      setUploading(null);
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Supprimer cette photo?')) return;
    await fetch(`/api/travaux/photos?id=${id}`, { method: 'DELETE' });
    loadPhotos();
  }

  const avantPhotos = photos.filter(p => p.type === 'avant');
  const apresPhotos = photos.filter(p => p.type === 'apres');

  return (
    <div className="bg-slate-900/50 rounded-lg p-3 space-y-2">
      <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Photos du chantier</h4>
      <div className="grid grid-cols-2 gap-3">
        {/* Avant */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-slate-300 text-xs font-medium">Avant</span>
            <button
              onClick={() => avantRef.current?.click()}
              disabled={uploading === 'avant'}
              className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded transition disabled:opacity-50"
            >
              {uploading === 'avant' ? '...' : '+ Photo'}
            </button>
            <input
              ref={avantRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) handleUpload('avant', f);
                e.target.value = '';
              }}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {avantPhotos.map(p => (
              <div key={p.id} className="relative group">
                <img
                  src={p.url}
                  alt={p.filename}
                  className="w-16 h-16 object-cover rounded border border-slate-600"
                />
                <button
                  onClick={() => handleDelete(p.id)}
                  className="absolute -top-1 -right-1 bg-red-600 text-white rounded-full w-4 h-4 text-[10px] leading-none opacity-0 group-hover:opacity-100 transition"
                >
                  x
                </button>
              </div>
            ))}
            {avantPhotos.length === 0 && (
              <span className="text-slate-600 text-xs">Aucune photo</span>
            )}
          </div>
        </div>

        {/* Apres */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-slate-300 text-xs font-medium">Apres</span>
            <button
              onClick={() => apresRef.current?.click()}
              disabled={uploading === 'apres'}
              className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded transition disabled:opacity-50"
            >
              {uploading === 'apres' ? '...' : '+ Photo'}
            </button>
            <input
              ref={apresRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) handleUpload('apres', f);
                e.target.value = '';
              }}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {apresPhotos.map(p => (
              <div key={p.id} className="relative group">
                <img
                  src={p.url}
                  alt={p.filename}
                  className="w-16 h-16 object-cover rounded border border-slate-600"
                />
                <button
                  onClick={() => handleDelete(p.id)}
                  className="absolute -top-1 -right-1 bg-red-600 text-white rounded-full w-4 h-4 text-[10px] leading-none opacity-0 group-hover:opacity-100 transition"
                >
                  x
                </button>
              </div>
            ))}
            {apresPhotos.length === 0 && (
              <span className="text-slate-600 text-xs">Aucune photo</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Checklist Section ─── */
function ChecklistSection({ quoteId, onChecklistChange }: {
  quoteId: number;
  onChecklistChange: (checked: string[]) => void;
}) {
  const [checked, setChecked] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/travaux/checklist?quoteId=${quoteId}`);
      if (res.ok) {
        const json = await res.json();
        const items = json.checklist ?? [];
        setChecked(items);
        onChecklistChange(items);
      }
      setLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteId]);

  async function toggle(key: string) {
    const next = checked.includes(key)
      ? checked.filter(k => k !== key)
      : [...checked, key];
    setChecked(next);
    onChecklistChange(next);

    await fetch('/api/travaux/checklist', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quoteId, checklist: next }),
    });
  }

  if (!loaded) return null;

  return (
    <div className="bg-slate-900/50 rounded-lg p-3 space-y-2">
      <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Checklist</h4>
      <div className="space-y-1">
        {CHECKLIST_ITEMS.map(item => (
          <label key={item.key} className="flex items-center gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={checked.includes(item.key)}
              onChange={() => toggle(item.key)}
              className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-amber-500 focus:ring-amber-500/50"
            />
            <span className={`text-sm transition ${
              checked.includes(item.key)
                ? 'text-green-400 line-through'
                : 'text-slate-300 group-hover:text-white'
            }`}>
              {item.label}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

/* ─── Job Card ─── */
function JobCard({ job, onComplete }: { job: Travail; onComplete: () => void }) {
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [checkedItems, setCheckedItems] = useState<string[]>([]);

  const canComplete = REQUIRED_FOR_COMPLETE.every(k => checkedItems.includes(k));

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
      {/* Header */}
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

      {/* Dates */}
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

      {/* Financials */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span className="text-slate-400">Total: <span className="text-white font-medium">{formatMoney(Number(job.total))}</span></span>
        <span className="text-slate-400">Depot: <span className="text-emerald-400">{formatMoney(Number(job.depot_requis))}</span></span>
        <span className="text-slate-400">Solde: <span className="text-amber-400 font-medium">{formatMoney(balance)}</span></span>
      </div>

      {/* Expand/Collapse toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-slate-500 hover:text-slate-300 transition w-full text-left"
      >
        {expanded ? '▾ Masquer details' : '▸ Photos, checklist & heures'}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="space-y-3">
          <PhotoSection quoteId={job.id} />
          <ChecklistSection quoteId={job.id} onChecklistChange={setCheckedItems} />
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-1 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          {daysLabel && (
            <span className={`text-sm font-medium ${days !== null && days <= 1 ? 'text-amber-400' : 'text-slate-400'}`}>
              {daysLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/dashboard/equipe?projet=${job.id}`}
            className="bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-medium px-3 py-2 rounded-lg transition"
          >
            + Heures
          </Link>
          <button
            onClick={handleComplete}
            disabled={loading || !canComplete}
            title={!canComplete ? 'Completez "Photos apres" et "Client satisfait" dans la checklist' : ''}
            className="bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            {loading ? 'En cours...' : 'Marquer complete'}
          </button>
        </div>
      </div>

      {/* Hint if button disabled */}
      {expanded && !canComplete && (
        <p className="text-xs text-slate-500 text-right">
          Cochez &quot;Photos apres prises&quot; et &quot;Client satisfait&quot; pour completer
        </p>
      )}
    </div>
  );
}

/* ─── Section ─── */
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

/* ─── Page ─── */
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
