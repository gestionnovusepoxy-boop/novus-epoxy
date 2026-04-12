'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { PollingProvider } from '@/components/polling-provider';
import { formatMoney } from '@/lib/pricing';
import { getQuebecDate } from '@/lib/timezone';
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
  prix_pied_carre: number;
  sous_total: number;
  tps: number;
  tvq: number;
  total: number;
  depot_requis: number;
  rabais_pct: number | null;
  rabais_montant: number | null;
  deposit_paid_at?: string | null;
  balance_paid_at?: string | null;
  contrat_signe_at?: string | null;
  statut: string;
  jour1_date: string | null;
  jour2_date: string | null;
  jour1_slot: string | null;
  jour2_slot: string | null;
  booking_statut: string | null;
  invoice_id: number | null;
  invoice_numero: string | null;
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
  // Use Quebec timezone for "today" reference
  const todayStr = getQuebecDate();
  const today = new Date(todayStr + 'T00:00:00');
  const clean = String(dateStr).slice(0, 10);
  const target = new Date(clean + 'T00:00:00');
  if (isNaN(target.getTime())) return null;
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function formatDateShortFr(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
  if (isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
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
  const [viewingPhoto, setViewingPhoto] = useState<{ url: string; label: string } | null>(null);
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
                  className="w-16 h-16 object-cover rounded border border-slate-600 cursor-pointer hover:border-amber-500 transition"
                  onClick={() => setViewingPhoto({ url: p.url, label: `Avant — ${p.filename}` })}
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
                  className="w-16 h-16 object-cover rounded border border-slate-600 cursor-pointer hover:border-green-500 transition"
                  onClick={() => setViewingPhoto({ url: p.url, label: `Apres — ${p.filename}` })}
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
      {viewingPhoto && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setViewingPhoto(null)}>
          <div className="relative max-w-4xl w-full max-h-[90vh] flex flex-col items-center" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between w-full mb-3">
              <h3 className="text-white font-bold text-lg">{viewingPhoto.label}</h3>
              <button onClick={() => setViewingPhoto(null)} className="w-10 h-10 bg-slate-800 hover:bg-slate-700 text-white rounded-full flex items-center justify-center text-xl transition">&times;</button>
            </div>
            <img src={viewingPhoto.url} alt={viewingPhoto.label} className="max-h-[80vh] w-auto rounded-xl border border-slate-700 object-contain" />
          </div>
        </div>
      )}
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
interface ExpenseEntry { id: number; fournisseur: string; montant_ttc: number; categorie: string; date_depense: string; description: string | null; receipt_url: string | null }

function ExpensesSection({ quoteId }: { quoteId: number }) {
  const [expenses, setExpenses] = useState<ExpenseEntry[]>([]);
  const [totalDepenses, setTotalDepenses] = useState(0);
  const [viewingReceipt, setViewingReceipt] = useState<{ url: string; fournisseur: string } | null>(null);

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
    <>
      <div className="bg-slate-900/50 rounded-lg p-3 space-y-2">
        <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
          Depenses du projet — {expenses.length} facture{expenses.length !== 1 ? 's' : ''}
        </h4>
        {expenses.length > 0 ? (
          <div className="space-y-1">
            {expenses.map(e => (
              <div key={e.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  {e.receipt_url && (
                    <button
                      onClick={() => setViewingReceipt({ url: e.receipt_url!, fournisseur: e.fournisseur })}
                      className="flex-shrink-0 w-6 h-6 rounded bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 hover:bg-amber-500/30 transition"
                      title="Voir la facture"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    </button>
                  )}
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
      {viewingReceipt && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setViewingReceipt(null)}>
          <div className="relative max-w-3xl w-full max-h-[90vh] flex flex-col items-center" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between w-full mb-3">
              <h3 className="text-white font-bold text-lg">Facture — {viewingReceipt.fournisseur}</h3>
              <button onClick={() => setViewingReceipt(null)} className="w-10 h-10 bg-slate-800 hover:bg-slate-700 text-white rounded-full flex items-center justify-center text-xl transition">&times;</button>
            </div>
            <img src={viewingReceipt.url} alt={`Facture ${viewingReceipt.fournisseur}`} className="max-h-[80vh] w-auto rounded-xl border border-slate-700 object-contain" />
          </div>
        </div>
      )}
    </>
  );
}

/* ─── Profit Section ─── */
function ProfitSection({ job }: { job: Travail }) {
  const quoteId = job.id;
  const sousTotal = Number(job.sous_total);
  const prixPiedCarre = Number(job.prix_pied_carre || 0);
  const superficie = Number(job.superficie || 0);
  const rabaisPct = Number(job.rabais_pct || 0);
  const rabaisMontant = Number(job.rabais_montant || 0);

  // Compute "prix de base avant rabais": if we have price × area, use that; otherwise infer from sousTotal + rabais
  const prixBase = prixPiedCarre > 0 && superficie > 0
    ? prixPiedCarre * superficie
    : sousTotal + rabaisMontant;
  const hasRabais = rabaisMontant > 0 || rabaisPct > 0;

  const [totalHeures, setTotalHeures] = useState(0);
  const [totalSalaires, setTotalSalaires] = useState(0);
  const [depenses, setDepenses] = useState<{ id: number; fournisseur: string; montant_ttc: number; receipt_url?: string | null }[]>([]);

  useEffect(() => {
    (async () => {
      const hRes = await fetch(`/api/equipe/heures?quote_id=${quoteId}`);
      if (hRes.ok) {
        const json = await hRes.json();
        setTotalHeures(json.totals?.heures ?? 0);
        setTotalSalaires(json.totals?.montant ?? 0);
      }
      const eRes = await fetch(`/api/expenses?quote_id=${quoteId}`);
      if (eRes.ok) {
        const json = await eRes.json();
        const list = (json.data ?? json) as { id: number; fournisseur: string; montant_ttc: number; receipt_url?: string | null }[];
        setDepenses(Array.isArray(list) ? list : []);
      }
    })();
  }, [quoteId]);

  const totalDepenses = depenses.reduce((sum, e) => sum + Number(e.montant_ttc || 0), 0);
  const totalCouts = totalSalaires + totalDepenses;
  const profit = sousTotal - totalCouts;
  const margin = sousTotal > 0 ? Math.round((profit / sousTotal) * 100) : 0;

  return (
    <div className={`rounded-lg p-3 space-y-1.5 ${profit >= 0 ? 'bg-green-950/30 border border-green-800/30' : 'bg-red-950/30 border border-red-800/30'}`}>
      <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Profit du projet</h4>

      {/* Revenue breakdown: base price, discount, subtotal */}
      {hasRabais && (
        <>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">
              Prix de base
              {prixPiedCarre > 0 && superficie > 0 && (
                <span className="text-slate-600"> ({formatMoney(prixPiedCarre)}/pi² × {superficie} pi²)</span>
              )}
            </span>
            <span className="text-white">{formatMoney(prixBase)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">
              Rabais{rabaisPct > 0 && <span className="text-slate-600"> ({rabaisPct}%)</span>}
            </span>
            <span className="text-amber-400">-{formatMoney(rabaisMontant)}</span>
          </div>
        </>
      )}
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-400">Sous-total <span className="text-slate-600">(avant taxes)</span></span>
        <span className="text-white font-medium">{formatMoney(sousTotal)}</span>
      </div>

      {/* Costs */}
      <div className="flex items-center justify-between text-sm border-t border-slate-700/50 pt-1.5 mt-1">
        <span className="text-slate-400">Main d&apos;oeuvre ({totalHeures}h)</span>
        <span className="text-red-400">-{formatMoney(totalSalaires)}</span>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-400">Depenses liees ({depenses.length})</span>
        <span className="text-red-400">-{formatMoney(totalDepenses)}</span>
      </div>

      {/* Detail of expenses */}
      {depenses.length > 0 && (
        <div className="pl-3 pt-1 space-y-0.5 border-l border-slate-700/50 ml-1">
          {depenses.map(d => (
            <div key={d.id} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 text-slate-500 min-w-0">
                {d.receipt_url ? (
                  <a href={d.receipt_url} target="_blank" rel="noopener" className="w-2 h-2 bg-amber-500 rounded-sm hover:bg-amber-400 flex-shrink-0" title="Voir la facture" />
                ) : (
                  <span className="w-2 h-2 bg-slate-700 rounded-sm flex-shrink-0" title="Pas de photo" />
                )}
                <span className="truncate">{d.fournisseur}</span>
              </div>
              <span className="text-slate-500">{formatMoney(Number(d.montant_ttc))}</span>
            </div>
          ))}
        </div>
      )}

      {/* Net profit */}
      <div className="flex items-center justify-between text-sm border-t border-slate-700 pt-1.5 mt-1">
        <span className="text-white font-bold">Profit net</span>
        <span className={`font-bold ${profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {formatMoney(profit)} ({margin}%)
        </span>
      </div>
      {profit !== 0 && (
        <div className="space-y-1 pt-1.5 mt-1 border-t border-slate-700/50">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">Luca &amp; Jason <span className="text-slate-500">(70%)</span></span>
            <span className={profit >= 0 ? 'text-green-400' : 'text-red-400'}>{formatMoney(profit * 0.7)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">Danny &amp; Brien <span className="text-slate-500">(30%)</span></span>
            <span className={profit >= 0 ? 'text-green-400' : 'text-red-400'}>{formatMoney(profit * 0.3)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Quick Actions Bar ─── */
function QuickActions({ job }: { job: Travail }) {
  const btn = 'flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition whitespace-nowrap';
  return (
    <div className="flex flex-wrap gap-1.5">
      {job.client_tel && (
        <a
          href={`tel:${job.client_tel}`}
          className={`${btn} bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/30`}
          title="Appeler le client"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
          Appeler
        </a>
      )}
      {job.client_email && (
        <a
          href={`mailto:${job.client_email}`}
          className={`${btn} bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border-sky-500/30`}
          title="Envoyer un email"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
          Email
        </a>
      )}
      {job.client_adresse && (
        <a
          href={mapsUrl(job.client_adresse)}
          target="_blank"
          rel="noopener noreferrer"
          className={`${btn} bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border-indigo-500/30`}
          title="Ouvrir dans Google Maps"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
          Maps
        </a>
      )}
      <Link
        href={`/dashboard/devis/${job.id}`}
        className={`${btn} bg-slate-700/60 hover:bg-slate-700 text-slate-200 border-slate-600`}
      >
        Devis
      </Link>
      {job.invoice_id ? (
        <Link
          href={`/dashboard/factures/${job.invoice_id}`}
          className={`${btn} bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/30`}
        >
          Facture {job.invoice_numero || ''}
        </Link>
      ) : (
        <Link
          href={`/dashboard/factures?create=${job.id}`}
          className={`${btn} bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border-purple-500/30`}
          title="Creer une facture pour ce projet"
        >
          + Facture
        </Link>
      )}
      <button
        onClick={() => window.print()}
        className={`${btn} bg-slate-700/60 hover:bg-slate-700 text-slate-200 border-slate-600 print:hidden`}
        title="Imprimer le rapport"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
        Imprimer
      </button>
    </div>
  );
}

/* ─── Entity Summary (devis/contrat/facture/paiements) ─── */
function EntitySummary({ job }: { job: Travail }) {
  const depotPaye = !!job.deposit_paid_at || job.statut === 'depot_paye' || job.statut === 'planifie' || job.statut === 'en_cours' || job.statut === 'complete' || job.statut === 'facture' || job.statut === 'paye';
  const soldePaye = !!job.balance_paid_at || job.statut === 'complete' || job.statut === 'paye';
  const contratSigne = !!job.contrat_signe_at || depotPaye;

  const row = (label: string, value: React.ReactNode, ok: boolean) => (
    <div className="flex items-center justify-between text-xs py-1 border-b border-slate-800/60 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className={`font-medium ${ok ? 'text-emerald-300' : 'text-slate-500'}`}>{value}</span>
    </div>
  );

  return (
    <div className="bg-slate-900/50 rounded-lg p-3">
      <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-1.5">Dossier projet</h4>
      {row('Devis', `#${job.id}`, true)}
      {row('Contrat', contratSigne ? 'Signe' : 'En attente', contratSigne)}
      {row(
        'Depot',
        depotPaye
          ? `${formatMoney(Number(job.depot_requis))}${job.deposit_paid_at ? ' — ' + formatDateShortFr(job.deposit_paid_at) : ''}`
          : 'Non paye',
        depotPaye
      )}
      {row(
        'Solde',
        soldePaye
          ? `${formatMoney(Number(job.total) - Number(job.depot_requis))}${job.balance_paid_at ? ' — ' + formatDateShortFr(job.balance_paid_at) : ''}`
          : 'Non paye',
        soldePaye
      )}
      {row(
        'Facture',
        job.invoice_id ? job.invoice_numero || `#${job.invoice_id}` : 'Non creee',
        !!job.invoice_id
      )}
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

  const imminent = days !== null && days <= 1 && days >= 0;
  const cardBorder = imminent
    ? 'border-amber-500/60 ring-1 ring-amber-500/20'
    : 'border-slate-700 hover:border-slate-600';

  return (
    <div className={`bg-slate-800 border rounded-xl p-5 space-y-4 transition ${cardBorder}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded font-mono">Projet #{job.id}</span>
            <h3 className="text-white font-bold text-lg truncate">{job.client_nom}</h3>
          </div>
          <div className="mt-1 space-y-0.5 text-sm">
            {job.client_tel && (
              <a href={`tel:${job.client_tel}`} className="block text-amber-400 hover:underline">
                {job.client_tel}
              </a>
            )}
            {job.client_email && (
              <a href={`mailto:${job.client_email}`} className="block text-sky-400 hover:underline truncate">
                {job.client_email}
              </a>
            )}
            {job.client_adresse && (
              <a
                href={mapsUrl(job.client_adresse)}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-slate-400 hover:text-indigo-300"
              >
                {job.client_adresse}
              </a>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full border whitespace-nowrap ${badge.cls}`}>
            {badge.label}
          </span>
          {daysLabel && (
            <span className={`text-xs font-semibold ${imminent ? 'text-amber-400' : 'text-slate-400'}`}>
              {daysLabel}
            </span>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <QuickActions job={job} />

      {/* Service */}
      <div className="text-sm text-slate-300">
        {SERVICE_LABEL[job.type_service] || job.type_service} — {job.superficie} pi2
      </div>

      {/* Booking dates */}
      {job.jour1_date && (
        <div className={`rounded-lg p-3 space-y-1 ${imminent ? 'bg-amber-500/10 border border-amber-500/30' : 'bg-slate-900/50'}`}>
          <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-1">Planification</h4>
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

      {/* Entity summary */}
      <EntitySummary job={job} />

      {/* Financials */}
      <div className="bg-slate-900/50 rounded-lg p-3">
        <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-1.5">Montants</h4>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <div className="text-slate-500 text-xs">Total</div>
            <div className="text-white font-semibold">{formatMoney(Number(job.total))}</div>
          </div>
          <div>
            <div className="text-slate-500 text-xs">Depot</div>
            <div className="text-emerald-400 font-semibold">{formatMoney(Number(job.depot_requis))}</div>
          </div>
          <div>
            <div className="text-slate-500 text-xs">Solde</div>
            <div className="text-amber-400 font-semibold">{formatMoney(balance)}</div>
          </div>
        </div>
      </div>

      {/* Photo counter + Expand/Collapse toggle */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-slate-400 hover:text-white transition font-medium"
        >
          {expanded ? '▾ Masquer details' : '▸ Photos, checklist, heures & profit'}
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
          <ProfitSection job={job} />
        </div>
      )}

      {/* Complete button */}
      <div className="flex items-center justify-end pt-1 flex-wrap gap-2 border-t border-slate-700/50">
        <button
          onClick={handleComplete}
          disabled={loading || !canComplete}
          title={!canComplete ? (!hasPhotosApres ? 'Ajoutez au moins 1 photo apres avant de completer' : 'Completez la checklist avant de completer') : ''}
          className="bg-green-600 hover:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
        >
          {loading ? 'En cours...' : 'Marquer complete'}
        </button>
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
    <div ref={cardRef} className={`bg-slate-800/60 border rounded-xl p-5 space-y-4 ${autoExpand ? 'border-amber-500/50 ring-1 ring-amber-500/20' : 'border-slate-700/50'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded font-mono">Projet #{job.id}</span>
            <h3 className="text-white font-bold text-lg truncate">{job.client_nom}</h3>
          </div>
          <div className="mt-1 space-y-0.5 text-sm">
            {job.client_tel && (
              <a href={`tel:${job.client_tel}`} className="block text-amber-400 hover:underline">{job.client_tel}</a>
            )}
            {job.client_email && (
              <a href={`mailto:${job.client_email}`} className="block text-sky-400 hover:underline truncate">{job.client_email}</a>
            )}
            {job.client_adresse && (
              <a
                href={mapsUrl(job.client_adresse)}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-slate-500 hover:text-indigo-300"
              >
                {job.client_adresse}
              </a>
            )}
          </div>
        </div>
        <span className="text-xs font-medium px-2.5 py-1 rounded-full border bg-green-500/20 text-green-300 border-green-500/30 whitespace-nowrap">
          Termine
        </span>
      </div>

      <QuickActions job={job} />

      <div className="text-sm text-slate-300">
        {SERVICE_LABEL[job.type_service] || job.type_service} — {job.superficie} pi2
      </div>

      {job.jour1_date && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span>Realise: {formatDateFr(job.jour1_date)}</span>
          {job.jour2_date && <span>— {formatDateFr(job.jour2_date)}</span>}
        </div>
      )}

      <EntitySummary job={job} />

      <div className="bg-slate-900/50 rounded-lg p-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500 text-xs uppercase tracking-wider font-semibold">Total projet</span>
          <span className="text-white font-semibold text-base">{formatMoney(Number(job.total))}</span>
        </div>
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
          <ProfitSection job={job} />
        </div>
      )}
    </div>
  );
}

type TabKey = 'en_cours' | 'planifies' | 'termines' | 'tous';

function PageContent() {
  const searchParams = useSearchParams();
  const projetParam = searchParams.get('projet');
  const [data, setData] = useState<Travail[]>([]);
  const [tab, setTab] = useState<TabKey>('en_cours');
  const [search, setSearch] = useState('');
  const [focusProjet] = useState<number | null>(projetParam ? parseInt(projetParam) : null);

  const load = useCallback(async () => {
    const res = await fetch('/api/travaux');
    if (!res.ok) return;
    const json = await res.json();
    setData(json.data ?? []);
  }, []);

  // Auto-switch tab if focused project is completed
  useEffect(() => {
    if (focusProjet && data.length > 0) {
      const job = data.find(j => j.id === focusProjet);
      if (job?.statut === 'complete') setTab('termines');
    }
  }, [focusProjet, data]);

  // Apply search filter
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter(j =>
      (j.client_nom || '').toLowerCase().includes(q) ||
      (j.client_adresse || '').toLowerCase().includes(q) ||
      (j.client_email || '').toLowerCase().includes(q) ||
      (j.client_tel || '').toLowerCase().includes(q) ||
      String(j.id).includes(q)
    );
  }, [data, search]);

  // Split buckets
  const completedJobs = filtered.filter(j => j.statut === 'complete');
  const activeJobs = filtered.filter(j => j.statut !== 'complete');
  // "Planifies" = booked with dates but not yet in progress
  const planifiedJobs = activeJobs.filter(j => j.jour1_date && (j.statut === 'approuve' || j.statut === 'depot_paye' || j.statut === 'planifie'));
  // "En cours" = active jobs (already shown today/this week view)
  const enCoursJobs = activeJobs.filter(j => j.statut === 'en_cours' || (!j.jour1_date) || (j.jour1_date && !planifiedJobs.includes(j)));

  // Group "en cours" jobs by proximity
  const thisWeek: Travail[] = [];
  const upcoming: Travail[] = [];
  const noDates: Travail[] = [];
  for (const job of enCoursJobs) {
    if (!job.jour1_date) noDates.push(job);
    else if (isThisWeek(job.jour1_date)) thisWeek.push(job);
    else upcoming.push(job);
  }

  // Count for tab counters — based on unfiltered data so users see full totals
  const totalCounts = useMemo(() => {
    const completes = data.filter(j => j.statut === 'complete');
    const actives = data.filter(j => j.statut !== 'complete');
    const plans = actives.filter(j => j.jour1_date && (j.statut === 'approuve' || j.statut === 'depot_paye' || j.statut === 'planifie'));
    const encours = actives.filter(j => !plans.includes(j));
    return {
      en_cours: encours.length,
      planifies: plans.length,
      termines: completes.length,
      tous: data.length,
    };
  }, [data]);

  const tabCls = (t: TabKey) =>
    `px-4 py-2 text-sm font-medium rounded-lg transition whitespace-nowrap ${
      tab === t
        ? 'bg-amber-500 text-black'
        : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700'
    }`;

  return (
    <PollingProvider onRefresh={load}>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="text-2xl font-bold text-white">Travaux</h2>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setTab('en_cours')} className={tabCls('en_cours')}>
              En cours ({totalCounts.en_cours})
            </button>
            <button onClick={() => setTab('planifies')} className={tabCls('planifies')}>
              Planifies ({totalCounts.planifies})
            </button>
            <button onClick={() => setTab('termines')} className={tabCls('termines')}>
              Completes ({totalCounts.termines})
            </button>
            <button onClick={() => setTab('tous')} className={tabCls('tous')}>
              Tous ({totalCounts.tous})
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" /></svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Rechercher par client, adresse, email, telephone ou numero de projet..."
            className="w-full bg-slate-800 border border-slate-700 rounded-lg pl-10 pr-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 transition"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white text-sm"
            >
              &times;
            </button>
          )}
        </div>

        {tab === 'en_cours' && (
          <>
            {enCoursJobs.length === 0 && (
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-12 text-center">
                <p className="text-slate-500 text-sm">Aucun travail en cours</p>
              </div>
            )}
            <Section title="Cette semaine" jobs={thisWeek} onRefresh={load} />
            <Section title="Prochaines semaines" jobs={upcoming} onRefresh={load} />
            <Section title="En attente de dates" jobs={noDates} onRefresh={load} />
          </>
        )}

        {tab === 'planifies' && (
          <>
            {planifiedJobs.length === 0 ? (
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-12 text-center">
                <p className="text-slate-500 text-sm">Aucun projet planifie</p>
              </div>
            ) : (
              <Section title="Projets planifies" jobs={planifiedJobs} onRefresh={load} />
            )}
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

        {tab === 'tous' && (
          <>
            {filtered.length === 0 && (
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-12 text-center">
                <p className="text-slate-500 text-sm">Aucun projet trouve</p>
              </div>
            )}
            {activeJobs.length > 0 && (
              <Section title={`Actifs (${activeJobs.length})`} jobs={activeJobs} onRefresh={load} />
            )}
            {completedJobs.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-slate-400 text-sm font-semibold uppercase tracking-wider">Completes ({completedJobs.length})</h3>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {completedJobs.map(job => (
                    <CompletedJobCard key={job.id} job={job} autoExpand={focusProjet === job.id} />
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

export default function TravauxPage() {
  return <PageContent />;
}
