'use client';

/**
 * Portail /partenaire — espace ISOLÉ pour les sous-traitants.
 *
 * Séparé du dashboard Novus: pas de CRM, pas de finances, pas de menu admin.
 * Le sous-traitant voit SEULEMENT ses chantiers (filtrés par son partner_id côté
 * API). Pour chaque chantier: infos de base, dates, photos avant/après, factures.
 *
 * Toute la donnée vient de /api/partenaire (liste) et /api/partenaire/[id] (détail),
 * qui refusent 403 si l'utilisateur n'est pas un sous-traitant et n'exposent jamais
 * de prix/profit.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/* ─── Types ─── */
interface Chantier {
  id: number;
  client_nom: string;
  client_adresse: string | null;
  type_service: string | null;
  statut: string;
  jour1_date: string | null;
  jour2_date: string | null;
  created_at: string;
}

interface Photo {
  id: number;
  type: string;
  url: string;
  filename: string | null;
  created_at: string;
}

interface PartnerInvoice {
  id: number;
  description: string | null;
  heures: number | null;
  taux_horaire: number | null;
  montant: number;
  fichier_url: string | null;
  fichier_nom: string | null;
  statut: string;
  created_at: string;
}

interface ChantierDetail {
  contract: {
    id: number;
    client_nom: string;
    client_adresse: string | null;
    client_tel: string | null;
    type_service: string | null;
    notes: string | null;
    statut: string;
    created_at: string;
    jour1_date: string | null;
    jour1_slot: string | null;
    jour2_date: string | null;
    jour2_slot: string | null;
  };
  photos: Photo[];
  invoices: PartnerInvoice[];
}

/* ─── Helpers ─── */
const STATUT_BADGE: Record<string, { label: string; cls: string }> = {
  planifie: { label: 'Planifié', cls: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' },
  en_cours: { label: 'En cours', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  complete: { label: 'Complété', cls: 'bg-green-500/20 text-green-300 border-green-500/30' },
  facture: { label: 'Facturé', cls: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
  paye: { label: 'Payé', cls: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' },
};

function statutBadge(statut: string) {
  return STATUT_BADGE[statut] || { label: statut, cls: 'bg-slate-700 text-slate-300 border-slate-600' };
}

function fmtDate(d: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return d;
  }
}

function fmtMoney(n: number | null): string {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' });
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:outline-none';

/* ─── Photos d'un chantier ─── */
function PhotoSection({ quoteId, photos, onChange }: { quoteId: number; photos: Photo[]; onChange: () => void }) {
  const [uploading, setUploading] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const upload = useCallback(
    async (type: 'avant' | 'apres', file: File) => {
      setErr(null);
      setUploading(type);
      try {
        const fd = new FormData();
        fd.append('quoteId', String(quoteId));
        fd.append('type', type);
        fd.append('photo', file);
        const res = await fetch('/api/travaux/photos', { method: 'POST', body: fd });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || 'Échec du téléversement');
        }
        onChange();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Erreur');
      } finally {
        setUploading(null);
      }
    },
    [quoteId, onChange],
  );

  const renderGroup = (type: 'avant' | 'apres', label: string) => {
    const list = photos.filter(p => p.type === type);
    return (
      <div className="flex-1">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</h4>
          <label className="cursor-pointer rounded-md bg-amber-500/20 px-2 py-1 text-xs font-semibold text-amber-300 hover:bg-amber-500/30">
            {uploading === type ? '…' : '+ Photo'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading === type}
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) upload(type, f);
                e.target.value = '';
              }}
            />
          </label>
        </div>
        {list.length === 0 ? (
          <p className="text-xs text-slate-600">Aucune photo</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {list.map(p => (
              <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.filename ?? type} className="aspect-square w-full rounded-md object-cover" />
              </a>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="flex gap-6">
        {renderGroup('avant', 'Avant')}
        {renderGroup('apres', 'Après')}
      </div>
      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
    </div>
  );
}

/* ─── Factures d'un chantier ─── */
function InvoiceSection({ quoteId, invoices, onChange }: { quoteId: number; invoices: PartnerInvoice[]; onChange: () => void }) {
  const [description, setDescription] = useState('');
  const [heures, setHeures] = useState('');
  const [taux, setTaux] = useState('');
  const [montant, setMontant] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setErr(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/partenaire/${quoteId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: description || null,
          heures: heures ? Number(heures) : null,
          taux_horaire: taux ? Number(taux) : null,
          montant: montant ? Number(montant) : null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || 'Échec');
      }
      setDescription('');
      setHeures('');
      setTaux('');
      setMontant('');
      onChange();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setSaving(false);
    }
  }, [quoteId, description, heures, taux, montant, onChange]);

  return (
    <div>
      {invoices.length > 0 && (
        <div className="mb-4 space-y-2">
          {invoices.map(inv => (
            <div key={inv.id} className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm text-slate-200">{inv.description || 'Facture'}</p>
                <p className="text-xs text-slate-500">
                  {inv.heures != null ? `${inv.heures} h` : ''}
                  {inv.heures != null && inv.taux_horaire != null ? ` × ${fmtMoney(inv.taux_horaire)} · ` : ''}
                  {fmtDate(inv.created_at)}
                </p>
              </div>
              <div className="ml-3 text-right">
                <p className="text-sm font-semibold text-slate-100">{fmtMoney(inv.montant)}</p>
                <span className="text-xs text-slate-500">{inv.statut}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        <input className={`${inputCls} sm:col-span-4`} placeholder="Description (ex: pose 2e couche)" value={description} onChange={e => setDescription(e.target.value)} />
        <input className={inputCls} type="number" step="0.5" placeholder="Heures" value={heures} onChange={e => setHeures(e.target.value)} />
        <input className={inputCls} type="number" step="0.01" placeholder="Taux/h" value={taux} onChange={e => setTaux(e.target.value)} />
        <input className={inputCls} type="number" step="0.01" placeholder="Montant $" value={montant} onChange={e => setMontant(e.target.value)} />
        <button
          onClick={submit}
          disabled={saving}
          className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-400 disabled:opacity-50"
        >
          {saving ? '…' : 'Ajouter facture'}
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
    </div>
  );
}

/* ─── Carte d'un chantier (déplie le détail) ─── */
function ChantierCard({ chantier }: { chantier: Chantier }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<ChantierDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const loadedOnce = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/partenaire/${chantier.id}`);
      if (res.ok) setDetail(await res.json());
    } finally {
      setLoading(false);
    }
  }, [chantier.id]);

  useEffect(() => {
    if (open && !loadedOnce.current) {
      loadedOnce.current = true;
      load();
    }
  }, [open, load]);

  const badge = statutBadge(chantier.statut);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-800/40">
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-100">{chantier.client_nom}</p>
          <p className="truncate text-sm text-slate-400">{chantier.client_adresse || 'Adresse à confirmer'}</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-3">
          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${badge.cls}`}>{badge.label}</span>
          <span className="text-slate-500">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-800 px-4 py-4">
          <div className="mb-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <span className="text-slate-500">Service</span>
              <p className="text-slate-200">{detail?.contract.type_service || chantier.type_service || '—'}</p>
            </div>
            <div>
              <span className="text-slate-500">Téléphone client</span>
              <p className="text-slate-200">{detail?.contract.client_tel || '—'}</p>
            </div>
            <div>
              <span className="text-slate-500">Jour 1</span>
              <p className="text-slate-200">{fmtDate(detail?.contract.jour1_date ?? chantier.jour1_date)}</p>
            </div>
            <div>
              <span className="text-slate-500">Jour 2</span>
              <p className="text-slate-200">{fmtDate(detail?.contract.jour2_date ?? chantier.jour2_date)}</p>
            </div>
            {detail?.contract.notes && (
              <div className="sm:col-span-2">
                <span className="text-slate-500">Notes</span>
                <p className="whitespace-pre-wrap text-slate-200">{detail.contract.notes}</p>
              </div>
            )}
          </div>

          {loading && <p className="text-sm text-slate-500">Chargement…</p>}

          {detail && (
            <div className="space-y-6">
              <div>
                <h3 className="mb-3 text-sm font-semibold text-amber-300">Photos</h3>
                <PhotoSection quoteId={chantier.id} photos={detail.photos} onChange={load} />
              </div>
              <div>
                <h3 className="mb-3 text-sm font-semibold text-amber-300">Mes factures</h3>
                <InvoiceSection quoteId={chantier.id} invoices={detail.invoices} onChange={load} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Page ─── */
export default function PartenairePage() {
  const [chantiers, setChantiers] = useState<Chantier[]>([]);
  const [nom, setNom] = useState<string>('');
  const [state, setState] = useState<'loading' | 'ok' | 'forbidden' | 'error'>('loading');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/partenaire');
        if (res.status === 403) {
          setState('forbidden');
          return;
        }
        if (!res.ok) {
          setState('error');
          return;
        }
        const j = await res.json();
        setNom(j.partenaire?.nom ?? '');
        setChantiers(j.data ?? []);
        setState('ok');
      } catch {
        setState('error');
      }
    })();
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80">
        <div className="mx-auto max-w-3xl px-4 py-5">
          <h1 className="text-xl font-bold tracking-tight">
            <span className="text-amber-400">Novus</span> Epoxy · Espace partenaire
          </h1>
          {nom && <p className="mt-0.5 text-sm text-slate-400">Bonjour {nom}</p>}
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-6">
        {state === 'loading' && <p className="text-slate-500">Chargement…</p>}

        {state === 'forbidden' && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-center">
            <p className="text-slate-300">Cet espace est réservé aux sous-traitants de Novus Epoxy.</p>
            <p className="mt-1 text-sm text-slate-500">Connectez-vous avec le compte fourni par Novus.</p>
          </div>
        )}

        {state === 'error' && <p className="text-red-400">Une erreur est survenue. Réessayez plus tard.</p>}

        {state === 'ok' && (
          <>
            <p className="mb-4 text-sm text-slate-400">
              {chantiers.length} chantier{chantiers.length > 1 ? 's' : ''}
            </p>
            {chantiers.length === 0 ? (
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-center text-slate-500">
                Aucun chantier assigné pour le moment.
              </div>
            ) : (
              <div className="space-y-3">
                {chantiers.map(c => (
                  <ChantierCard key={c.id} chantier={c} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
