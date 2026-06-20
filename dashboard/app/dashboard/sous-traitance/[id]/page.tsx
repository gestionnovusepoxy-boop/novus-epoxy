'use client';

import { useState, useCallback, useEffect, useRef, use } from 'react';
import Link from 'next/link';
import { PollingProvider } from '@/components/polling-provider';
import { formatMoney } from '@/lib/pricing';

/* ─── Types ─── */
interface Contract {
  id: number;
  client_nom: string | null;
  client_email: string | null;
  client_tel: string | null;
  client_adresse: string | null;
  type_service: string | null;
  statut: string;
  notes: string | null;
  is_subcontract: boolean;
  partner_id: number | null;
  contract_price: number | null;
  profit_split_pct: number | null;
  created_at: string;
  partner_nom: string | null;
  partner_telephone: string | null;
  partner_email: string | null;
}

interface ProfitBreakdown {
  revenue: number;
  costs: number;
  profit: number;
  lucaShare: number;
  partnerShare: number;
}

interface InvoiceLink {
  id: number;
  numero: string;
  statut: string;
  created_at: string;
}

interface ExpenseLink {
  id: number;
  fournisseur: string;
  description: string | null;
  categorie: string;
  montant: number;
  montant_ttc: number;
  date_depense: string;
}

interface PartnerOption {
  id: number;
  nom: string;
  split_defaut_pct: number;
}

interface JobPhoto {
  id: number;
  quote_id: number;
  type: 'avant' | 'apres';
  url: string;
  filename: string;
  created_at: string;
}

interface DetailResponse {
  contract: Contract;
  profit: ProfitBreakdown;
  invoices: InvoiceLink[];
  expenses: ExpenseLink[];
}

/* ─── Constants ─── */
const STATUT_BADGE: Record<string, { label: string; cls: string }> = {
  approuve:   { label: 'Approuvé',  cls: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
  depot_paye: { label: 'Dépôt payé', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  planifie:   { label: 'Planifié',  cls: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' },
  en_cours:   { label: 'En cours',  cls: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  complete:   { label: 'Complété',  cls: 'bg-green-500/20 text-green-300 border-green-500/30' },
  facture:    { label: 'Facturé',   cls: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
  paye:       { label: 'Payé',      cls: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' },
};

const CAT_LABEL: Record<string, string> = {
  materiaux: 'Matériaux', sous_traitance: 'Sous-trait.', transport: 'Transport',
  equipement: 'Équipement', marketing: 'Marketing', autre: 'Autre',
};

/* ─── Helpers ─── */
function formatDateFr(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(String(iso).slice(0, 10) + 'T12:00:00');
  if (isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' });
}

function mapsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/* ─── Photo Section (réutilise /api/travaux/photos avec quote_id) ─── */
function PhotoSection({ quoteId }: { quoteId: number }) {
  const [photos, setPhotos] = useState<JobPhoto[]>([]);
  const [uploading, setUploading] = useState<'avant' | 'apres' | null>(null);
  const [viewingPhoto, setViewingPhoto] = useState<{ url: string; label: string } | null>(null);
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
      else alert('Erreur lors du téléchargement');
    } catch {
      alert('Erreur réseau');
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

  const column = (
    type: 'avant' | 'apres',
    list: JobPhoto[],
    ref: React.RefObject<HTMLInputElement | null>,
    hoverCls: string,
    label: string,
  ) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-slate-300 text-xs font-medium">{label}</span>
        <button
          onClick={() => ref.current?.click()}
          disabled={uploading === type}
          className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2 py-1 rounded transition disabled:opacity-50"
        >
          {uploading === type ? '...' : '+ Photo'}
        </button>
        <input
          ref={ref}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) handleUpload(type, f);
            e.target.value = '';
          }}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {list.map(p => (
          <div key={p.id} className="relative group">
            <img
              src={p.url}
              alt={p.filename}
              className={`w-16 h-16 object-cover rounded border border-slate-600 cursor-pointer ${hoverCls} transition`}
              onClick={() => setViewingPhoto({ url: p.url, label: `${label} — ${p.filename}` })}
            />
            <button
              onClick={() => handleDelete(p.id)}
              className="absolute -top-1 -right-1 bg-red-600 text-white rounded-full w-4 h-4 text-[10px] leading-none opacity-0 group-hover:opacity-100 transition"
            >
              x
            </button>
          </div>
        ))}
        {list.length === 0 && <span className="text-slate-600 text-xs">Aucune photo</span>}
      </div>
    </div>
  );

  return (
    <div className="bg-slate-900/50 rounded-lg p-3 space-y-2">
      <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Photos avant / après</h4>
      <div className="grid grid-cols-2 gap-3">
        {column('avant', avantPhotos, avantRef, 'hover:border-amber-500', 'Avant')}
        {column('apres', apresPhotos, apresRef, 'hover:border-green-500', 'Après')}
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

/* ─── Profit Breakdown ─── */
function ProfitBreakdownSection({ profit, contract }: { profit: ProfitBreakdown; contract: Contract }) {
  const pct = Number(contract.profit_split_pct ?? 50);
  const positive = profit.profit >= 0;
  const margin = profit.revenue > 0 ? Math.round((profit.profit / profit.revenue) * 100) : 0;

  return (
    <div className={`rounded-xl p-5 space-y-2 ${positive ? 'bg-green-950/30 border border-green-800/40' : 'bg-red-950/30 border border-red-800/40'}`}>
      <h3 className="text-slate-300 text-sm font-semibold uppercase tracking-wider">Répartition du profit</h3>

      <div className="flex items-center justify-between text-base">
        <span className="text-slate-300">Revenu <span className="text-slate-500 text-sm">(prix contrat)</span></span>
        <span className="text-white font-semibold">{formatMoney(profit.revenue)}</span>
      </div>
      <div className="flex items-center justify-between text-base border-t border-slate-700/50 pt-2">
        <span className="text-slate-300">Coûts <span className="text-slate-500 text-sm">(dépenses + main d&apos;œuvre)</span></span>
        <span className="text-red-400 font-semibold">-{formatMoney(profit.costs)}</span>
      </div>

      <div className="flex items-center justify-between text-lg border-t border-slate-700 pt-2 mt-1">
        <span className="text-white font-bold">PROFIT</span>
        <span className={`font-bold ${positive ? 'text-green-400' : 'text-red-400'}`}>
          {formatMoney(profit.profit)} <span className="text-sm font-medium">({margin}%)</span>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 pt-3 mt-1 border-t border-slate-700/50">
        <div className="bg-slate-900/50 rounded-lg p-3">
          <div className="text-slate-400 text-xs uppercase tracking-wider">Ta part</div>
          <div className="text-slate-500 text-xs">{pct}%</div>
          <div className={`text-xl font-bold mt-1 ${positive ? 'text-green-400' : 'text-red-400'}`}>{formatMoney(profit.lucaShare)}</div>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-3">
          <div className="text-slate-400 text-xs uppercase tracking-wider">
            Part du partenaire{contract.partner_nom ? ` — ${contract.partner_nom}` : ''}
          </div>
          <div className="text-slate-500 text-xs">{100 - pct}%</div>
          <div className={`text-xl font-bold mt-1 ${positive ? 'text-green-400' : 'text-red-400'}`}>{formatMoney(profit.partnerShare)}</div>
        </div>
      </div>
    </div>
  );
}

/* ─── Settings (split % + partner + statut + prix) ─── */
function SettingsSection({ contract, onSaved }: { contract: Contract; onSaved: () => void }) {
  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [partnerId, setPartnerId] = useState<string>(contract.partner_id != null ? String(contract.partner_id) : '');
  const [splitPct, setSplitPct] = useState<string>(contract.profit_split_pct != null ? String(contract.profit_split_pct) : '50');
  const [contractPrice, setContractPrice] = useState<string>(contract.contract_price != null ? String(contract.contract_price) : '');
  const [statut, setStatut] = useState<string>(contract.statut);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/partners');
      if (res.ok) {
        const json = await res.json();
        setPartners(json.data ?? []);
      }
    })();
  }, []);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/sous-traitance/${contract.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partner_id: partnerId ? parseInt(partnerId) : null,
          profit_split_pct: splitPct === '' ? null : Number(splitPct),
          contract_price: contractPrice === '' ? null : Number(contractPrice),
          statut,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert((j as { error?: string }).error ?? 'Échec de l\'enregistrement');
        return;
      }
      onSaved();
    } catch {
      alert('Erreur réseau');
    } finally {
      setSaving(false);
    }
  }

  const field = 'w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 transition';
  const lbl = 'text-slate-400 text-xs font-medium uppercase tracking-wider';

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">
      <h3 className="text-slate-400 text-sm font-semibold uppercase tracking-wider">Paramètres du contrat</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={lbl}>Prix du contrat ($)</label>
          <input type="number" step="0.01" value={contractPrice} onChange={e => setContractPrice(e.target.value)} className={field} placeholder="0.00" />
        </div>
        <div className="space-y-1">
          <label className={lbl}>Partage de profit — ta part (%)</label>
          <input type="number" step="0.01" min="0" max="100" value={splitPct} onChange={e => setSplitPct(e.target.value)} className={field} placeholder="50" />
        </div>
        <div className="space-y-1">
          <label className={lbl}>Partenaire (fournisseur d&apos;ouvrage)</label>
          <select
            value={partnerId}
            onChange={e => {
              const v = e.target.value;
              setPartnerId(v);
              const p = partners.find(pp => String(pp.id) === v);
              if (p && p.split_defaut_pct != null) setSplitPct(String(p.split_defaut_pct));
            }}
            className={field}
          >
            <option value="">— Aucun —</option>
            {partners.map(p => (
              <option key={p.id} value={p.id}>{p.nom}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className={lbl}>Statut</label>
          <select value={statut} onChange={e => setStatut(e.target.value)} className={field}>
            {Object.entries(STATUT_BADGE).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black text-sm font-semibold px-5 py-2 rounded-lg transition"
        >
          {saving ? 'Enregistrement...' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}

/* ─── Page Content ─── */
function PageContent({ id }: { id: number }) {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/sous-traitance/${id}`);
    if (res.status === 401) { window.location.href = '/auth/signin'; return; }
    if (res.status === 404) { setNotFound(true); return; }
    if (!res.ok) return;
    const json = await res.json();
    setData(json);
  }, [id]);

  if (notFound) {
    return (
      <div className="p-6">
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-12 text-center space-y-3">
          <p className="text-slate-400 text-sm">Contrat de sous-traitance introuvable.</p>
          <Link href="/dashboard/sous-traitance" className="text-amber-400 hover:underline text-sm">← Retour aux contrats</Link>
        </div>
      </div>
    );
  }

  return (
    <PollingProvider onRefresh={load}>
      {!data ? (
        <div className="p-8 text-center text-slate-500">Chargement...</div>
      ) : (
        <ContractDetail data={data} onRefresh={load} />
      )}
    </PollingProvider>
  );
}

function ContractDetail({ data, onRefresh }: { data: DetailResponse; onRefresh: () => void }) {
  const { contract, profit, invoices, expenses } = data;
  const badge = STATUT_BADGE[contract.statut] ?? { label: contract.statut, cls: 'bg-slate-500/20 text-slate-300 border-slate-500/30' };
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.montant_ttc || 0), 0);

  return (
    <div className="p-3 sm:p-6 space-y-5 max-w-4xl mx-auto">
      {/* En-tête */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <Link href="/dashboard/sous-traitance" className="text-slate-500 hover:text-amber-400 text-xs">← Contrats de sous-traitance</Link>
          <div className="flex items-center gap-2 flex-wrap mt-1">
            <span className="text-[10px] bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded font-mono">Contrat #{contract.id}</span>
            <h2 className="text-2xl font-bold text-white truncate">
              {contract.partner_nom || contract.client_nom || `Contrat #${contract.id}`}
            </h2>
          </div>
          <div className="mt-1 space-y-0.5 text-sm">
            {contract.partner_nom && (
              <p className="text-slate-300">
                Partenaire : <span className="text-white font-medium">{contract.partner_nom}</span>
                {contract.partner_telephone && (
                  <a href={`tel:${contract.partner_telephone}`} className="text-amber-400 hover:underline ml-2">{contract.partner_telephone}</a>
                )}
              </p>
            )}
            {contract.client_nom && <p className="text-slate-400">Client : {contract.client_nom}</p>}
            {contract.client_adresse && (
              <a href={mapsUrl(contract.client_adresse)} target="_blank" rel="noopener noreferrer" className="block text-slate-400 hover:text-indigo-300">
                {contract.client_adresse}
              </a>
            )}
          </div>
        </div>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full border whitespace-nowrap ${badge.cls}`}>
          {badge.label}
        </span>
      </div>

      {/* Breakdown de profit — bien visible */}
      <ProfitBreakdownSection profit={profit} contract={contract} />

      {/* Photos avant/après */}
      <PhotoSection quoteId={contract.id} />

      {/* Dépenses liées */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-2">
        <h3 className="text-slate-400 text-sm font-semibold uppercase tracking-wider">
          Dépenses liées — {expenses.length}
        </h3>
        {expenses.length > 0 ? (
          <div className="space-y-1">
            {expenses.map(e => (
              <div key={e.id} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-slate-300 truncate">{e.fournisseur}</span>
                  <span className="text-slate-600 text-xs">{CAT_LABEL[e.categorie] || e.categorie}</span>
                  <span className="text-slate-600 text-xs">{formatDateFr(e.date_depense)}</span>
                </div>
                <span className="text-white font-medium whitespace-nowrap">{formatMoney(Number(e.montant_ttc))}</span>
              </div>
            ))}
            <div className="flex items-center justify-between text-sm border-t border-slate-700 pt-1.5 mt-1">
              <span className="text-slate-400 font-medium">Total dépenses</span>
              <span className="text-red-400 font-bold">{formatMoney(totalExpenses)}</span>
            </div>
          </div>
        ) : (
          <p className="text-slate-600 text-xs">Aucune dépense liée à ce contrat</p>
        )}
      </div>

      {/* Factures liées */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-slate-400 text-sm font-semibold uppercase tracking-wider">
            Factures liées — {invoices.length}
          </h3>
          <Link
            href="/dashboard/factures/nouveau"
            className="text-xs font-medium px-2.5 py-1.5 rounded-lg border bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border-purple-500/30 transition"
          >
            + Ajouter une facture
          </Link>
        </div>
        {invoices.length > 0 ? (
          <div className="space-y-1">
            {invoices.map(inv => (
              <Link
                key={inv.id}
                href={`/dashboard/factures/${inv.id}`}
                className="flex items-center justify-between text-sm py-1.5 px-2 -mx-2 rounded hover:bg-slate-700/50 transition"
              >
                <span className="text-amber-400 font-mono">{inv.numero}</span>
                <div className="flex items-center gap-3">
                  <span className="text-slate-500 text-xs">{formatDateFr(inv.created_at)}</span>
                  <span className="text-slate-300 text-xs">{inv.statut}</span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-slate-600 text-xs">Aucune facture liée à ce contrat</p>
        )}
      </div>

      {/* Paramètres ajustables */}
      <SettingsSection contract={contract} onSaved={onRefresh} />
    </div>
  );
}

/* ─── Page ─── */
export default function SousTraitanceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <PageContent id={parseInt(id)} />;
}
