'use client';

import { useState, useCallback, useEffect } from 'react';

type Statut = 'nouveau' | 'contacte' | 'devis_envoye' | 'rdv_pris' | 'ferme' | 'gagne';
type Temperature = 'chaud' | 'tiede' | 'froid';

interface Lead {
  id: number;
  nom: string;
  telephone: string | null;
  email: string | null;
  service: string | null;
  superficie: string | null;
  ville: string | null;
  notes: string | null;
  source: string;
  statut: Statut;
  temperature: Temperature;
  created_at: string;
}

const STATUTS: Statut[] = ['nouveau', 'contacte', 'devis_envoye', 'rdv_pris', 'ferme', 'gagne'];

const STATUT_LABEL: Record<Statut, string> = {
  nouveau:      'Nouveau',
  contacte:     'Contacté',
  devis_envoye: 'Devis envoyé',
  rdv_pris:     'RDV pris',
  ferme:        'Fermé',
  gagne:        'Gagné',
};

const STATUT_BADGE: Record<Statut, string> = {
  nouveau:      'bg-slate-500/20 text-slate-300 border-slate-500/30',
  contacte:     'bg-blue-500/20 text-blue-300 border-blue-500/30',
  devis_envoye: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  rdv_pris:     'bg-purple-500/20 text-purple-300 border-purple-500/30',
  ferme:        'bg-red-500/20 text-red-300 border-red-500/30',
  gagne:        'bg-green-500/20 text-green-300 border-green-500/30',
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

function LeadRow({ lead, onUpdate }: { lead: Lead; onUpdate: () => void }) {
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
    <tr className="border-b border-slate-700 hover:bg-slate-700/30 transition">
      <td className="px-4 py-3">
        <p className="text-white text-sm font-medium">{lead.nom}</p>
        {lead.source && <p className="text-slate-500 text-xs">via {lead.source}</p>}
      </td>
      <td className="px-4 py-3">
        {lead.telephone ? (
          <button
            onClick={copyPhone}
            className="text-slate-300 text-sm hover:text-amber-400 transition text-left"
            title="Cliquer pour copier"
          >
            {copied ? '✓ Copié' : lead.telephone}
          </button>
        ) : (
          <span className="text-slate-600 text-sm">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-slate-300 text-sm">
        {lead.email ?? <span className="text-slate-600">—</span>}
      </td>
      <td className="px-4 py-3 text-slate-300 text-sm">
        {lead.service ?? <span className="text-slate-600">—</span>}
      </td>
      <td className="px-4 py-3 text-slate-300 text-sm">
        {lead.ville ?? <span className="text-slate-600">—</span>}
      </td>
      <td className="px-4 py-3">
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
      <td className="px-4 py-3">
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
      <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{formatDate(lead.created_at)}</td>
      <td className="px-4 py-3">
        <button
          onClick={handleDelete}
          className="text-slate-600 hover:text-red-400 transition text-xs"
        >
          Suppr.
        </button>
      </td>
    </tr>
  );
}

export default function CrmClient() {
  const [leads, setLeads]     = useState<Lead[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [statut, setStatut]   = useState('');
  const [search, setSearch]   = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', '25');
    if (statut) params.set('statut', statut);
    if (search) params.set('search', search);

    const res = await fetch(`/api/crm/leads?${params}`);
    if (res.ok) {
      const json = await res.json();
      setLeads(json.data);
      setTotal(json.total);
    }
    setLoading(false);
  }, [page, statut, search]);

  useEffect(() => { load(); }, [load]);

  const chaud    = leads.filter(l => l.temperature === 'chaud').length;
  const tiede    = leads.filter(l => l.temperature === 'tiede').length;
  const froid    = leads.filter(l => l.temperature === 'froid').length;
  const contacte = leads.filter(l => l.statut === 'contacte').length;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">CRM Leads</h2>
        <span className="text-slate-400 text-sm">{total} au total</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total',     value: total,    color: 'text-white' },
          { label: '🔥 Chaud',  value: chaud,    color: 'text-red-400' },
          { label: '🟡 Tiède',  value: tiede,    color: 'text-yellow-400' },
          { label: '🔵 Froid',  value: froid,    color: 'text-blue-400' },
          { label: 'Contactés', value: contacte, color: 'text-blue-300' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-3">
            <p className="text-slate-400 text-xs mb-1">{label}</p>
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2 flex-wrap">
        {FILTER_TABS.map(tab => (
          <button
            key={tab.value}
            onClick={() => { setStatut(tab.value); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              statut === tab.value
                ? 'bg-amber-500 text-slate-900'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <input
        type="text"
        placeholder="Rechercher nom, téléphone ou email..."
        value={search}
        onChange={e => { setSearch(e.target.value); setPage(1); }}
        className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 w-full max-w-sm"
      />

      <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700 bg-slate-900/50">
              {['Nom', 'Téléphone', 'Email', 'Service', 'Ville', 'Température', 'Statut', 'Date', ''].map(h => (
                <th key={h} className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} className="text-center py-8 text-slate-500 text-sm">Chargement…</td></tr>
            )}
            {!loading && leads.length === 0 && (
              <tr><td colSpan={9} className="text-center py-8 text-slate-500 text-sm">Aucun lead</td></tr>
            )}
            {!loading && leads.map(l => <LeadRow key={l.id} lead={l} onUpdate={load} />)}
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
