'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
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
  approuve:   { label: 'Approuve',       cls: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  depot_paye: { label: 'Depot paye',     cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  planifie:   { label: 'Planifie',       cls: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' },
  en_cours:   { label: 'En cours',       cls: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  complete:   { label: 'Complete',       cls: 'bg-green-500/20 text-green-300 border-green-500/30' },
  facture:    { label: 'Facture',        cls: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
  paye:       { label: 'Paye',           cls: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' },
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
  if (!iso) return '';
  // Handle various date formats: "2026-03-30", "2026-03-30T...", etc.
  const dateStr = String(iso).slice(0, 10);
  const d = new Date(dateStr + 'T12:00:00');
  if (isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' });
}

function slotLabel(slot: string | null): string {
  if (slot === 'matin') return '8h-12h';
  if (slot === 'apres-midi') return '12h-16h';
  return slot || '';
}

function daysUntil(dateStr: string): number | null {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const clean = String(dateStr).slice(0, 10);
  const target = new Date(clean + 'T00:00:00');
  if (isNaN(target.getTime())) return null;
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function isThisWeek(dateStr: string): boolean {
  if (!dateStr) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayOfWeek = today.getDay();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);

  const clean = String(dateStr).slice(0, 10);
  const target = new Date(clean + 'T00:00:00');
  if (isNaN(target.getTime())) return false;
  return target >= startOfWeek && target <= endOfWeek;
}

/* ─── Photo Section ─── */
function PhotoSection({ quoteId, onPhotosChange }: { quoteId: number; onPhotosChange?: (counts: { avant: number; apres: number }) => void }) {
  const [photos, setPhotos] = useState<JobPhoto[]>([]);
  const [uploading, setUploading] = useState<'avant' | 'apres' | null>(null);
  const avantRef = useRef<HTMLInputElement>(null);
  const apresRef = useRef<HTMLInputElement>(null);

  const loadPhotos = useCallback(async () => {
    const res = await fetch(`/api/travaux/photos?quoteId=${quoteId}`);
    if (res.ok) {
      const json = await res.json();
      const list = json.data ?? [];
      setPhotos(list);
      onPhotosChange?.({
        avant: list.filter((p: JobPhoto) => p.type === 'avant').length,
        apres: list.filter((p: JobPhoto) => p.type === 'apres').length,
      });
    }
  }, [quoteId, onPhotosChange]);

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

/* ─── Hours Section ─── */
interface HourEntry { employee_nom: string; heures: number; type: string; date_travail: string }

function HoursSection({ quoteId }: { quoteId: number }) {
  const [hours, setHours] = useState<HourEntry[]>([]);
  const [totalHeures, setTotalHeures] = useState(0);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/equipe/heures?quote_id=${quoteId}`);
      if (res.ok) {
        const json = await res.json();
        const entries = (json.data ?? []) as HourEntry[];
        setHours(entries);
        setTotalHeures(entries.reduce((sum, e) => sum + Number(e.heures || 0), 0));
      }
    })();
  }, [quoteId]);

  // Group by date, then by employee
  const byDate: Record<string, Record<string, number>> = {};
  for (const h of hours) {
    const date = String(h.date_travail).slice(0, 10);
    if (!byDate[date]) byDate[date] = {};
    byDate[date][h.employee_nom] = (byDate[date][h.employee_nom] || 0) + Number(h.heures || 0);
  }
  const sortedDates = Object.keys(byDate).sort();

  // Total by employee
  const byEmployee: Record<string, number> = {};
  for (const h of hours) {
    byEmployee[h.employee_nom] = (byEmployee[h.employee_nom] || 0) + Number(h.heures || 0);
  }

  return (
    <div className="bg-slate-900/50 rounded-lg p-3 space-y-2">
      <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
        Heures du projet — {sortedDates.length} jour{sortedDates.length !== 1 ? 's' : ''} travaille{sortedDates.length !== 1 ? 's' : ''}
      </h4>
      {sortedDates.length > 0 ? (
        <div className="space-y-2">
          {sortedDates.map((date, i) => {
            const dayTotal = Object.values(byDate[date]).reduce((s, h) => s + h, 0);
            return (
              <div key={date} className="space-y-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500 font-medium">Jour {i + 1} — {formatDateFr(date)}</span>
                  <span className="text-xs text-slate-400">{dayTotal}h</span>
                </div>
                {Object.entries(byDate[date]).map(([nom, h]) => (
                  <div key={nom} className="flex items-center justify-between text-sm pl-2">
                    <span className="text-slate-300">{nom}</span>
                    <span className="text-white text-xs">{h}h</span>
                  </div>
                ))}
              </div>
            );
          })}
          <div className="flex items-center justify-between text-sm border-t border-slate-700 pt-1.5 mt-1">
            <span className="text-slate-400 font-medium">Total projet</span>
            <span className="text-amber-400 font-bold">{totalHeures}h</span>
          </div>
        </div>
      ) : (
        <p className="text-slate-600 text-xs">Aucune heure enregistree</p>
      )}
    </div>
  );
}

/* ─── Expenses Section ─── */
interface ExpenseEntry { id: number; fournisseur: string; montant_ttc: number; categorie: string; date_depense: string; description: string | null }

function ExpensesSection({ quoteId }: { quoteId: number }) {
  const [expenses, setExpenses] = useState<ExpenseEntry[]>([]);
  const [totalDepenses, setTotalDepenses] = useState(0);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/expenses?quote_id=${quoteId}`);
      if (res.ok) {
        const json = await res.json();
        const list = (json.data ?? json) as ExpenseEntry[];
        setExpenses(Array.isArray(list) ? list : []);
        setTotalDepenses((Array.isArray(list) ? list : []).reduce((sum, e) => sum + Number(e.montant_ttc || 0), 0));
      }
    })();
  }, [quoteId]);

  const CAT_LABEL: Record<string, string> = {
    materiaux: 'Materiaux', sous_traitance: 'Sous-trait.', transport: 'Transport',
    equipement: 'Equipement', marketing: 'Marketing', autre: 'Autre',
  };

  return (
    <div className="bg-slate-900/50 rounded-lg p-3 space-y-2">
      <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
        Depenses du projet — {expenses.length} facture{expenses.length !== 1 ? 's' : ''}
      </h4>
      {expenses.length > 0 ? (
        <div className="space-y-1">
          {expenses.map(e => (
            <div key={e.id} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-slate-300 truncate">{e.fournisseur}</span>
                <span className="text-slate-600 text-xs">{CAT_LABEL[e.categorie] || e.categorie}</span>
              </div>
              <span className="text-white font-medium whitespace-nowrap">{formatMoney(Number(e.montant_ttc))}</span>
            </div>
          ))}
          <div className="flex items-center justify-between text-sm border-t border-slate-700 pt-1.5 mt-1">
            <span className="text-slate-400 font-medium">Total depenses</span>
            <span className="text-red-400 font-bold">{formatMoney(totalDepenses)}</span>
          </div>
        </div>
      ) : (
        <p className="text-slate-600 text-xs">Aucune depense enregistree</p>
      )}
    </div>
  );
}

/* ─── Profit Section ─── */
function ProfitSection({ quoteId, total }: { quoteId: number; total: number }) {
  const [totalHeures, setTotalHeures] = useState(0);
  const [totalSalaires, setTotalSalaires] = useState(0);
  const [totalDepenses, setTotalDepenses] = useState(0);

  useEffect(() => {
    (async () => {
      // Get hours + salaries
      const hRes = await fetch(`/api/equipe/heures?quote_id=${quoteId}`);
      if (hRes.ok) {
        const json = await hRes.json();
        setTotalHeures(json.totals?.heures ?? 0);
        setTotalSalaires(json.totals?.montant ?? 0);
      }
      // Get expenses
      const eRes = await fetch(`/api/expenses?quote_id=${quoteId}`);
      if (eRes.ok) {
        const json = await eRes.json();
        const list = (json.data ?? json) as { montant_ttc: number }[];
        setTotalDepenses((Array.isArray(list) ? list : []).reduce((sum, e) => sum + Number(e.montant_ttc || 0), 0));
      }
    })();
  }, [quoteId]);

  const totalCouts = totalSalaires + totalDepenses;
  const profit = total - totalCouts;
  const margin = total > 0 ? Math.round((profit / total) * 100) : 0;

  return (
    <div className={`rounded-lg p-3 space-y-1.5 ${profit >= 0 ? 'bg-green-950/30 border border-green-800/30' : 'bg-red-950/30 border border-red-800/30'}`}>
      <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Profit du projet</h4>
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-400">Revenu</span>
        <span className="text-white font-medium">{formatMoney(total)}</span>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-400">Main d&apos;oeuvre ({totalHeures}h)</span>
        <span className="text-red-400">-{formatMoney(totalSalaires)}</span>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-400">Depenses materiaux</span>
        <span className="text-red-400">-{formatMoney(totalDepenses)}</span>
      </div>
      <div className="flex items-center justify-between text-sm border-t border-slate-700 pt-1.5 mt-1">
        <span className="text-white font-bold">Profit net</span>
        <span className={`font-bold ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {formatMoney(profit)} ({margin}%)
        </span>
      </div>
    </div>
  );
}

/* ─── Job Card ─── */
function JobCard({ job, onComplete }: { job: Travail; onComplete: () => void }) {
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [checkedItems, setCheckedItems] = useState<string[]>([]);
  const [photoCounts, setPhotoCounts] = useState({ avant: 0, apres: 0 });

  const handlePhotosChange = useCallback((counts: { avant: number; apres: number }) => {
    setPhotoCounts(counts);
  }, []);

  // Load photo counts on mount (even when collapsed)
  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/travaux/photos?quoteId=${job.id}`);
      if (res.ok) {
        const json = await res.json();
        const list = json.data ?? [];
        setPhotoCounts({
          avant: list.filter((p: JobPhoto) => p.type === 'avant').length,
          apres: list.filter((p: JobPhoto) => p.type === 'apres').length,
        });
      }
    })();
  }, [job.id]);

  const hasPhotosApres = photoCounts.apres > 0;
  const canComplete = REQUIRED_FOR_COMPLETE.every(k => checkedItems.includes(k)) && hasPhotosApres;

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
          <div className="flex items-center gap-2">
            <span className="text-[10px] bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded font-mono">Projet #{job.id}</span>
            <h3 className="text-white font-semibold text-base">{job.client_nom}</h3>
          </div>
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

      {/* Photo counter + Expand/Collapse toggle */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-slate-500 hover:text-slate-300 transition"
        >
          {expanded ? '▾ Masquer details' : '▸ Photos, checklist & heures'}
        </button>
        <div className="flex items-center gap-2 text-xs">
          {photoCounts.avant > 0 && (
            <span className="text-slate-400">{photoCounts.avant} avant</span>
          )}
          {photoCounts.apres > 0 && (
            <span className="text-green-400">{photoCounts.apres} apres</span>
          )}
          {photoCounts.avant === 0 && photoCounts.apres === 0 && (
            <span className="text-red-400/70">Aucune photo</span>
          )}
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="space-y-3">
          <PhotoSection quoteId={job.id} onPhotosChange={handlePhotosChange} />
          <HoursSection quoteId={job.id} />
          <ExpensesSection quoteId={job.id} />
          <ChecklistSection quoteId={job.id} onChecklistChange={setCheckedItems} />
          <ProfitSection quoteId={job.id} total={Number(job.total)} />
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
            href={`/dashboard/devis/${job.id}`}
            className="bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-medium px-3 py-2 rounded-lg transition"
          >
            Modifier
          </Link>
          <button
            onClick={handleComplete}
            disabled={loading || !canComplete}
            title={!canComplete ? (!hasPhotosApres ? 'Ajoutez au moins 1 photo apres avant de completer' : 'Completez la checklist avant de completer') : ''}
            className="bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            {loading ? 'En cours...' : 'Marquer complete'}
          </button>
        </div>
      </div>

      {/* Hint if button disabled */}
      {!canComplete && (
        <p className="text-xs text-slate-500 text-right">
          {!hasPhotosApres
            ? <>Ajoutez des photos apres pour pouvoir completer</>
            : <>Cochez &quot;Photos apres prises&quot; et &quot;Client satisfait&quot; pour completer</>
          }
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
/* ─── Completed Job Card (read-only) ─── */
function CompletedJobCard({ job, autoExpand }: { job: Travail; autoExpand?: boolean }) {
  const [expanded, setExpanded] = useState(autoExpand ?? false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoExpand && cardRef.current) {
      cardRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [autoExpand]);

  return (
    <div ref={cardRef} className={`bg-slate-800/60 border rounded-xl p-5 space-y-3 ${autoExpand ? 'border-amber-500/50 ring-1 ring-amber-500/20' : 'border-slate-700/50'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded font-mono">Projet #{job.id}</span>
            <h3 className="text-white font-semibold text-base">{job.client_nom}</h3>
          </div>
          {job.client_adresse && (
            <p className="text-slate-500 text-sm">{job.client_adresse}</p>
          )}
        </div>
        <span className="text-xs font-medium px-2.5 py-1 rounded-full border bg-green-500/20 text-green-300 border-green-500/30 whitespace-nowrap">
          Termine
        </span>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span className="text-slate-300">
          {SERVICE_LABEL[job.type_service] || job.type_service} — {job.superficie} pi2
        </span>
      </div>

      {job.jour1_date && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span>Realise: {formatDateFr(job.jour1_date)}</span>
          {job.jour2_date && <span>— {formatDateFr(job.jour2_date)}</span>}
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span className="text-slate-400">Total: <span className="text-white font-medium">{formatMoney(Number(job.total))}</span></span>
      </div>

      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 font-semibold text-sm py-3 px-4 rounded-lg border border-amber-500/30 transition"
      >
        {expanded ? `▾ Masquer rapport projet #${job.id}` : `▸ Voir rapport projet #${job.id}`}
      </button>

      {expanded && (
        <div className="space-y-3">
          <PhotoSection quoteId={job.id} />
          <HoursSection quoteId={job.id} />
          <ExpensesSection quoteId={job.id} />
          <ProfitSection quoteId={job.id} total={Number(job.total)} />
        </div>
      )}

      <div className="flex justify-end">
        <Link
          href={`/dashboard/devis/${job.id}`}
          className="bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-medium px-3 py-2 rounded-lg transition"
        >
          Voir devis
        </Link>
      </div>
    </div>
  );
}

function PageContent() {
  const searchParams = useSearchParams();
  const projetParam = searchParams.get('projet');
  const [data, setData] = useState<Travail[]>([]);
  const [tab, setTab] = useState<'actifs' | 'termines'>('actifs');
  const [focusProjet, setFocusProjet] = useState<number | null>(projetParam ? parseInt(projetParam) : null);

  const load = useCallback(async () => {
    const res = await fetch('/api/travaux');
    if (!res.ok) return;
    const json = await res.json();
    setData(json.data ?? []);
  }, []);

  // Auto-switch tab if focused project is in completed
  useEffect(() => {
    if (focusProjet && data.length > 0) {
      const job = data.find(j => j.id === focusProjet);
      if (job?.statut === 'complete') setTab('termines');
    }
  }, [focusProjet, data]);

  // Split active vs completed
  const activeJobs = data.filter(j => j.statut !== 'complete');
  const completedJobs = data.filter(j => j.statut === 'complete');

  // Group active jobs
  const thisWeek: Travail[] = [];
  const upcoming: Travail[] = [];
  const noDates: Travail[] = [];

  for (const job of activeJobs) {
    if (!job.jour1_date) {
      noDates.push(job);
    } else if (isThisWeek(job.jour1_date)) {
      thisWeek.push(job);
    } else {
      upcoming.push(job);
    }
  }

  const tabCls = (t: 'actifs' | 'termines') =>
    `px-4 py-2 text-sm font-medium rounded-lg transition ${
      tab === t
        ? 'bg-amber-500 text-black'
        : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
    }`;

  return (
    <PollingProvider onRefresh={load}>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-2xl font-bold text-white">Travaux</h2>
          <div className="flex items-center gap-2">
            <button onClick={() => setTab('actifs')} className={tabCls('actifs')}>
              En cours ({activeJobs.length})
            </button>
            <button onClick={() => setTab('termines')} className={tabCls('termines')}>
              Termines ({completedJobs.length})
            </button>
          </div>
        </div>

        {tab === 'actifs' && (
          <>
            {activeJobs.length === 0 && (
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-12 text-center">
                <p className="text-slate-500 text-sm">Aucun travail en cours</p>
              </div>
            )}
            <Section title="Cette semaine" jobs={thisWeek} onRefresh={load} />
            <Section title="Prochaines semaines" jobs={upcoming} onRefresh={load} />
            <Section title="En attente de dates" jobs={noDates} onRefresh={load} />
          </>
        )}

        {tab === 'termines' && (
          <>
            {completedJobs.length === 0 && (
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-12 text-center">
                <p className="text-slate-500 text-sm">Aucun projet termine pour le moment</p>
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {completedJobs.map(job => (
                <CompletedJobCard key={job.id} job={job} autoExpand={focusProjet === job.id} />
              ))}
            </div>
          </>
        )}
      </div>
    </PollingProvider>
  );
}

export default function TravauxPage() {
  return <PageContent />;
}
