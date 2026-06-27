'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { formatMoney } from '@/lib/pricing';

/* ─────────────────────────── TYPES ─────────────────────────── */

interface Summary {
  a_recevoir: number;
  recu: number;
  cout_main_oeuvre: number;
  cout_materiel: number;
  profit: number;
  a_payer_workers: number;
  par_worker: { worker_id: number; nom: string; heures_non_payees: number; montant_du: number }[];
  nb_chantiers: number;
  nb_a_planifier: number;
}

interface Planning {
  id: number;
  chantier_id: number;
  date: string;
  equipe: 1 | 2;
  slot: 'am' | 'pm' | 'journee' | 'custom';
  heure_debut: string | null;
  heure_fin: string | null;
  jour_numero: number;
  notes: string | null;
  client_nom?: string;
  ville?: string;
}

interface Produit {
  id: number;
  nom: string;
  quantite: number;
  cout_unitaire: number;
}

interface Chantier {
  id: number;
  client_nom: string;
  client_tel: string | null;
  adresse: string | null;
  ville: string | null;
  service: string | null;
  superficie: number | null;
  montant_contrat: number;
  montant_main_oeuvre: number;
  montant_materiel: number;
  depot_recu: boolean;
  depot_montant: number | null;
  statut: string;
  notes: string | null;
  planning: Planning[];
  produits: Produit[];
  cout_main_oeuvre: number;
  cout_materiel: number;
  profit: number;
  photos?: { type: 'avant' | 'apres'; url: string }[];
}

interface Worker {
  id: number;
  nom: string;
  taux_horaire: number;
  telephone: string | null;
  actif: boolean;
  equipe: 1 | 2 | null;
}

interface Heure {
  id: number;
  worker_id: number;
  worker_nom: string;
  taux_horaire: number;
  chantier_id: number | null;
  chantier_client?: string | null;
  equipe: 1 | 2 | null;
  date: string;
  heures: number;
  notes: string | null;
  paye: boolean;
}

interface HeuresResult {
  data: Heure[];
  par_worker: { worker_id: number; nom: string; total_heures: number; total_montant: number; heures_non_payees: number; montant_non_paye: number }[];
}

interface CatalogueProduit {
  id: number;
  nom: string;
  cout_unitaire: number;
  unite: string | null;
}

/* ─────────────────────────── HELPERS ─────────────────────────── */

const inputCls =
  'w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 transition';
const labelCls = 'block text-xs font-medium text-slate-400 mb-1';
const cardCls = 'bg-slate-800 border border-slate-700 rounded-xl p-4';

const STATUTS_CHANTIER = [
  { value: 'a_planifier', label: 'À planifier' },
  { value: 'planifie', label: 'Planifié' },
  { value: 'en_cours', label: 'En cours' },
  { value: 'complete', label: 'Complété' },
  { value: 'paye', label: 'Payé' },
];

const STATUT_BADGE: Record<string, { label: string; cls: string }> = {
  a_planifier: { label: 'À planifier', cls: 'bg-red-500/20 text-red-300 border-red-500/30' },
  planifie:    { label: 'Planifié',    cls: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' },
  en_cours:    { label: 'En cours',    cls: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  complete:    { label: 'Complété',    cls: 'bg-green-500/20 text-green-300 border-green-500/30' },
  paye:        { label: 'Payé',        cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
};

const SLOT_LABEL: Record<string, string> = {
  am: 'AM (matin)',
  pm: 'PM (après-midi)',
  journee: 'Journée',
  custom: 'Heures perso',
};

const JOURS_SEMAINE = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

function statutBadge(s: string) {
  return STATUT_BADGE[s] ?? { label: s, cls: 'bg-slate-700 text-slate-300 border-slate-600' };
}

function fmtDate(d: string): string {
  const dt = new Date(d + 'T12:00:00');
  return dt.toLocaleDateString('fr-CA', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Monday of the week containing d */
function weekStart(d: Date): Date {
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  const r = new Date(d);
  r.setDate(r.getDate() + diff);
  r.setHours(0, 0, 0, 0);
  return r;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/* ─────────────────────────── SUB-COMPONENTS ─────────────────────────── */

/* ── Money card ── */
function MoneyCard({ label, value, color = 'white', sub }: { label: string; value: number; color?: string; sub?: string }) {
  const colorCls = {
    white:   'text-white',
    green:   'text-green-400',
    red:     'text-red-400',
    amber:   'text-amber-400',
    emerald: 'text-emerald-400',
    blue:    'text-blue-400',
  }[color] ?? 'text-white';

  return (
    <div className={cardCls}>
      <div className="text-slate-500 text-xs uppercase tracking-wider">{label}</div>
      <div className={`font-bold text-lg mt-1 ${colorCls}`}>{formatMoney(Number(value))}</div>
      {sub && <div className="text-slate-500 text-xs mt-0.5">{sub}</div>}
    </div>
  );
}

/* ── Confirm dialog ── */
function useConfirm() {
  const [state, setState] = useState<{ msg: string; resolve: (ok: boolean) => void } | null>(null);
  const confirm = useCallback((msg: string) => new Promise<boolean>(resolve => setState({ msg, resolve })), []);
  const Dialog = state ? (
    <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4" onClick={() => { state.resolve(false); setState(null); }}>
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 max-w-sm w-full space-y-4" onClick={e => e.stopPropagation()}>
        <p className="text-white text-sm">{state.msg}</p>
        <div className="flex gap-2 justify-end">
          <button className="px-4 py-2 text-sm rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition" onClick={() => { state.resolve(false); setState(null); }}>Annuler</button>
          <button className="px-4 py-2 text-sm font-semibold rounded-lg bg-red-600 hover:bg-red-500 text-white transition" onClick={() => { state.resolve(true); setState(null); }}>Confirmer</button>
        </div>
      </div>
    </div>
  ) : null;
  return { confirm, Dialog };
}

/* ── Planning inline form ── */
function PlanningForm({
  chantiers,
  defaultChantierId,
  onSaved,
  onCancel,
}: {
  chantiers: Chantier[];
  defaultChantierId?: number;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [chantierId, setChantierId] = useState(defaultChantierId ? String(defaultChantierId) : '');
  const [date, setDate] = useState('');
  const [equipe, setEquipe] = useState<'1' | '2'>('1');
  const [slot, setSlot] = useState<'am' | 'pm' | 'journee' | 'custom'>('journee');
  const [heureDebut, setHeureDebut] = useState('');
  const [heureFin, setHeureFin] = useState('');
  const [jourNum, setJourNum] = useState('1');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleSave() {
    if (!chantierId || !date) { setErr('Chantier et date requis'); return; }
    setSaving(true); setErr('');
    try {
      const res = await fetch('/api/jj/planning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chantier_id: parseInt(chantierId),
          date,
          equipe: parseInt(equipe),
          slot,
          heure_debut: slot === 'custom' ? heureDebut || null : null,
          heure_fin:   slot === 'custom' ? heureFin || null : null,
          jour_numero: parseInt(jourNum) || 1,
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErr((d as { error?: string }).error ?? 'Erreur'); return; }
      onSaved();
    } catch { setErr('Erreur réseau'); }
    finally { setSaving(false); }
  }

  return (
    <div className="bg-slate-900/60 rounded-lg p-4 space-y-3 border border-slate-700">
      <h4 className="text-slate-300 text-xs font-semibold uppercase tracking-wider">Ajouter une journée</h4>
      {!defaultChantierId && (
        <div>
          <label className={labelCls}>Chantier</label>
          <select value={chantierId} onChange={e => setChantierId(e.target.value)} className={inputCls}>
            <option value="">Sélectionner...</option>
            {chantiers.map(c => <option key={c.id} value={c.id}>{c.client_nom} — {c.ville || c.adresse || ''}</option>)}
          </select>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls}>Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Jour #</label>
          <input type="number" value={jourNum} onChange={e => setJourNum(e.target.value)} min={1} max={10} className={inputCls} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelCls}>Équipe</label>
          <select value={equipe} onChange={e => setEquipe(e.target.value as '1' | '2')} className={inputCls}>
            <option value="1">Équipe 1</option>
            <option value="2">Équipe 2</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Slot</label>
          <select value={slot} onChange={e => setSlot(e.target.value as typeof slot)} className={inputCls}>
            {Object.entries(SLOT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>
      {slot === 'custom' && (
        <div className="grid grid-cols-2 gap-2">
          <div><label className={labelCls}>Début</label><input type="time" value={heureDebut} onChange={e => setHeureDebut(e.target.value)} className={inputCls} /></div>
          <div><label className={labelCls}>Fin</label><input type="time" value={heureFin} onChange={e => setHeureFin(e.target.value)} className={inputCls} /></div>
        </div>
      )}
      <div>
        <label className={labelCls}>Notes (optionnel)</label>
        <input type="text" value={notes} onChange={e => setNotes(e.target.value)} className={inputCls} placeholder="Ex: arriver avant 8h" />
      </div>
      {err && <p className="text-red-400 text-xs">{err}</p>}
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition">Annuler</button>
        <button onClick={handleSave} disabled={saving} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black transition">
          {saving ? 'Sauvegarde...' : 'Ajouter'}
        </button>
      </div>
    </div>
  );
}

/* ── Nouveau chantier modal ── */
function NewChantierModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState({
    client_nom: '', client_tel: '', adresse: '', ville: '', service: '',
    superficie: '', montant_contrat: '', montant_main_oeuvre: '', montant_materiel: '',
    depot_recu: false, depot_montant: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  function upd(k: string, v: string | boolean) { setF(prev => ({ ...prev, [k]: v })); }

  async function handleSubmit() {
    if (!f.client_nom.trim()) { setErr('Nom du client requis'); return; }
    setSaving(true); setErr('');
    try {
      const res = await fetch('/api/jj/chantiers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_nom: f.client_nom.trim(),
          client_tel: f.client_tel.trim() || null,
          adresse: f.adresse.trim() || null,
          ville: f.ville.trim() || null,
          service: f.service.trim() || null,
          superficie: f.superficie ? Number(f.superficie) : null,
          montant_contrat: f.montant_contrat ? Number(f.montant_contrat) : 0,
          montant_main_oeuvre: f.montant_main_oeuvre ? Number(f.montant_main_oeuvre) : 0,
          montant_materiel: f.montant_materiel ? Number(f.montant_materiel) : 0,
          depot_recu: f.depot_recu,
          depot_montant: f.depot_montant ? Number(f.depot_montant) : null,
          notes: f.notes.trim() || null,
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErr((d as { error?: string }).error ?? 'Erreur'); return; }
      onCreated();
    } catch { setErr('Erreur réseau'); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-white font-bold text-lg">Nouveau chantier JJ</h3>
          <button onClick={onClose} className="w-9 h-9 bg-slate-700 hover:bg-slate-600 text-white rounded-full flex items-center justify-center text-xl transition">&times;</button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={labelCls}>Nom du client *</label>
            <input type="text" value={f.client_nom} onChange={e => upd('client_nom', e.target.value)} placeholder="Jean Tremblay" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Téléphone</label>
            <input type="tel" value={f.client_tel} onChange={e => upd('client_tel', e.target.value)} placeholder="514-555-1234" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Ville</label>
            <input type="text" value={f.ville} onChange={e => upd('ville', e.target.value)} placeholder="Laval" className={inputCls} />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Adresse du chantier</label>
            <input type="text" value={f.adresse} onChange={e => upd('adresse', e.target.value)} placeholder="123 rue des Épinettes" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Service</label>
            <input type="text" value={f.service} onChange={e => upd('service', e.target.value)} placeholder="Flake, Métal..." className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Superficie (pi²)</label>
            <input type="number" inputMode="decimal" value={f.superficie} onChange={e => upd('superficie', e.target.value)} placeholder="500" className={inputCls} />
          </div>
        </div>

        <div className="border-t border-slate-700 pt-3 space-y-3">
          <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Argent</h4>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Contrat total ($)</label>
              <input type="number" inputMode="decimal" value={f.montant_contrat} onChange={e => upd('montant_contrat', e.target.value)} placeholder="4000" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Main-d'œuvre ($)</label>
              <input type="number" inputMode="decimal" value={f.montant_main_oeuvre} onChange={e => upd('montant_main_oeuvre', e.target.value)} placeholder="2000" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Matériel ($)</label>
              <input type="number" inputMode="decimal" value={f.montant_materiel} onChange={e => upd('montant_materiel', e.target.value)} placeholder="2000" className={inputCls} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={f.depot_recu} onChange={e => upd('depot_recu', e.target.checked)} className="w-4 h-4 rounded accent-amber-500" />
              <span className="text-sm text-slate-300">Dépôt reçu de JJ</span>
            </label>
            {f.depot_recu && (
              <input type="number" inputMode="decimal" value={f.depot_montant} onChange={e => upd('depot_montant', e.target.value)} placeholder="Montant dépôt" className={`${inputCls} max-w-[150px]`} />
            )}
          </div>
        </div>

        <div>
          <label className={labelCls}>Notes</label>
          <textarea value={f.notes} onChange={e => upd('notes', e.target.value)} rows={3} placeholder="Détails particuliers..." className={inputCls} />
        </div>

        {err && <p className="text-red-400 text-sm">{err}</p>}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition">Annuler</button>
          <button onClick={handleSubmit} disabled={saving} className="px-4 py-2 text-sm font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black transition">
            {saving ? 'Création...' : 'Créer le chantier'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Chantier detail drawer ── */
function ChantierDrawer({
  chantier,
  workers,
  catalogue,
  onClose,
  onChanged,
}: {
  chantier: Chantier;
  workers: Worker[];
  catalogue: CatalogueProduit[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { confirm, Dialog: ConfirmDialog } = useConfirm();
  const [tab, setTab] = useState<'info' | 'planning' | 'produits' | 'photos'>('info');

  // Edit fields
  const [editMode, setEditMode] = useState(false);
  const [f, setF] = useState({
    client_nom: chantier.client_nom,
    client_tel: chantier.client_tel ?? '',
    adresse: chantier.adresse ?? '',
    ville: chantier.ville ?? '',
    service: chantier.service ?? '',
    superficie: chantier.superficie ? String(chantier.superficie) : '',
    montant_contrat: String(chantier.montant_contrat),
    montant_main_oeuvre: String(chantier.montant_main_oeuvre),
    montant_materiel: String(chantier.montant_materiel),
    depot_recu: chantier.depot_recu,
    depot_montant: chantier.depot_montant ? String(chantier.depot_montant) : '',
    statut: chantier.statut,
    notes: chantier.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  function upd(k: string, v: string | boolean) { setF(prev => ({ ...prev, [k]: v })); }

  async function handleSave() {
    setSaving(true); setErr('');
    try {
      const res = await fetch(`/api/jj/chantiers/${chantier.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_nom: f.client_nom.trim(),
          client_tel: f.client_tel.trim() || null,
          adresse: f.adresse.trim() || null,
          ville: f.ville.trim() || null,
          service: f.service.trim() || null,
          superficie: f.superficie ? Number(f.superficie) : null,
          montant_contrat: Number(f.montant_contrat),
          montant_main_oeuvre: Number(f.montant_main_oeuvre),
          montant_materiel: Number(f.montant_materiel),
          depot_recu: f.depot_recu,
          depot_montant: f.depot_montant ? Number(f.depot_montant) : null,
          statut: f.statut,
          notes: f.notes.trim() || null,
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErr((d as { error?: string }).error ?? 'Erreur'); return; }
      setEditMode(false);
      onChanged();
    } catch { setErr('Erreur réseau'); }
    finally { setSaving(false); }
  }

  // Planning tab
  const [showPlanForm, setShowPlanForm] = useState(false);

  async function deletePlanning(id: number) {
    if (!(await confirm('Supprimer cette entrée de planning ?'))) return;
    await fetch(`/api/jj/planning/${id}`, { method: 'DELETE' });
    onChanged();
  }

  // Produits tab
  const [prodCatId, setProdCatId] = useState('');
  const [prodNom, setProdNom] = useState('');
  const [prodQte, setProdQte] = useState('1');
  const [prodPrix, setProdPrix] = useState('');
  const [savingProd, setSavingProd] = useState(false);

  function selectCatalogue(id: string) {
    setProdCatId(id);
    const item = catalogue.find(c => String(c.id) === id);
    if (item) { setProdNom(item.nom); setProdPrix(String(item.cout_unitaire)); }
    else { setProdNom(''); setProdPrix(''); }
  }

  async function addProduit() {
    if (!prodNom.trim()) return;
    setSavingProd(true);
    try {
      await fetch(`/api/jj/chantiers/${chantier.id}/produits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nom: prodNom.trim(), quantite: Number(prodQte) || 1, cout_unitaire: Number(prodPrix) || 0 }),
      });
      setProdCatId(''); setProdNom(''); setProdQte('1'); setProdPrix('');
      onChanged();
    } finally { setSavingProd(false); }
  }

  async function deleteProduit(id: number) {
    if (!(await confirm('Supprimer ce produit ?'))) return;
    await fetch(`/api/jj/produits/${id}`, { method: 'DELETE' });
    onChanged();
  }

  // Photos tab
  const fileRef = useRef<HTMLInputElement>(null);
  const [photoType, setPhotoType] = useState<'avant' | 'apres'>('avant');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  async function uploadPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const fd = new FormData();
      fd.append('type', photoType);
      fd.append('photo', file);
      await fetch(`/api/jj/chantiers/${chantier.id}/photos`, { method: 'POST', body: fd });
      onChanged();
    } finally { setUploadingPhoto(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  async function deletePhoto(type: string, url: string) {
    if (!(await confirm('Supprimer cette photo ?'))) return;
    await fetch(`/api/jj/chantiers/${chantier.id}/photos?type=${encodeURIComponent(type)}&url=${encodeURIComponent(url)}`, { method: 'DELETE' });
    onChanged();
  }

  // Sanity checks
  const totalProduits = chantier.produits.reduce((s, p) => s + p.quantite * p.cout_unitaire, 0);
  const mainOeuvreOk = chantier.cout_main_oeuvre <= chantier.montant_main_oeuvre;
  const materielOk = totalProduits <= chantier.montant_materiel;

  const tabCls = (t: string) => `px-3 py-1.5 text-xs font-medium rounded-lg transition ${tab === t ? 'bg-amber-500 text-black' : 'bg-slate-700/60 text-slate-300 hover:text-white hover:bg-slate-700'}`;

  return (
    <>
      {ConfirmDialog}
      <div className="fixed inset-0 bg-black/80 z-50 flex" onClick={onClose}>
        <div className="ml-auto w-full max-w-2xl bg-slate-800 h-full overflow-y-auto flex flex-col" onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-start justify-between p-5 border-b border-slate-700 sticky top-0 bg-slate-800 z-10">
            <div>
              <h3 className="text-white font-bold text-lg">{chantier.client_nom}</h3>
              <p className="text-slate-400 text-sm">{[chantier.ville, chantier.adresse].filter(Boolean).join(' — ')}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${statutBadge(chantier.statut).cls}`}>
                {statutBadge(chantier.statut).label}
              </span>
              <button onClick={onClose} className="w-9 h-9 bg-slate-700 hover:bg-slate-600 text-white rounded-full flex items-center justify-center text-xl transition">&times;</button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 p-4 border-b border-slate-700 flex-wrap">
            <button onClick={() => setTab('info')} className={tabCls('info')}>Info & Argent</button>
            <button onClick={() => setTab('planning')} className={tabCls('planning')}>Planning ({chantier.planning.length})</button>
            <button onClick={() => setTab('produits')} className={tabCls('produits')}>Produits ({chantier.produits.length})</button>
            <button onClick={() => setTab('photos')} className={tabCls('photos')}>Photos ({chantier.photos?.length ?? 0})</button>
          </div>

          <div className="p-5 space-y-5 flex-1">

            {/* ── Tab info ── */}
            {tab === 'info' && (
              <div className="space-y-4">
                {/* Sanity checks */}
                <div className="grid grid-cols-2 gap-3">
                  <div className={`rounded-lg p-3 border ${mainOeuvreOk ? 'border-green-500/40 bg-green-500/10' : 'border-red-500/40 bg-red-500/10'}`}>
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Main-d'œuvre</div>
                    <div className={`text-sm font-bold ${mainOeuvreOk ? 'text-green-400' : 'text-red-400'}`}>
                      {mainOeuvreOk ? '✓ OK' : '⚠ Dépassé'}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Coût réel: {formatMoney(chantier.cout_main_oeuvre)} / Budget: {formatMoney(chantier.montant_main_oeuvre)}
                    </div>
                  </div>
                  <div className={`rounded-lg p-3 border ${materielOk ? 'border-green-500/40 bg-green-500/10' : 'border-red-500/40 bg-red-500/10'}`}>
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Matériel</div>
                    <div className={`text-sm font-bold ${materielOk ? 'text-green-400' : 'text-red-400'}`}>
                      {materielOk ? '✓ OK' : '⚠ Dépassé'}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Coût réel: {formatMoney(totalProduits)} / Budget JJ: {formatMoney(chantier.montant_materiel)}
                    </div>
                  </div>
                </div>

                {editMode ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>Nom client</label>
                        <input type="text" value={f.client_nom} onChange={e => upd('client_nom', e.target.value)} className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Téléphone</label>
                        <input type="tel" value={f.client_tel} onChange={e => upd('client_tel', e.target.value)} className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Adresse</label>
                        <input type="text" value={f.adresse} onChange={e => upd('adresse', e.target.value)} className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Ville</label>
                        <input type="text" value={f.ville} onChange={e => upd('ville', e.target.value)} className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Service</label>
                        <input type="text" value={f.service} onChange={e => upd('service', e.target.value)} className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Superficie (pi²)</label>
                        <input type="number" inputMode="decimal" value={f.superficie} onChange={e => upd('superficie', e.target.value)} className={inputCls} />
                      </div>
                    </div>

                    <div>
                      <label className={labelCls}>Statut</label>
                      <select value={f.statut} onChange={e => upd('statut', e.target.value)} className={inputCls}>
                        {STATUTS_CHANTIER.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </select>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className={labelCls}>Contrat total ($)</label>
                        <input type="number" inputMode="decimal" value={f.montant_contrat} onChange={e => upd('montant_contrat', e.target.value)} className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Main-d'œuvre ($)</label>
                        <input type="number" inputMode="decimal" value={f.montant_main_oeuvre} onChange={e => upd('montant_main_oeuvre', e.target.value)} className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Matériel ($)</label>
                        <input type="number" inputMode="decimal" value={f.montant_materiel} onChange={e => upd('montant_materiel', e.target.value)} className={inputCls} />
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={f.depot_recu} onChange={e => upd('depot_recu', e.target.checked)} className="w-4 h-4 rounded accent-amber-500" />
                        <span className="text-sm text-slate-300">Dépôt reçu de JJ</span>
                      </label>
                      {f.depot_recu && (
                        <input type="number" inputMode="decimal" value={f.depot_montant} onChange={e => upd('depot_montant', e.target.value)} placeholder="Montant" className={`${inputCls} max-w-[130px]`} />
                      )}
                    </div>

                    <div>
                      <label className={labelCls}>Notes</label>
                      <textarea value={f.notes} onChange={e => upd('notes', e.target.value)} rows={3} className={inputCls} />
                    </div>

                    {err && <p className="text-red-400 text-sm">{err}</p>}

                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setEditMode(false)} className="px-4 py-2 text-sm rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition">Annuler</button>
                      <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-sm font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black transition">
                        {saving ? 'Sauvegarde...' : 'Sauvegarder'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="space-y-1">
                        <div className="text-slate-500 text-xs uppercase tracking-wider">Client</div>
                        <div className="text-white font-medium">{chantier.client_nom}</div>
                        {chantier.client_tel && <div className="text-slate-400">{chantier.client_tel}</div>}
                      </div>
                      <div className="space-y-1">
                        <div className="text-slate-500 text-xs uppercase tracking-wider">Chantier</div>
                        <div className="text-white">{chantier.ville || '—'}</div>
                        {chantier.adresse && <div className="text-slate-400 text-xs">{chantier.adresse}</div>}
                      </div>
                      {chantier.service && (
                        <div>
                          <div className="text-slate-500 text-xs uppercase tracking-wider">Service</div>
                          <div className="text-white">{chantier.service}</div>
                        </div>
                      )}
                      {chantier.superficie && (
                        <div>
                          <div className="text-slate-500 text-xs uppercase tracking-wider">Superficie</div>
                          <div className="text-white">{chantier.superficie} pi²</div>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-sm pt-2 border-t border-slate-700">
                      <div className={cardCls}>
                        <div className="text-slate-500 text-xs uppercase tracking-wider">Contrat</div>
                        <div className="text-white font-bold mt-1">{formatMoney(chantier.montant_contrat)}</div>
                      </div>
                      <div className={cardCls}>
                        <div className="text-slate-500 text-xs uppercase tracking-wider">Notre part</div>
                        <div className="text-amber-400 font-bold mt-1">{formatMoney(chantier.montant_main_oeuvre)}</div>
                      </div>
                      <div className={cardCls}>
                        <div className="text-slate-500 text-xs uppercase tracking-wider">Part JJ</div>
                        <div className="text-slate-300 font-bold mt-1">{formatMoney(chantier.montant_materiel)}</div>
                      </div>
                    </div>

                    {chantier.depot_recu && (
                      <div className="flex items-center gap-2 text-sm">
                        <span className="w-2 h-2 rounded-full bg-green-400 inline-block"></span>
                        <span className="text-green-400">Dépôt reçu de JJ</span>
                        {chantier.depot_montant && <span className="text-white font-semibold">{formatMoney(chantier.depot_montant)}</span>}
                      </div>
                    )}

                    {chantier.notes && (
                      <div className="bg-slate-900/60 rounded-lg p-3 text-sm text-slate-300 border border-slate-700">{chantier.notes}</div>
                    )}

                    <div className="flex gap-2 pt-2">
                      <button onClick={() => setEditMode(true)} className="px-4 py-2 text-sm font-medium rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition">
                        Modifier
                      </button>
                      {chantier.statut !== 'paye' && (
                        <button
                          onClick={async () => {
                            await fetch(`/api/jj/chantiers/${chantier.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ statut: 'paye' }) });
                            onChanged();
                          }}
                          className="px-4 py-2 text-sm font-semibold rounded-lg bg-green-600 hover:bg-green-500 text-white transition"
                        >
                          Marquer payé
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Tab planning ── */}
            {tab === 'planning' && (
              <div className="space-y-4">
                {chantier.planning.length === 0 ? (
                  <p className="text-slate-500 text-sm">Aucune journée planifiée</p>
                ) : (
                  <div className="space-y-2">
                    {chantier.planning.map(p => (
                      <div key={p.id} className="flex items-center justify-between bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2">
                        <div>
                          <div className="text-white text-sm font-medium">Jour {p.jour_numero} — {fmtDate(p.date)}</div>
                          <div className="text-slate-400 text-xs mt-0.5">
                            Équipe {p.equipe} &nbsp;·&nbsp;
                            {p.slot === 'custom' && p.heure_debut && p.heure_fin ? `${p.heure_debut}–${p.heure_fin}` : SLOT_LABEL[p.slot]}
                            {p.notes && ` · ${p.notes}`}
                          </div>
                        </div>
                        <button onClick={() => deletePlanning(p.id)} className="text-red-400 hover:text-red-300 text-lg transition ml-3">&times;</button>
                      </div>
                    ))}
                  </div>
                )}

                {showPlanForm ? (
                  <PlanningForm chantiers={[]} defaultChantierId={chantier.id} onSaved={() => { setShowPlanForm(false); onChanged(); }} onCancel={() => setShowPlanForm(false)} />
                ) : (
                  <button onClick={() => setShowPlanForm(true)} className="px-4 py-2 text-sm font-medium rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition">
                    + Ajouter une journée
                  </button>
                )}
              </div>
            )}

            {/* ── Tab produits ── */}
            {tab === 'produits' && (
              <div className="space-y-4">
                {chantier.produits.length > 0 && (
                  <div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-slate-400 text-xs uppercase border-b border-slate-700">
                          <th className="text-left pb-2">Produit</th>
                          <th className="text-right pb-2">Qté</th>
                          <th className="text-right pb-2">Prix unit.</th>
                          <th className="text-right pb-2">Total</th>
                          <th className="pb-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {chantier.produits.map(p => (
                          <tr key={p.id} className="border-b border-slate-800">
                            <td className="py-2 text-white">{p.nom}</td>
                            <td className="py-2 text-right text-slate-300">{p.quantite}</td>
                            <td className="py-2 text-right text-slate-300">{formatMoney(p.cout_unitaire)}</td>
                            <td className="py-2 text-right text-white font-medium">{formatMoney(p.quantite * p.cout_unitaire)}</td>
                            <td className="py-2 pl-2">
                              <button onClick={() => deleteProduit(p.id)} className="text-red-400 hover:text-red-300 text-lg transition">&times;</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={3} className="pt-2 text-slate-400 text-xs uppercase font-semibold">Total matériel</td>
                          <td className="pt-2 text-right text-white font-bold">{formatMoney(totalProduits)}</td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}

                {/* Add product */}
                <div className="bg-slate-900/60 rounded-lg p-4 border border-slate-700 space-y-3">
                  <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Ajouter un produit</h4>
                  <div>
                    <label className={labelCls}>Catalogue (optionnel)</label>
                    <select value={prodCatId} onChange={e => selectCatalogue(e.target.value)} className={inputCls}>
                      <option value="">Sélectionner du catalogue...</option>
                      {catalogue.map(c => <option key={c.id} value={c.id}>{c.nom} ({c.unite ?? 'unité'}) — {formatMoney(c.cout_unitaire)}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-3 sm:col-span-1">
                      <label className={labelCls}>Nom produit</label>
                      <input type="text" value={prodNom} onChange={e => setProdNom(e.target.value)} placeholder="Ex: Époxy flake" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Quantité</label>
                      <input type="number" inputMode="decimal" value={prodQte} onChange={e => setProdQte(e.target.value)} min={1} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Coût unit. ($)</label>
                      <input type="number" inputMode="decimal" value={prodPrix} onChange={e => setProdPrix(e.target.value)} placeholder="0" className={inputCls} />
                    </div>
                  </div>
                  <button onClick={addProduit} disabled={savingProd || !prodNom.trim()} className="px-4 py-2 text-sm font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black transition">
                    {savingProd ? 'Ajout...' : 'Ajouter'}
                  </button>
                </div>
              </div>
            )}

            {/* ── Tab photos ── */}
            {tab === 'photos' && (
              <div className="space-y-4">
                {chantier.photos && chantier.photos.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {chantier.photos.map((ph, i) => (
                      <div key={i} className="relative group rounded-lg overflow-hidden border border-slate-700">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={ph.url} alt={ph.type} className="w-full aspect-square object-cover" />
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition flex items-end p-2">
                          <span className="text-xs text-white font-semibold uppercase bg-slate-800/80 rounded px-1.5 py-0.5">{ph.type}</span>
                          <button onClick={() => deletePhoto(ph.type, ph.url)} className="ml-auto text-red-400 hover:text-red-300 text-lg">&times;</button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-500 text-sm">Aucune photo pour ce chantier</p>
                )}

                <div className="bg-slate-900/60 rounded-lg p-4 border border-slate-700 space-y-3">
                  <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Ajouter une photo</h4>
                  <div className="flex gap-3 items-end flex-wrap">
                    <div>
                      <label className={labelCls}>Type</label>
                      <select value={photoType} onChange={e => setPhotoType(e.target.value as 'avant' | 'apres')} className={inputCls}>
                        <option value="avant">Avant</option>
                        <option value="apres">Après</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Photo</label>
                      <input ref={fileRef} type="file" accept="image/*" onChange={uploadPhoto} className="text-sm text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-amber-500 file:text-black file:text-xs file:font-semibold hover:file:bg-amber-400 transition" />
                    </div>
                    {uploadingPhoto && <span className="text-slate-400 text-sm">Téléversement...</span>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/* ── Workers manager ── */
function WorkerRow({ w, onEdit, onChanged, onDelete }: { w: Worker; onEdit: () => void; onChanged: () => void; onDelete: () => void }) {
  const [savingEquipe, setSavingEquipe] = useState(false);

  // Sauvegarde immédiate du changement d'équipe (PATCH dès le onChange).
  async function changeEquipe(value: string) {
    setSavingEquipe(true);
    try {
      const equipe = value === '' ? null : Number(value);
      await fetch(`/api/jj/workers/${w.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ equipe }) });
      onChanged();
    } finally { setSavingEquipe(false); }
  }

  async function toggleActif() {
    await fetch(`/api/jj/workers/${w.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actif: !w.actif }) });
    onChanged();
  }

  return (
    <div className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 ${w.actif ? 'bg-slate-900/60 border border-slate-700' : 'bg-slate-900/30 border border-slate-800 opacity-60'}`}>
      <div className="min-w-0">
        <div className="text-white text-sm font-medium truncate">{w.nom} {!w.actif && <span className="text-slate-500 text-xs">(inactif)</span>}</div>
        <div className="text-slate-400 text-xs">{w.taux_horaire}$/h{w.telephone ? ` · ${w.telephone}` : ''}</div>
      </div>
      <div className="flex gap-2 items-center shrink-0">
        {/* Sélecteur d'équipe inline — sauvegarde immédiate */}
        <select
          value={w.equipe ?? ''}
          onChange={e => changeEquipe(e.target.value)}
          disabled={savingEquipe}
          className={`text-xs rounded-lg px-2 py-1 border bg-slate-800 focus:outline-none focus:ring-1 focus:ring-amber-500 transition disabled:opacity-50 ${
            w.equipe === 1 ? 'border-blue-500/50 text-blue-300' : w.equipe === 2 ? 'border-violet-500/50 text-violet-300' : 'border-slate-700 text-slate-400'
          }`}
        >
          <option value="">Aucune</option>
          <option value="1">Équipe 1</option>
          <option value="2">Équipe 2</option>
        </select>
        <button onClick={onEdit} className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 transition">Modifier</button>
        <button onClick={toggleActif} className="text-amber-400 hover:text-amber-300 text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 transition">
          {w.actif ? 'Désactiver' : 'Réactiver'}
        </button>
        <button onClick={onDelete} className="text-red-400 hover:text-red-300 text-lg leading-none">&times;</button>
      </div>
    </div>
  );
}

function WorkersSection({ workers, onChanged }: { workers: Worker[]; onChanged: () => void }) {
  const { confirm, Dialog: ConfirmDialog } = useConfirm();
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [nom, setNom] = useState('');
  const [taux, setTaux] = useState('');
  const [tel, setTel] = useState('');
  const [equipe, setEquipe] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  function resetForm() { setNom(''); setTaux(''); setTel(''); setEquipe(''); setErr(''); }

  async function handleAdd() {
    if (!nom.trim()) { setErr('Nom requis'); return; }
    setSaving(true); setErr('');
    try {
      const res = await fetch('/api/jj/workers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nom: nom.trim(), taux_horaire: Number(taux) || 0, telephone: tel.trim() || null, equipe: equipe === '' ? null : Number(equipe) }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErr((d as { error?: string }).error ?? 'Erreur'); return; }
      resetForm(); setShowAdd(false); onChanged();
    } catch { setErr('Erreur réseau'); }
    finally { setSaving(false); }
  }

  function startEdit(w: Worker) {
    setShowAdd(false);
    setEditId(w.id); setNom(w.nom); setTaux(String(w.taux_horaire)); setTel(w.telephone ?? ''); setEquipe(w.equipe ? String(w.equipe) : ''); setErr('');
  }

  async function handleEdit() {
    if (!editId) return;
    setSaving(true); setErr('');
    try {
      const res = await fetch(`/api/jj/workers/${editId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nom: nom.trim(), taux_horaire: Number(taux) || 0, telephone: tel.trim() || null, equipe: equipe === '' ? null : Number(equipe) }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErr((d as { error?: string }).error ?? 'Erreur'); return; }
      setEditId(null); resetForm(); onChanged();
    } catch { setErr('Erreur réseau'); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: number, name: string) {
    if (!(await confirm(`Supprimer ${name} ?`))) return;
    await fetch(`/api/jj/workers/${id}`, { method: 'DELETE' });
    onChanged();
  }

  const equipe1 = workers.filter(w => w.equipe === 1);
  const equipe2 = workers.filter(w => w.equipe === 2);
  const sansEquipe = workers.filter(w => !w.equipe);

  function renderGroup(title: string, list: Worker[], accent: string) {
    if (list.length === 0) return null;
    return (
      <div className="space-y-2">
        <h4 className={`text-xs font-semibold uppercase tracking-wider ${accent}`}>{title} <span className="text-slate-600">({list.length})</span></h4>
        {list.map(w => (
          <WorkerRow key={w.id} w={w} onEdit={() => startEdit(w)} onChanged={onChanged} onDelete={() => handleDelete(w.id, w.nom)} />
        ))}
      </div>
    );
  }

  return (
    <>
      {ConfirmDialog}
      <div className={`${cardCls} space-y-4`}>
        <div className="flex items-center justify-between">
          <h3 className="text-white font-semibold">👷 Workers JJ</h3>
          <button onClick={() => { setShowAdd(!showAdd); setEditId(null); resetForm(); }} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 text-black transition">
            + Ajouter
          </button>
        </div>

        {(showAdd || editId !== null) && (
          <div className="bg-slate-900/60 rounded-lg p-4 border border-slate-700 space-y-3">
            <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">{editId ? 'Modifier worker' : 'Nouveau worker'}</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <label className={labelCls}>Nom</label>
                <input type="text" value={nom} onChange={e => setNom(e.target.value)} placeholder="Ex: Marco" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Taux ($/h)</label>
                <input type="number" inputMode="decimal" value={taux} onChange={e => setTaux(e.target.value)} placeholder="25" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Téléphone</label>
                <input type="tel" value={tel} onChange={e => setTel(e.target.value)} placeholder="514-555-0000" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Équipe</label>
                <select value={equipe} onChange={e => setEquipe(e.target.value)} className={inputCls}>
                  <option value="">Aucune</option>
                  <option value="1">Équipe 1</option>
                  <option value="2">Équipe 2</option>
                </select>
              </div>
            </div>
            {err && <p className="text-red-400 text-xs">{err}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowAdd(false); setEditId(null); resetForm(); }} className="px-3 py-1.5 text-xs rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition">Annuler</button>
              <button onClick={editId ? handleEdit : handleAdd} disabled={saving} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black transition">
                {saving ? 'Sauvegarde...' : editId ? 'Sauvegarder' : 'Ajouter'}
              </button>
            </div>
          </div>
        )}

        {workers.length === 0 ? (
          <p className="text-slate-500 text-sm">Aucun worker JJ</p>
        ) : (
          <div className="space-y-5">
            {renderGroup('Équipe 1', equipe1, 'text-blue-400')}
            {renderGroup('Équipe 2', equipe2, 'text-violet-400')}
            {renderGroup('Sans équipe', sansEquipe, 'text-slate-400')}
          </div>
        )}
      </div>
    </>
  );
}

/* ── Catalogue section ── */
function CatalogueSection({ catalogue, onChanged }: { catalogue: CatalogueProduit[]; onChanged: () => void }) {
  const { confirm, Dialog: ConfirmDialog } = useConfirm();
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [nom, setNom] = useState('');
  const [prix, setPrix] = useState('');
  const [unite, setUnite] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  function reset() { setNom(''); setPrix(''); setUnite(''); setErr(''); }

  async function handleSave() {
    if (!nom.trim()) { setErr('Nom requis'); return; }
    setSaving(true); setErr('');
    try {
      const url = editId ? `/api/jj/catalogue/${editId}` : '/api/jj/catalogue';
      const method = editId ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nom: nom.trim(), cout_unitaire: Number(prix) || 0, unite: unite.trim() || null }) });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErr((d as { error?: string }).error ?? 'Erreur'); return; }
      setShowAdd(false); setEditId(null); reset(); onChanged();
    } catch { setErr('Erreur réseau'); }
    finally { setSaving(false); }
  }

  async function handleDelete(id: number) {
    if (!(await confirm('Supprimer ce produit du catalogue ?'))) return;
    await fetch(`/api/jj/catalogue/${id}`, { method: 'DELETE' });
    onChanged();
  }

  function startEdit(c: CatalogueProduit) {
    setEditId(c.id); setNom(c.nom); setPrix(String(c.cout_unitaire)); setUnite(c.unite ?? ''); setShowAdd(true); setErr('');
  }

  return (
    <>
      {ConfirmDialog}
      <div className={`${cardCls} space-y-4`}>
        <div className="flex items-center justify-between">
          <h3 className="text-white font-semibold">📦 Catalogue produits</h3>
          <button onClick={() => { setShowAdd(!showAdd); setEditId(null); reset(); }} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition">
            + Ajouter
          </button>
        </div>

        {showAdd && (
          <div className="bg-slate-900/60 rounded-lg p-4 border border-slate-700 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className={labelCls}>Nom</label>
                <input type="text" value={nom} onChange={e => setNom(e.target.value)} placeholder="Époxy flake base" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Coût unit. ($)</label>
                <input type="number" inputMode="decimal" value={prix} onChange={e => setPrix(e.target.value)} placeholder="0" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Unité</label>
                <input type="text" value={unite} onChange={e => setUnite(e.target.value)} placeholder="gallon, sac..." className={inputCls} />
              </div>
            </div>
            {err && <p className="text-red-400 text-xs">{err}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowAdd(false); setEditId(null); reset(); }} className="px-3 py-1.5 text-xs rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition">Annuler</button>
              <button onClick={handleSave} disabled={saving} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black transition">
                {saving ? 'Sauvegarde...' : editId ? 'Sauvegarder' : 'Ajouter'}
              </button>
            </div>
          </div>
        )}

        {catalogue.length === 0 ? (
          <p className="text-slate-500 text-sm">Catalogue vide — ajoutez vos produits habituels</p>
        ) : (
          <div className="space-y-1">
            {catalogue.map(c => (
              <div key={c.id} className="flex items-center justify-between rounded-lg px-3 py-2 bg-slate-900/60 border border-slate-700">
                <div>
                  <span className="text-white text-sm">{c.nom}</span>
                  {c.unite && <span className="text-slate-500 text-xs ml-2">({c.unite})</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-amber-400 text-sm font-semibold">{formatMoney(c.cout_unitaire)}</span>
                  <button onClick={() => startEdit(c)} className="text-slate-400 hover:text-white text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 transition">Modifier</button>
                  <button onClick={() => handleDelete(c.id)} className="text-red-400 hover:text-red-300 text-lg leading-none">&times;</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/* ── Heures section ── */
function HeuresSection({ workers, chantiers, onSummaryRefresh }: { workers: Worker[]; chantiers: Chantier[]; onSummaryRefresh: () => void }) {
  const { confirm, Dialog: ConfirmDialog } = useConfirm();

  const getWeekRange = useCallback(() => {
    const today = new Date();
    const mon = weekStart(today);
    const sun = addDays(mon, 6);
    return { from: toIso(mon), to: toIso(sun) };
  }, []);

  const [range, setRange] = useState(getWeekRange);
  const [data, setData] = useState<HeuresResult>({ data: [], par_worker: [] });
  const [loading, setLoading] = useState(false);

  // Toast (confirmation visuelle)
  const [toast, setToast] = useState('');
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  }, []);

  // Logger par équipe (action principale)
  const [teamDate, setTeamDate] = useState(toIso(new Date()));
  const [teamHeures, setTeamHeures] = useState('');
  const [teamChantierId, setTeamChantierId] = useState('');
  const [teamSaving, setTeamSaving] = useState<1 | 2 | null>(null);

  // Form manuel
  const [workerId, setWorkerId] = useState('');
  const [chantierId, setChantierId] = useState('');
  const [equipe, setEquipe] = useState<'1' | '2'>('1');
  const [date, setDate] = useState('');
  const [heures, setHeures] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const loadHeures = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ from: range.from, to: range.to });
    const res = await fetch(`/api/jj/heures?${params}`);
    if (res.ok) { const j = await res.json(); setData(j); }
    setLoading(false);
  }, [range]);

  useEffect(() => { loadHeures(); }, [loadHeures]);

  async function handleAdd() {
    if (!workerId || !date || !heures) { setErr('Worker, date et heures requis'); return; }
    setSaving(true); setErr('');
    try {
      const res = await fetch('/api/jj/heures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          worker_id: parseInt(workerId),
          chantier_id: chantierId ? parseInt(chantierId) : null,
          equipe: parseInt(equipe),
          date,
          heures: parseFloat(heures),
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErr((d as { error?: string }).error ?? 'Erreur'); return; }
      setHeures(''); setNotes('');
      loadHeures();
      onSummaryRefresh();
    } catch { setErr('Erreur réseau'); }
    finally { setSaving(false); }
  }

  async function logTeam(team: 1 | 2) {
    if (!teamHeures || !teamDate) { showToast('⚠️ Entre les heures et la date'); return; }
    setTeamSaving(team);
    try {
      const res = await fetch('/api/jj/heures/equipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipe: team,
          date: teamDate,
          heures: parseFloat(teamHeures),
          chantier_id: teamChantierId ? parseInt(teamChantierId) : null,
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); showToast('⚠️ ' + ((d as { error?: string }).error ?? 'Erreur')); return; }
      // Noms des workers loggés (depuis la liste locale) pour la confirmation.
      const noms = workers.filter(w => w.actif && w.equipe === team).map(w => w.nom);
      const detail = noms.length > 0 ? ` (${noms.join(', ')})` : '';
      showToast(`✅ ${teamHeures}h loggées pour Équipe ${team}${detail}`);
      setTeamHeures('');
      loadHeures();
      onSummaryRefresh();
    } catch { showToast('⚠️ Erreur réseau'); }
    finally { setTeamSaving(null); }
  }

  async function handleDelete(id: number) {
    if (!(await confirm('Supprimer cette entrée ?'))) return;
    await fetch(`/api/jj/heures/${id}`, { method: 'DELETE' });
    loadHeures();
    onSummaryRefresh();
  }

  async function marquerPaye(ids: number[]) {
    await Promise.all(ids.map(id => fetch(`/api/jj/heures/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paye: true }) })));
    loadHeures();
    onSummaryRefresh();
  }

  const activeWorkers = workers.filter(w => w.actif);

  return (
    <>
      {ConfirmDialog}
      <div className={`${cardCls} space-y-5`}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-white font-semibold">⏱️ Heures travaillées</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => setRange(r => { const d = new Date(r.from + 'T12:00:00'); d.setDate(d.getDate() - 7); const mon = weekStart(d); return { from: toIso(mon), to: toIso(addDays(mon, 6)) }; })} className="text-slate-300 hover:text-white px-2">◀</button>
            <span className="text-slate-400 text-xs font-medium">{range.from} → {range.to}</span>
            <button onClick={() => setRange(r => { const d = new Date(r.to + 'T12:00:00'); d.setDate(d.getDate() + 1); const mon = weekStart(d); return { from: toIso(mon), to: toIso(addDays(mon, 6)) }; })} className="text-slate-300 hover:text-white px-2">▶</button>
          </div>
        </div>

        {/* Toast */}
        {toast && (
          <div className="rounded-lg px-4 py-3 bg-green-500/15 border border-green-500/40 text-green-200 text-sm font-medium">
            {toast}
          </div>
        )}

        {/* ── Logger par équipe (action principale) ── */}
        <div className="rounded-xl p-4 border-2 border-amber-500/40 bg-amber-500/5 space-y-4">
          <h4 className="text-amber-300 text-sm font-bold">⚡ Logger les heures par équipe</h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Date</label>
              <input type="date" value={teamDate} onChange={e => setTeamDate(e.target.value)} className={`${inputCls} text-base py-3`} />
            </div>
            <div>
              <label className={labelCls}>Heures</label>
              <input type="number" inputMode="decimal" value={teamHeures} onChange={e => setTeamHeures(e.target.value)} placeholder="8" step={0.5} min={0} className={`${inputCls} text-base py-3`} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Chantier (optionnel)</label>
            <select value={teamChantierId} onChange={e => setTeamChantierId(e.target.value)} className={inputCls}>
              <option value="">— Aucun</option>
              {chantiers.map(c => <option key={c.id} value={c.id}>{c.client_nom}{c.ville ? ` · ${c.ville}` : ''}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => logTeam(1)}
              disabled={teamSaving !== null}
              className="py-4 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold text-base transition flex flex-col items-center gap-0.5"
            >
              <span>{teamSaving === 1 ? 'Enregistrement...' : 'Équipe 1'}</span>
              <span className="text-blue-200 text-xs font-normal">{workers.filter(w => w.actif && w.equipe === 1).map(w => w.nom).join(', ') || 'personne assigné'}</span>
            </button>
            <button
              onClick={() => logTeam(2)}
              disabled={teamSaving !== null}
              className="py-4 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-bold text-base transition flex flex-col items-center gap-0.5"
            >
              <span>{teamSaving === 2 ? 'Enregistrement...' : 'Équipe 2'}</span>
              <span className="text-violet-200 text-xs font-normal">{workers.filter(w => w.actif && w.equipe === 2).map(w => w.nom).join(', ') || 'personne assigné'}</span>
            </button>
          </div>
        </div>

        {/* Résumé par worker */}
        {data.par_worker.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {data.par_worker.map(pw => {
              const unpaidEntries = data.data.filter(h => h.worker_id === pw.worker_id && !h.paye);
              return (
                <div key={pw.worker_id} className="bg-slate-900/60 border border-slate-700 rounded-lg p-3">
                  <div className="text-white text-sm font-medium">{pw.nom}</div>
                  <div className="text-slate-400 text-xs">{pw.total_heures}h · {formatMoney(pw.total_montant)}</div>
                  {pw.montant_non_paye > 0 && (
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-red-400 text-xs font-semibold">À payer: {formatMoney(pw.montant_non_paye)}</span>
                      <button onClick={() => marquerPaye(unpaidEntries.map(e => e.id))} className="text-xs px-2 py-1 rounded bg-green-700 hover:bg-green-600 text-white transition">Payé</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Form log heures — option secondaire (1 worker à la fois) */}
        <div className="bg-slate-900/60 rounded-lg p-4 border border-slate-700 space-y-3">
          <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Ajouter des heures pour 1 worker</h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div>
              <label className={labelCls}>Worker</label>
              <select value={workerId} onChange={e => setWorkerId(e.target.value)} className={inputCls}>
                <option value="">Sélectionner...</option>
                {activeWorkers.map(w => <option key={w.id} value={w.id}>{w.nom} ({w.taux_horaire}$/h)</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Heures</label>
              <input type="number" inputMode="decimal" value={heures} onChange={e => setHeures(e.target.value)} placeholder="8" step={0.5} min={0} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Équipe</label>
              <select value={equipe} onChange={e => setEquipe(e.target.value as '1' | '2')} className={inputCls}>
                <option value="1">Équipe 1</option>
                <option value="2">Équipe 2</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Chantier (optionnel)</label>
              <select value={chantierId} onChange={e => setChantierId(e.target.value)} className={inputCls}>
                <option value="">—</option>
                {chantiers.map(c => <option key={c.id} value={c.id}>{c.client_nom}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Notes</label>
              <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optionnel" className={inputCls} />
            </div>
          </div>
          {err && <p className="text-red-400 text-xs">{err}</p>}
          <button onClick={handleAdd} disabled={saving} className="px-4 py-2 text-sm font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black transition">
            {saving ? 'Ajout...' : 'Ajouter les heures'}
          </button>
        </div>

        {/* Table */}
        {loading ? (
          <p className="text-slate-500 text-sm">Chargement...</p>
        ) : data.data.length === 0 ? (
          <p className="text-slate-500 text-sm">Aucune heure pour cette période</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 text-xs uppercase border-b border-slate-700">
                  <th className="text-left py-2 pr-3">Worker</th>
                  <th className="text-left py-2 pr-3">Date</th>
                  <th className="text-right py-2 pr-3">H</th>
                  <th className="text-right py-2 pr-3">Montant</th>
                  <th className="text-left py-2 pr-3">Chantier</th>
                  <th className="text-center py-2">Payé</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {data.data.map(h => {
                  const montant = h.heures * h.taux_horaire;
                  return (
                    <tr key={h.id} className="border-b border-slate-800 last:border-0">
                      <td className="py-2 pr-3 text-white font-medium">{h.worker_nom}</td>
                      <td className="py-2 pr-3 text-slate-300">{fmtDate(h.date)}</td>
                      <td className="py-2 pr-3 text-right text-slate-300">{h.heures}h</td>
                      <td className="py-2 pr-3 text-right text-white font-semibold">{formatMoney(montant)}</td>
                      <td className="py-2 pr-3 text-slate-400 text-xs">{h.chantier_client ?? '—'}</td>
                      <td className="py-2 text-center">
                        {h.paye ? (
                          <span className="text-green-400 text-xs font-semibold">✓ Payé</span>
                        ) : (
                          <button onClick={() => marquerPaye([h.id])} className="text-xs px-2 py-0.5 rounded bg-green-700 hover:bg-green-600 text-white transition">Payer</button>
                        )}
                      </td>
                      <td className="py-2 pl-2">
                        <button onClick={() => handleDelete(h.id)} className="text-red-400 hover:text-red-300 text-lg leading-none">&times;</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/* ─────────────────────────── WEEK VIEW ─────────────────────────── */

function WeekView({ chantiers, onChantierClick }: { chantiers: Chantier[]; onChantierClick: (c: Chantier) => void }) {
  const getWeekDates = useCallback((mon: Date) => Array.from({ length: 7 }, (_, i) => addDays(mon, i)), []);

  const today = new Date();
  const [weekMon, setWeekMon] = useState(() => weekStart(today));
  const [planning, setPlanning] = useState<Planning[]>([]);
  const [loading, setLoading] = useState(false);

  const weekDates = getWeekDates(weekMon);
  const from = toIso(weekDates[0]);
  const to = toIso(weekDates[6]);

  const loadPlanning = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/jj/planning?from=${from}&to=${to}`);
    if (res.ok) { const j = await res.json(); setPlanning(j.data ?? j); }
    setLoading(false);
  }, [from, to]);

  useEffect(() => { loadPlanning(); }, [loadPlanning]);

  function getBlocks(dateStr: string, equipe: 1 | 2) {
    return planning.filter(p => p.date === dateStr && p.equipe === equipe);
  }

  function chantierById(id: number) { return chantiers.find(c => c.id === id); }

  const DAYS_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

  return (
    <div className={`${cardCls} space-y-3`}>
      <div className="flex items-center justify-between">
        <h3 className="text-white font-semibold">📅 Semaine — 2 équipes</h3>
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekMon(d => addDays(d, -7))} className="text-slate-300 hover:text-white text-lg px-2 transition">◀</button>
          <span className="text-slate-400 text-sm font-medium">{weekDates[0].toLocaleDateString('fr-CA', { month: 'long', day: 'numeric' })} — {weekDates[6].toLocaleDateString('fr-CA', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
          <button onClick={() => setWeekMon(d => addDays(d, 7))} className="text-slate-300 hover:text-white text-lg px-2 transition">▶</button>
        </div>
      </div>

      {loading ? (
        <p className="text-slate-500 text-sm">Chargement...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[600px]">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left text-slate-500 uppercase tracking-wider py-2 pr-2 w-20">Jour</th>
                <th className="text-left text-blue-400 py-2 px-2 w-1/2">Équipe 1</th>
                <th className="text-left text-violet-400 py-2 px-2 w-1/2">Équipe 2</th>
              </tr>
            </thead>
            <tbody>
              {weekDates.map((d, i) => {
                const dateStr = toIso(d);
                const isToday = toIso(today) === dateStr;
                const blocks1 = getBlocks(dateStr, 1);
                const blocks2 = getBlocks(dateStr, 2);

                return (
                  <tr key={dateStr} className={`border-b border-slate-800 last:border-0 ${isToday ? 'bg-amber-500/5' : ''}`}>
                    <td className={`py-2 pr-2 font-semibold whitespace-nowrap ${isToday ? 'text-amber-400' : 'text-slate-400'}`}>
                      {DAYS_FR[i]}<br />
                      <span className="text-slate-600 font-normal">{d.getDate()}</span>
                    </td>
                    <td className="py-2 px-2 align-top">
                      <div className="space-y-1">
                        {blocks1.map(b => {
                          const ch = chantierById(b.chantier_id);
                          return (
                            <div key={b.id} onClick={() => ch && onChantierClick(ch)} className="bg-blue-500/20 border border-blue-500/40 rounded-md px-2 py-1 cursor-pointer hover:bg-blue-500/30 transition">
                              <div className="text-blue-200 font-semibold truncate">{b.client_nom || ch?.client_nom || '...'}</div>
                              <div className="text-blue-400 truncate">{b.ville || ch?.ville || ''} · Jour {b.jour_numero}</div>
                              <div className="text-blue-400/70">
                                {b.slot === 'custom' && b.heure_debut ? `${b.heure_debut}–${b.heure_fin}` : SLOT_LABEL[b.slot]}
                              </div>
                            </div>
                          );
                        })}
                        {blocks1.length === 0 && <span className="text-slate-700 italic">—</span>}
                      </div>
                    </td>
                    <td className="py-2 px-2 align-top">
                      <div className="space-y-1">
                        {blocks2.map(b => {
                          const ch = chantierById(b.chantier_id);
                          return (
                            <div key={b.id} onClick={() => ch && onChantierClick(ch)} className="bg-violet-500/20 border border-violet-500/40 rounded-md px-2 py-1 cursor-pointer hover:bg-violet-500/30 transition">
                              <div className="text-violet-200 font-semibold truncate">{b.client_nom || ch?.client_nom || '...'}</div>
                              <div className="text-violet-400 truncate">{b.ville || ch?.ville || ''} · Jour {b.jour_numero}</div>
                              <div className="text-violet-400/70">
                                {b.slot === 'custom' && b.heure_debut ? `${b.heure_debut}–${b.heure_fin}` : SLOT_LABEL[b.slot]}
                              </div>
                            </div>
                          );
                        })}
                        {blocks2.length === 0 && <span className="text-slate-700 italic">—</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── MAIN PAGE ─────────────────────────── */

export default function JJPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [chantiers, setChantiers] = useState<Chantier[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [catalogue, setCatalogue] = useState<CatalogueProduit[]>([]);
  const [loading, setLoading] = useState(true);
  const [headerError, setHeaderError] = useState(false);

  const [showNewChantier, setShowNewChantier] = useState(false);
  const [selectedChantier, setSelectedChantier] = useState<Chantier | null>(null);
  const [planFormId, setPlanFormId] = useState<number | null>(null);

  // Active tab/section
  const [section, setSection] = useState<'semaine' | 'chantiers' | 'workers' | 'heures' | 'catalogue'>('semaine');

  const loadSummary = useCallback(async () => {
    const res = await fetch('/api/jj/summary');
    if (res.ok) { const j = await res.json(); setSummary(j); }
  }, []);

  const loadChantiers = useCallback(async () => {
    const res = await fetch('/api/jj/chantiers');
    if (res.ok) { const j = await res.json(); setChantiers(j.data ?? []); }
  }, []);

  const loadWorkers = useCallback(async () => {
    const res = await fetch('/api/jj/workers');
    if (res.ok) { const j = await res.json(); setWorkers(j.data ?? j); }
  }, []);

  const loadCatalogue = useCallback(async () => {
    const res = await fetch('/api/jj/catalogue');
    if (res.ok) { const j = await res.json(); setCatalogue(j.data ?? j); }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadSummary(), loadChantiers(), loadWorkers(), loadCatalogue()]);
    setLoading(false);
  }, [loadSummary, loadChantiers, loadWorkers, loadCatalogue]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // When a chantier changes, find updated version if drawer is open
  const refreshAndUpdateDrawer = useCallback(async () => {
    await loadChantiers();
    await loadSummary();
    if (selectedChantier) {
      const res = await fetch(`/api/jj/chantiers/${selectedChantier.id}`);
      if (res.ok) { const j = await res.json(); setSelectedChantier(j.data ?? j); }
    }
  }, [loadChantiers, loadSummary, selectedChantier]);

  const aPlanifier = chantiers.filter(c => c.statut === 'a_planifier' || (c.planning.length === 0 && c.statut !== 'paye' && c.statut !== 'complete'));

  const navTabCls = (s: string) =>
    `px-4 py-2 text-sm font-medium rounded-lg transition whitespace-nowrap ${section === s ? 'bg-amber-500 text-black' : 'bg-slate-700/60 text-slate-300 hover:text-white hover:bg-slate-700'}`;

  const JOURS_FR = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      {/* ── Header ── */}
      <div className="rounded-xl overflow-hidden bg-slate-800 border border-slate-700">
        {!headerError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src="/jj-header.png"
            alt="Sous-traitance JJ"
            className="w-full h-32 sm:h-44 object-cover"
            onError={() => setHeaderError(true)}
          />
        ) : (
          <div className="h-28 sm:h-36 flex items-center justify-center bg-gradient-to-r from-slate-800 via-slate-700 to-slate-800">
            <div className="text-center">
              <div className="text-2xl sm:text-3xl font-bold text-white tracking-tight">NOVUS EPOXY <span className="text-amber-400">×</span> EPOXY JJ</div>
              <div className="text-slate-400 text-sm mt-1">Sous-traitance — Main-d'œuvre spécialisée</div>
            </div>
          </div>
        )}
        <div className="px-5 py-4 flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-white font-bold text-xl">Sous-traitance JJ</h2>
            <p className="text-slate-400 text-sm mt-0.5">
              {loading ? '...' : `${summary?.nb_chantiers ?? chantiers.length} chantier${(summary?.nb_chantiers ?? chantiers.length) !== 1 ? 's' : ''}`}
              {summary?.nb_a_planifier ? ` · ` : ''}{summary?.nb_a_planifier ? <span className="text-red-400">{summary.nb_a_planifier} à planifier</span> : null}
            </p>
          </div>
          <button
            onClick={() => setShowNewChantier(true)}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 text-black transition"
          >
            + Nouveau chantier
          </button>
        </div>
      </div>

      {/* ── Summary cards ── */}
      {summary && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <MoneyCard label="À recevoir de JJ" value={summary.a_recevoir} color="amber" />
            <MoneyCard label="Reçu" value={summary.recu} color="green" />
            <MoneyCard label="Coût main-d'œuvre" value={summary.cout_main_oeuvre} color="white" />
            <MoneyCard label="Coût matériel" value={summary.cout_materiel} color="white" />
            <MoneyCard label="Profit net" value={summary.profit} color={summary.profit >= 0 ? 'emerald' : 'red'} />
            <MoneyCard label="À payer workers (sem.)" value={summary.a_payer_workers} color="blue" />
          </div>

          {summary.par_worker.length > 0 && (
            <div className={cardCls}>
              <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-3">À payer chaque worker</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {summary.par_worker.map(pw => (
                  <div key={pw.worker_id} className="flex items-center justify-between bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2">
                    <div>
                      <div className="text-white text-sm font-medium">{pw.nom}</div>
                      <div className="text-slate-500 text-xs">{pw.heures_non_payees}h non payées</div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-red-400 text-sm font-bold">{formatMoney(pw.montant_du)}</span>
                      <button
                        onClick={async () => {
                          await fetch(`/api/jj/workers/${pw.worker_id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ marquer_paye: true }) });
                          loadSummary();
                        }}
                        className="text-xs px-2 py-0.5 rounded bg-green-700 hover:bg-green-600 text-white transition"
                      >
                        Payé ✓
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Nav tabs ── */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setSection('semaine')} className={navTabCls('semaine')}>📅 Semaine</button>
        <button onClick={() => setSection('chantiers')} className={navTabCls('chantiers')}>
          📋 Chantiers {aPlanifier.length > 0 && <span className="ml-1.5 bg-red-500 text-white text-xs rounded-full w-5 h-5 inline-flex items-center justify-center">{aPlanifier.length}</span>}
        </button>
        <button onClick={() => setSection('heures')} className={navTabCls('heures')}>⏱️ Heures</button>
        <button onClick={() => setSection('workers')} className={navTabCls('workers')}>👷 Workers</button>
        <button onClick={() => setSection('catalogue')} className={navTabCls('catalogue')}>📦 Catalogue</button>
      </div>

      {/* ── Section: Semaine ── */}
      {section === 'semaine' && (
        <WeekView chantiers={chantiers} onChantierClick={c => setSelectedChantier(c)} />
      )}

      {/* ── Section: Chantiers (À planifier + liste complète) ── */}
      {section === 'chantiers' && (
        <div className="space-y-5">
          {/* À planifier */}
          {aPlanifier.length > 0 && (
            <div className={`${cardCls} space-y-3`}>
              <h3 className="text-white font-semibold">📋 À planifier <span className="text-red-400 ml-1">({aPlanifier.length})</span></h3>
              <div className="space-y-2">
                {aPlanifier.map(c => (
                  <div key={c.id} className="bg-slate-900/60 border border-red-500/30 rounded-lg px-4 py-3 flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <div className="text-white font-medium">{c.client_nom}</div>
                      <div className="text-slate-400 text-sm">{[c.ville, c.adresse].filter(Boolean).join(' — ')}</div>
                      <div className="text-slate-500 text-xs mt-0.5">{c.service} {c.superficie ? `· ${c.superficie} pi²` : ''} · {formatMoney(c.montant_main_oeuvre)} main-d'œuvre</div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setSelectedChantier(c)} className="px-3 py-1.5 text-xs rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition">Voir détail</button>
                      <button
                        onClick={() => { setSelectedChantier(c); }}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 text-black transition"
                      >
                        Planifier
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* All chantiers table */}
          <div className={`${cardCls} space-y-3`}>
            <h3 className="text-white font-semibold">Tous les chantiers</h3>
            {loading ? (
              <p className="text-slate-500 text-sm">Chargement...</p>
            ) : chantiers.length === 0 ? (
              <p className="text-slate-500 text-sm">Aucun chantier — créez-en un avec le bouton ci-haut</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700 text-slate-400 text-xs uppercase tracking-wider">
                      <th className="text-left py-2 pr-3">Client</th>
                      <th className="text-left py-2 pr-3">Ville</th>
                      <th className="text-right py-2 pr-3">Main-d'œuvre</th>
                      <th className="text-right py-2 pr-3">Profit</th>
                      <th className="text-center py-2 pr-3">Planning</th>
                      <th className="text-center py-2">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chantiers.map(c => {
                      const badge = statutBadge(c.statut);
                      return (
                        <tr key={c.id} onClick={() => setSelectedChantier(c)} className="border-b border-slate-800 last:border-0 hover:bg-slate-900/40 cursor-pointer transition">
                          <td className="py-2.5 pr-3">
                            <div className="text-white font-medium">{c.client_nom}</div>
                            {c.client_tel && <div className="text-slate-500 text-xs">{c.client_tel}</div>}
                          </td>
                          <td className="py-2.5 pr-3 text-slate-300">{c.ville || '—'}</td>
                          <td className="py-2.5 pr-3 text-right text-amber-400 font-semibold">{formatMoney(c.montant_main_oeuvre)}</td>
                          <td className={`py-2.5 pr-3 text-right font-semibold ${c.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatMoney(c.profit)}</td>
                          <td className="py-2.5 pr-3 text-center text-slate-400 text-xs">
                            {c.planning.length > 0 ? (
                              <span className="text-cyan-400">{c.planning.length} jour{c.planning.length > 1 ? 's' : ''}</span>
                            ) : (
                              <span className="text-red-400">Non planifié</span>
                            )}
                          </td>
                          <td className="py-2.5 text-center">
                            <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${badge.cls}`}>{badge.label}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Section: Heures ── */}
      {section === 'heures' && (
        <HeuresSection workers={workers} chantiers={chantiers} onSummaryRefresh={loadSummary} />
      )}

      {/* ── Section: Workers ── */}
      {section === 'workers' && (
        <WorkersSection workers={workers} onChanged={loadWorkers} />
      )}

      {/* ── Section: Catalogue ── */}
      {section === 'catalogue' && (
        <CatalogueSection catalogue={catalogue} onChanged={loadCatalogue} />
      )}

      {/* ── Modals / Drawers ── */}
      {showNewChantier && (
        <NewChantierModal
          onClose={() => setShowNewChantier(false)}
          onCreated={() => { setShowNewChantier(false); loadAll(); }}
        />
      )}

      {selectedChantier && (
        <ChantierDrawer
          chantier={selectedChantier}
          workers={workers}
          catalogue={catalogue}
          onClose={() => setSelectedChantier(null)}
          onChanged={refreshAndUpdateDrawer}
        />
      )}

      {/* Inline plan form (used from planifier button) */}
      {planFormId && !selectedChantier && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={() => setPlanFormId(null)}>
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold">Planifier le chantier</h3>
              <button onClick={() => setPlanFormId(null)} className="text-slate-400 hover:text-white text-2xl">&times;</button>
            </div>
            <PlanningForm
              chantiers={chantiers.filter(c => c.id === planFormId)}
              defaultChantierId={planFormId}
              onSaved={() => { setPlanFormId(null); loadAll(); }}
              onCancel={() => setPlanFormId(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
