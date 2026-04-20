'use client';

import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

type Statut = 'nouveau' | 'offre_envoyee' | 'contacte' | 'devis_envoye' | 'rdv_pris' | 'ferme' | 'gagne';
type Temperature = 'chaud' | 'tiede' | 'froid';
type LeadType = 'residentiel' | 'commercial';

const SERVICE_LABELS: Record<string, string> = {
  flake: 'Flocon (Flake)', metallique: 'Métallique', couleur_unie: 'Couleur unie',
  quartz: 'Quartz', commercial: 'Commercial', antiderapant: 'Antidérapant', meulage: 'Meulage',
};

interface Lead {
  id: number;
  nom: string;
  telephone: string | null;
  email: string | null;
  service: string | null;
  superficie: string | null;
  ville: string | null;
  adresse: string | null;
  notes: string | null;
  source: string;
  statut: Statut;
  temperature: Temperature;
  type?: LeadType;
  prospect_sent_at: string | null;
  created_at: string;
}

const STATUTS: Statut[] = ['nouveau', 'offre_envoyee', 'contacte', 'devis_envoye', 'rdv_pris', 'ferme', 'gagne'];

const STATUT_LABEL: Record<Statut, string> = {
  nouveau:       'Nouveau',
  offre_envoyee: 'Offre envoyée',
  contacte:      'Contacté',
  devis_envoye:  'Devis envoyé',
  rdv_pris:      'RDV pris',
  ferme:         'Fermé',
  gagne:         'Gagné',
};

const STATUT_BADGE: Record<Statut, string> = {
  nouveau:       'bg-slate-500/20 text-slate-300 border-slate-500/30',
  offre_envoyee: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  contacte:      'bg-blue-500/20 text-blue-300 border-blue-500/30',
  devis_envoye:  'bg-orange-500/20 text-orange-300 border-orange-500/30',
  rdv_pris:      'bg-purple-500/20 text-purple-300 border-purple-500/30',
  ferme:         'bg-red-500/20 text-red-300 border-red-500/30',
  gagne:         'bg-green-500/20 text-green-300 border-green-500/30',
};

const TEMP_LABEL: Record<Temperature, string> = {
  chaud: '🔥 Chaud',
  tiede: '🟡 Tiède',
  froid: '🔵 Froid',
};

const TEMP_BADGE: Record<Temperature, string> = {
  chaud: 'bg-red-500/20 text-red-300 border-red-500/30',
  tiede: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  froid: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
};

const FILTER_TABS: { value: string; label: string }[] = [
  { value: '',             label: 'Tous' },
  { value: 'nouveau',      label: 'Nouveau' },
  { value: 'contacte',     label: 'Contacté' },
  { value: 'rdv_pris',     label: 'RDV pris' },
  { value: 'devis_envoye', label: 'Devis envoyé' },
  { value: 'gagne',        label: 'Gagné' },
  { value: 'ferme',        label: 'Fermé' },
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-CA', { day: '2-digit', month: 'short', year: 'numeric' });
}

function LeadDetail({ lead, onUpdate, onClose }: { lead: Lead; onUpdate: () => void; onClose: () => void }) {
  const [form, setForm] = useState({
    telephone: lead.telephone ?? '',
    email: lead.email ?? '',
    service: lead.service ?? '',
    superficie: lead.superficie ?? '',
    ville: lead.ville ?? '',
    adresse: lead.adresse ?? '',
    notes: lead.notes ?? '',
    type: lead.type ?? 'residentiel',
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    await fetch(`/api/crm/leads?id=${lead.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    onUpdate();
  }

  const inputCls = 'bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 w-full';

  return (
    <tr className="bg-slate-800/80 border-b border-slate-700">
      <td colSpan={11} className="px-4 sm:px-6 py-4">
        <div className="flex justify-between items-center mb-3">
          <p className="text-white font-semibold text-sm">{lead.nom}</p>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl px-2">&times;</button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-slate-500 text-xs mb-1 block">Telephone</label>
            <input value={form.telephone} onChange={e => setForm(f => ({ ...f, telephone: e.target.value }))} placeholder="581-XXX-XXXX" className={inputCls} />
          </div>
          <div>
            <label className="text-slate-500 text-xs mb-1 block">Email</label>
            <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="email@..." className={inputCls} />
          </div>
          <div>
            <label className="text-slate-500 text-xs mb-1 block">Service</label>
            <select value={form.service} onChange={e => setForm(f => ({ ...f, service: e.target.value }))} className={inputCls}>
              <option value="">—</option>
              <option value="flake">Flake / Flocon</option>
              <option value="metallique">Metallique</option>
              <option value="couleur_unie">Couleur unie</option>
              <option value="quartz">Quartz</option>
              <option value="commercial">Commercial</option>
              <option value="antiderapant">Antiderapant</option>
              <option value="meulage">Meulage</option>
            </select>
          </div>
          <div>
            <label className="text-slate-500 text-xs mb-1 block">Superficie (pi²)</label>
            <input value={form.superficie} onChange={e => setForm(f => ({ ...f, superficie: e.target.value }))} placeholder="ex: 800" className={inputCls} />
          </div>
          <div>
            <label className="text-slate-500 text-xs mb-1 block">Ville</label>
            <input value={form.ville} onChange={e => setForm(f => ({ ...f, ville: e.target.value }))} placeholder="Quebec, Levis..." className={inputCls} />
          </div>
          <div className="col-span-2 sm:col-span-3">
            <label className="text-slate-500 text-xs mb-1 block">Adresse</label>
            <input value={form.adresse} onChange={e => setForm(f => ({ ...f, adresse: e.target.value }))} placeholder="123 rue Example, Quebec G1A 1A1" className={inputCls} />
          </div>
          <div>
            <label className="text-slate-500 text-xs mb-1 block">Type</label>
            <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as LeadType }))} className={inputCls}>
              <option value="residentiel">Residentiel</option>
              <option value="commercial">Commercial</option>
            </select>
          </div>
          <div className="col-span-2 sm:col-span-3">
            <label className="text-slate-500 text-xs mb-1 block">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Details du projet, adresse, infos de l'appel..." rows={3} className={inputCls} />
          </div>
        </div>
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          <button onClick={save} disabled={saving} className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold rounded-lg px-5 py-2 text-sm transition disabled:opacity-50">
            {saving ? 'Sauvegarde...' : saved ? '✓ Sauvegarde!' : 'Sauvegarder'}
          </button>
          <a
            href={`/dashboard/devis/nouveau?lead_id=${lead.id}&nom=${encodeURIComponent(lead.nom)}&email=${encodeURIComponent(lead.email ?? '')}&tel=${encodeURIComponent(lead.telephone ?? '')}&ville=${encodeURIComponent(form.adresse || form.ville)}&service=${encodeURIComponent(form.service)}&superficie=${encodeURIComponent(form.superficie)}&notes=${encodeURIComponent(form.notes)}`}
            className="bg-orange-500 hover:bg-orange-400 text-white font-semibold rounded-lg px-5 py-2.5 text-sm transition inline-flex items-center gap-1.5"
          >
            Creer devis
          </a>
          {lead.telephone && (
            <a href={`tel:${lead.telephone.replace(/[^0-9+]/g, '')}`} className="bg-green-600 hover:bg-green-500 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition min-h-[44px] inline-flex items-center">
              Appeler
            </a>
          )}
          {lead.email && (
            <a href={`mailto:${lead.email}`} className="text-amber-400 hover:text-amber-300 text-sm">
              {lead.email}
            </a>
          )}
        </div>
      </td>
    </tr>
  );
}

function LeadRow({ lead, onUpdate, onProspect, prospecting, isSelected, onToggle, onExpand, isExpanded }: { lead: Lead; onUpdate: () => void; onProspect: (id: number) => void; prospecting: boolean; isSelected: boolean; onToggle: (id: number) => void; onExpand: (id: number) => void; isExpanded: boolean }) {
  const [loadingStatut, setLoadingStatut] = useState(false);
  const [loadingTemp, setLoadingTemp]     = useState(false);
  const [copied, setCopied]               = useState(false);

  async function patchLead(payload: { statut?: Statut; temperature?: Temperature }) {
    const res = await fetch(`/api/crm/leads?id=${lead.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) onUpdate();
  }

  async function handleStatut(statut: Statut) {
    setLoadingStatut(true);
    await patchLead({ statut });
    setLoadingStatut(false);
  }

  async function handleTemp(temperature: Temperature) {
    setLoadingTemp(true);
    await patchLead({ temperature });
    setLoadingTemp(false);
  }

  async function handleDelete() {
    if (!confirm(`Supprimer ${lead.nom} ?`)) return;
    await fetch(`/api/crm/leads?id=${lead.id}`, { method: 'DELETE' });
    onUpdate();
  }

  function copyPhone() {
    if (!lead.telephone) return;
    navigator.clipboard.writeText(lead.telephone);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
    <tr className="border-b border-slate-700 hover:bg-slate-700/30 transition cursor-pointer">
      <td className="px-2 sm:px-4 py-3">
        <input type="checkbox" checked={isSelected} onChange={() => onToggle(lead.id)} disabled={!lead.email || !!lead.prospect_sent_at} className="accent-amber-500" />
      </td>
      <td className="px-2 sm:px-4 py-3 cursor-pointer" onClick={() => onExpand(lead.id)}>
        <div className="flex items-center gap-2">
          <p className="text-white text-sm font-medium hover:text-amber-400 transition">{lead.nom}</p>
          {lead.type === 'commercial' && <span className="text-[10px] font-semibold bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded border border-purple-500/30">Com.</span>}
          {lead.type === 'residentiel' && <span className="text-[10px] font-semibold bg-sky-500/20 text-sky-300 px-1.5 py-0.5 rounded border border-sky-500/30">Rés.</span>}
        </div>
        <div className="flex gap-1 items-center mt-0.5">
          {lead.source && <span className="text-slate-500 text-xs">via {lead.source}</span>}
          {lead.prospect_sent_at && <span className="text-emerald-400 text-[10px] font-medium bg-emerald-500/20 px-1.5 py-0.5 rounded">Offre envoyee</span>}
        </div>
      </td>
      <td className="px-2 sm:px-4 py-3">
        {lead.telephone ? (
          <div className="flex items-center gap-1.5">
            <a
              href={`tel:${lead.telephone.replace(/[^0-9+]/g, '')}`}
              className="text-amber-400 hover:text-amber-300 transition text-sm font-medium py-1 px-1 -mx-1 inline-block min-h-[44px] flex items-center"
              title="Appeler"
            >
              {lead.telephone}
            </a>
            <button
              onClick={copyPhone}
              className="text-slate-500 hover:text-white transition text-xs"
              title="Copier"
            >
              {copied ? '✓' : '📋'}
            </button>
          </div>
        ) : (
          <span className="text-slate-600 text-sm">—</span>
        )}
      </td>
      <td className="px-2 sm:px-4 py-3 text-slate-300 text-xs sm:text-sm">
        {lead.email ?? <span className="text-slate-600">—</span>}
      </td>
      <td className="px-2 sm:px-4 py-3 text-slate-300 text-xs sm:text-sm">
        {lead.service ? (SERVICE_LABELS[lead.service] ?? lead.service) : <span className="text-slate-600">—</span>}
      </td>
      <td className="px-2 sm:px-4 py-3 text-slate-300 text-xs sm:text-sm max-w-[150px] truncate" title={lead.adresse ?? ''}>
        {lead.adresse ?? <span className="text-slate-600">—</span>}
      </td>
      <td className="px-2 sm:px-4 py-3 text-slate-300 text-xs sm:text-sm">
        {lead.ville ?? <span className="text-slate-600">—</span>}
      </td>
      <td className="px-2 sm:px-4 py-3">
        <select
          value={lead.temperature}
          disabled={loadingTemp}
          onChange={e => handleTemp(e.target.value as Temperature)}
          className={`text-xs font-medium px-2 py-1 rounded border bg-transparent cursor-pointer ${TEMP_BADGE[lead.temperature]}`}
        >
          {(['chaud', 'tiede', 'froid'] as Temperature[]).map(t => (
            <option key={t} value={t} className="bg-slate-800 text-white">{TEMP_LABEL[t]}</option>
          ))}
        </select>
      </td>
      <td className="px-2 sm:px-4 py-3">
        <select
          value={lead.statut}
          disabled={loadingStatut}
          onChange={e => handleStatut(e.target.value as Statut)}
          className={`text-xs font-medium px-2 py-1 rounded border bg-transparent cursor-pointer ${STATUT_BADGE[lead.statut]}`}
        >
          {STATUTS.map(s => (
            <option key={s} value={s} className="bg-slate-800 text-white">{STATUT_LABEL[s]}</option>
          ))}
        </select>
      </td>
      <td className="px-2 sm:px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{formatDate(lead.created_at)}</td>
      <td className="px-2 sm:px-4 py-3 whitespace-nowrap">
        <div className="flex gap-2">
          {lead.email && (
            <button
              onClick={() => onProspect(lead.id)}
              disabled={prospecting}
              className="text-amber-400 hover:text-amber-300 transition text-xs font-medium disabled:opacity-40"
              title="Envoyer offre par email"
            >
              {prospecting ? '...' : 'Offre'}
            </button>
          )}
          <button
            onClick={handleDelete}
            className="text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition p-1.5 rounded"
            title="Supprimer ce lead"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </td>
    </tr>
    {isExpanded && <LeadDetail lead={lead} onUpdate={onUpdate} onClose={() => onExpand(lead.id)} />}
    </>
  );
}

export default function CrmClient() {
  const searchParams = useSearchParams();
  const initialSource = searchParams.get('source') || '';
  const [leads, setLeads]     = useState<Lead[]>([]);
  const [total, setTotal]     = useState(0);
  const [stats, setStats]     = useState({ chaud: 0, tiede: 0, froid: 0 });
  const [page, setPage]       = useState(1);
  const [statut, setStatut]   = useState('');
  const [type, setType]       = useState('');
  const [tempFilter, setTempFilter] = useState('');
  const [search, setSearch]   = useState('');
  const [sourceFilter, setSourceFilter] = useState(initialSource);
  const [sources, setSources] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newLead, setNewLead] = useState({ nom: '', telephone: '', email: '', ville: '', notes: '', type: 'residentiel' as LeadType });
  const [adding, setAdding]   = useState(false);
  const [prospectingId, setProspectingId] = useState<number | null>(null);
  const [prospectMsg, setProspectMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Import modal state
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importSource, setImportSource] = useState('jason');
  const [importParsing, setImportParsing] = useState(false);
  const [importPreview, setImportPreview] = useState<Array<{ nom: string; telephone: string; email: string; service: string; ville: string; temperature: string }> | null>(null);
  const [importResult, setImportResult] = useState<{ importes: number; ignores: number; prospect?: { emails: number; sms: number } } | null>(null);
  const [importing, setImporting] = useState(false);
  const [autoProspect, setAutoProspect] = useState(true);
  const [bulkSending, setBulkSending] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  function toggleSelect(id: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const eligible = leads.filter(l => l.email && !l.prospect_sent_at);
    if (selected.size === eligible.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(eligible.map(l => l.id)));
    }
  }

  async function sendProspect(leadId: number) {
    if (!confirm('Envoyer l\'offre de service par email a ce lead ?')) return;
    setProspectingId(leadId);
    setProspectMsg(null);
    try {
      const res = await fetch('/api/leads/hunter/prospect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds: [leadId] }),
      });
      const json = await res.json();
      if (json.sent > 0) {
        setProspectMsg({ text: `Offre envoyee a ${json.results?.[0]?.nom ?? 'lead'}`, ok: true });
        load();
      } else {
        setProspectMsg({ text: json.results?.[0]?.error ?? json.error ?? 'Erreur', ok: false });
      }
    } catch {
      setProspectMsg({ text: 'Erreur reseau', ok: false });
    }
    setProspectingId(null);
    setTimeout(() => setProspectMsg(null), 4000);
  }

  async function sendBulk() {
    if (selected.size === 0) return;
    if (!confirm(`Envoyer l'offre a ${selected.size} lead(s) ?`)) return;
    setBulkSending(true);
    setProspectMsg(null);
    try {
      const res = await fetch('/api/leads/hunter/prospect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds: Array.from(selected) }),
      });
      const json = await res.json();
      setProspectMsg({ text: `${json.sent} offre(s) envoyee(s), ${json.skipped ?? 0} deja envoyee(s)`, ok: json.sent > 0 });
      setSelected(new Set());
      load();
    } catch {
      setProspectMsg({ text: 'Erreur reseau', ok: false });
    }
    setBulkSending(false);
    setTimeout(() => setProspectMsg(null), 5000);
  }

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', '25');
    if (statut) params.set('statut', statut);
    if (type) params.set('type', type);
    if (tempFilter) params.set('temperature', tempFilter);
    if (sourceFilter) params.set('source', sourceFilter);
    if (search) params.set('search', search);

    const res = await fetch(`/api/crm/leads?${params}`);
    if (res.ok) {
      const json = await res.json();
      setLeads(json.data);
      setTotal(json.total);
      if (json.stats) setStats(json.stats);
      if (json.sources) setSources(json.sources);
    }
    setLoading(false);
  }, [page, statut, type, tempFilter, sourceFilter, search]);

  async function handleAddLead() {
    if (!newLead.nom.trim()) return;
    setAdding(true);
    await fetch('/api/crm/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newLead, source: 'manuel' }),
    });
    setNewLead({ nom: '', telephone: '', email: '', ville: '', notes: '', type: 'residentiel' });
    setShowAdd(false);
    setAdding(false);
    load();
  }

  async function handleImportParse() {
    if (!importText.trim()) return;
    setImportParsing(true);
    setImportPreview(null);
    setImportResult(null);
    const res = await fetch('/api/crm/leads/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'parse', text: importText }),
    });
    if (res.ok) {
      const json = await res.json();
      setImportPreview(json.leads ?? []);
    }
    setImportParsing(false);
  }

  async function handleImportConfirm() {
    if (!importPreview?.length) return;
    setImporting(true);
    const res = await fetch('/api/crm/leads/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'import', leads: importPreview, source: importSource, autoProspect }),
    });
    if (res.ok) {
      const json = await res.json();
      setImportResult(json);
      setImportPreview(null);
      setImportText('');
      load();
    }
    setImporting(false);
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setImportText(ev.target?.result as string ?? '');
      setImportPreview(null);
      setImportResult(null);
    };
    reader.readAsText(file);
  }

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <h2 className="text-xl sm:text-2xl font-bold text-white">CRM Leads</h2>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <span className="text-slate-400 text-sm">{total} au total</span>
          <button onClick={() => { setShowImport(!showImport); setShowAdd(false); }} className="bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg px-3 sm:px-4 py-2 text-sm transition">
            Importer
          </button>
          <button onClick={() => { setShowAdd(!showAdd); setShowImport(false); }} className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold rounded-lg px-3 sm:px-4 py-2 text-sm transition">
            + Nouveau lead
          </button>
        </div>
      </div>

      {showAdd && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <input placeholder="Nom *" value={newLead.nom} onChange={e => setNewLead(p => ({ ...p, nom: e.target.value }))} className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500" />
            <input placeholder="Téléphone" value={newLead.telephone} onChange={e => setNewLead(p => ({ ...p, telephone: e.target.value }))} className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500" />
            <input placeholder="Email" value={newLead.email} onChange={e => setNewLead(p => ({ ...p, email: e.target.value }))} className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500" />
            <input placeholder="Ville" value={newLead.ville} onChange={e => setNewLead(p => ({ ...p, ville: e.target.value }))} className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500" />
            <select value={newLead.type} onChange={e => setNewLead(p => ({ ...p, type: e.target.value as LeadType }))} className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500">
              <option value="residentiel">Résidentiel</option>
              <option value="commercial">Commercial</option>
            </select>
            <input placeholder="Notes" value={newLead.notes} onChange={e => setNewLead(p => ({ ...p, notes: e.target.value }))} className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleAddLead} disabled={adding || !newLead.nom.trim()} className="bg-green-600 hover:bg-green-500 text-white font-semibold rounded-lg px-4 py-2 text-sm transition disabled:opacity-40">
              {adding ? 'Ajout...' : 'Ajouter'}
            </button>
            <button onClick={() => setShowAdd(false)} className="bg-slate-700 text-slate-300 rounded-lg px-4 py-2 text-sm transition hover:bg-slate-600">Annuler</button>
          </div>
        </div>
      )}

      {showImport && (
        <div className="bg-slate-800 border border-blue-500/30 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-white font-semibold text-lg">Importer des leads en bulk</h3>
            <button onClick={() => { setShowImport(false); setImportPreview(null); setImportResult(null); }} className="text-slate-400 hover:text-white text-lg">&times;</button>
          </div>

          {importResult ? (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 text-center space-y-2">
              <p className="text-green-400 font-semibold text-lg">{importResult.importes} leads importes!</p>
              {importResult.ignores > 0 && <p className="text-slate-400 text-sm">{importResult.ignores} ignores (nom manquant)</p>}
              {importResult.prospect && (
                <p className="text-blue-400 text-sm font-medium">
                  Prospection auto: {importResult.prospect.emails} emails + {importResult.prospect.sms} SMS envoyes
                </p>
              )}
              <button onClick={() => { setImportResult(null); setShowImport(false); }} className="bg-green-600 hover:bg-green-500 text-white rounded-lg px-4 py-2 text-sm font-semibold mt-2">Fermer</button>
            </div>
          ) : importPreview ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-slate-300 text-sm">{importPreview.length} leads detectes — verifie avant d&apos;importer</p>
                <select value={importSource} onChange={e => setImportSource(e.target.value)} className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white">
                  <option value="jason">Source: Jason</option>
                  <option value="luca">Source: Luca</option>
                  <option value="champfield">Source: Champfield</option>
                  <option value="google_ads">Source: Google Ads</option>
                  <option value="facebook">Source: Facebook</option>
                  <option value="autre">Source: Autre</option>
                </select>
              </div>
              <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-700">
                <table className="w-full text-sm">
                  <thead className="bg-slate-700/50 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 text-slate-400 font-medium">Nom</th>
                      <th className="text-left px-3 py-2 text-slate-400 font-medium">Tel</th>
                      <th className="text-left px-3 py-2 text-slate-400 font-medium">Email</th>
                      <th className="text-left px-3 py-2 text-slate-400 font-medium">Ville</th>
                      <th className="text-left px-3 py-2 text-slate-400 font-medium">Temp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.slice(0, 100).map((l, i) => (
                      <tr key={i} className="border-t border-slate-700/50">
                        <td className="px-3 py-1.5 text-white">{l.nom}</td>
                        <td className="px-3 py-1.5 text-slate-300">{l.telephone || '—'}</td>
                        <td className="px-3 py-1.5 text-slate-300">{l.email || '—'}</td>
                        <td className="px-3 py-1.5 text-slate-300">{l.ville || '—'}</td>
                        <td className="px-3 py-1.5">
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${l.temperature === 'chaud' ? 'bg-red-500/20 text-red-300' : l.temperature === 'froid' ? 'bg-blue-500/20 text-blue-300' : 'bg-yellow-500/20 text-yellow-300'}`}>
                            {l.temperature === 'chaud' ? '🔥' : l.temperature === 'froid' ? '🔵' : '🟡'} {l.temperature}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {importPreview.length > 100 && <p className="text-slate-500 text-xs text-center py-2">+ {importPreview.length - 100} autres...</p>}
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={autoProspect} onChange={e => setAutoProspect(e.target.checked)} className="accent-amber-500 w-4 h-4" />
                  <span className="text-sm text-slate-300">Envoyer offres automatiquement (email + SMS)</span>
                </label>
              </div>
              <div className="flex gap-2">
                <button onClick={handleImportConfirm} disabled={importing} className="bg-green-600 hover:bg-green-500 text-white font-semibold rounded-lg px-5 py-2 text-sm transition disabled:opacity-40">
                  {importing ? `Import en cours...` : autoProspect ? `Importer + Envoyer ${importPreview.length} offres` : `Importer ${importPreview.length} leads`}
                </button>
                <button onClick={() => setImportPreview(null)} className="bg-slate-700 text-slate-300 rounded-lg px-4 py-2 text-sm hover:bg-slate-600">Modifier</button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-slate-400 text-sm">Colle ta liste de contacts ou upload un fichier CSV/TXT. Format libre — l&apos;IA detecte automatiquement les noms, telephones, emails, villes.</p>
              <textarea
                value={importText}
                onChange={e => setImportText(e.target.value)}
                placeholder={"Jean Tremblay, 581-234-5678, jean@email.com, Quebec\nMarie Lavoie, 418-555-1234, Levis\nPierre Gagnon, pgagnon@gmail.com, garage flake 800pi2, Beauport"}
                rows={8}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
              />
              <div className="flex items-center gap-3">
                <label className="bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg px-4 py-2 text-sm cursor-pointer transition border border-slate-600">
                  Upload CSV/TXT
                  <input type="file" accept=".csv,.txt,.tsv" onChange={handleImportFile} className="hidden" />
                </label>
                <button
                  onClick={handleImportParse}
                  disabled={importParsing || !importText.trim()}
                  className="bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg px-5 py-2 text-sm transition disabled:opacity-40"
                >
                  {importParsing ? 'Analyse en cours...' : 'Analyser'}
                </button>
                <span className="text-slate-500 text-xs">{importText.split('\n').filter(l => l.trim()).length} lignes</span>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total',     value: total,       color: 'text-white',      filter: '' },
          { label: '🔥 Chaud',  value: stats.chaud, color: 'text-red-400',    filter: 'chaud' },
          { label: '🟡 Tiède',  value: stats.tiede, color: 'text-yellow-400', filter: 'tiede' },
          { label: '🔵 Froid',  value: stats.froid, color: 'text-blue-400',   filter: 'froid' },
        ].map(({ label, value, color, filter }) => (
          <button
            key={label}
            onClick={() => { setTempFilter(tempFilter === filter ? '' : filter); setPage(1); }}
            className={`bg-slate-800 border rounded-xl px-4 py-3 text-left transition cursor-pointer hover:bg-slate-700/50 ${
              tempFilter === filter && filter ? 'border-amber-500 ring-1 ring-amber-500/50' : 'border-slate-700'
            }`}
          >
            <p className="text-slate-400 text-xs mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
          </button>
        ))}
      </div>

      {/* Filters — one compact row */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <input
          type="text"
          placeholder="Rechercher..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 w-full sm:w-48"
        />
        <select
          value={statut}
          onChange={e => { setStatut(e.target.value); setPage(1); }}
          className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
        >
          <option value="">Tous les statuts</option>
          {STATUTS.map(s => <option key={s} value={s}>{STATUT_LABEL[s]}</option>)}
        </select>
        <select
          value={type}
          onChange={e => { setType(e.target.value); setPage(1); }}
          className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
        >
          <option value="">Rés. + Com.</option>
          <option value="residentiel">Résidentiel</option>
          <option value="commercial">Commercial</option>
        </select>
        {Object.keys(sources).filter(k => k !== '_total').length > 1 && (
          <select
            value={sourceFilter}
            onChange={e => { setSourceFilter(e.target.value); setPage(1); }}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
          >
            <option value="">Toutes les sources</option>
            {Object.entries(sources).filter(([k]) => k !== '_total').map(([key, count]) => (
              <option key={key} value={key}>{key.charAt(0).toUpperCase() + key.slice(1).replace('_', ' ')} ({count})</option>
            ))}
          </select>
        )}
        {(statut || type || sourceFilter || tempFilter) && (
          <button
            onClick={() => { setStatut(''); setType(''); setSourceFilter(''); setTempFilter(''); setPage(1); }}
            className="text-slate-400 hover:text-white text-xs transition"
          >
            Effacer filtres
          </button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3">
          <span className="text-amber-400 text-sm font-medium">{selected.size} lead(s) selectionne(s)</span>
          <button onClick={sendBulk} disabled={bulkSending} className="bg-amber-500 text-slate-900 font-bold px-4 py-2 rounded-lg text-sm hover:bg-amber-400 transition disabled:opacity-50">
            {bulkSending ? 'Envoi...' : `Envoyer ${selected.size} offre(s)`}
          </button>
          <button onClick={() => setSelected(new Set())} className="text-slate-400 text-sm hover:text-white transition">Annuler</button>
        </div>
      )}

      {prospectMsg && (
        <div className={`px-4 py-3 rounded-lg text-sm font-medium ${prospectMsg.ok ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
          {prospectMsg.text}
        </div>
      )}

      <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-x-auto">
        <table className="w-full min-w-[700px]">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-900/50">
              {['', 'Nom', 'Téléphone', 'Email', 'Service', 'Adresse', 'Ville', 'Température', 'Statut', 'Date', ''].map((h, i) => (
                <th key={h || `col-${i}`} className="text-left px-2 sm:px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider whitespace-nowrap">
                  {i === 0 ? <input type="checkbox" onChange={toggleSelectAll} className="accent-amber-500" /> : h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={11} className="text-center py-8 text-slate-500 text-sm">Chargement…</td></tr>
            )}
            {!loading && leads.length === 0 && (
              <tr><td colSpan={11} className="text-center py-8 text-slate-500 text-sm">Aucun lead</td></tr>
            )}
            {!loading && leads.map(l => <LeadRow key={l.id} lead={l} onUpdate={load} onProspect={sendProspect} prospecting={prospectingId === l.id} isSelected={selected.has(l.id)} onToggle={toggleSelect} onExpand={(id) => setExpandedId(expandedId === id ? null : id)} isExpanded={expandedId === l.id} />)}
          </tbody>
        </table>
      </div>

      {total > 25 && (
        <div className="flex gap-2 justify-end items-center">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 bg-slate-700 rounded text-sm text-white disabled:opacity-40"
          >
            Précédent
          </button>
          <span className="px-3 py-1.5 text-slate-400 text-sm">
            Page {page} / {Math.ceil(total / 25)}
          </span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={page >= Math.ceil(total / 25)}
            className="px-3 py-1.5 bg-slate-700 rounded text-sm text-white disabled:opacity-40"
          >
            Suivant
          </button>
        </div>
      )}
    </div>
  );
}
