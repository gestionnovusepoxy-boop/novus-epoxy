'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { formatMoney } from '@/lib/pricing';

/* ─── Types ─── */
interface Employee {
  id: number;
  nom: string;
  telephone: string | null;
  role: string;
  taux_horaire: number;
  actif: boolean;
  created_at: string;
}

interface TimeEntry {
  id: number;
  employee_id: number;
  quote_id: number | null;
  date_travail: string;
  heure_debut: string | null;
  heure_fin: string | null;
  heures: number | null;
  type: string;
  notes: string | null;
  employee_nom: string;
  taux_horaire: number;
  projet_nom: string | null;
  montant: number;
}

interface Summary {
  employee_id: number;
  employee_nom: string;
  taux_horaire: number;
  total_heures: number;
  total_montant: number;
}

interface Quote {
  id: number;
  client_nom: string;
  statut: string;
}

/* ─── Constants ─── */
const ROLES = ['proprietaire', 'installateur', 'aide', 'sous-traitant'] as const;
const ROLE_LABEL: Record<string, string> = {
  proprietaire: 'Proprietaire', installateur: 'Installateur',
  aide: 'Aide', 'sous-traitant': 'Sous-traitant',
};
const TYPES = ['travail', 'deplacement', 'preparation', 'nettoyage'] as const;
const TYPE_LABEL: Record<string, string> = {
  travail: 'Travail', deplacement: 'Deplacement',
  preparation: 'Preparation', nettoyage: 'Nettoyage',
};

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

function getWeekRange(): [string, string] {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const mon = new Date(now);
  mon.setDate(now.getDate() - diff);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return [mon.toISOString().slice(0, 10), sun.toISOString().slice(0, 10)];
}

function getMonthRange(): [string, string] {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return [first.toISOString().slice(0, 10), last.toISOString().slice(0, 10)];
}

/** Get Monday-Saturday dates for the week containing dateFrom */
function getWeekDates(dateFrom: string): string[] {
  if (!dateFrom) return [];
  const d = new Date(dateFrom + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const mon = new Date(d);
  mon.setDate(d.getDate() - diff);
  const dates: string[] = [];
  for (let i = 0; i < 6; i++) {
    const dd = new Date(mon);
    dd.setDate(mon.getDate() + i);
    dates.push(dd.toISOString().slice(0, 10));
  }
  return dates;
}

function exportCSV(entries: TimeEntry[], dateFrom: string, dateTo: string) {
  const header = 'Employe,Date,Projet,Heures,Type,Taux,Montant';
  const rows = entries.map(e => {
    const projet = e.projet_nom ? `${e.projet_nom} #${e.quote_id}` : '';
    return [
      `"${e.employee_nom}"`,
      e.date_travail,
      `"${projet}"`,
      e.heures ?? 0,
      TYPE_LABEL[e.type] || e.type,
      e.taux_horaire,
      parseFloat(String(e.montant ?? 0)).toFixed(2),
    ].join(',');
  });

  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `heures_${dateFrom}_${dateTo}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function EquipePage() {
  const [tab, setTab] = useState<'employes' | 'heures'>('employes');
  const searchParams = useSearchParams();
  const projetParam = searchParams.get('projet');

  // If ?projet= is in URL, auto-switch to heures tab
  useEffect(() => {
    if (projetParam) setTab('heures');
  }, [projetParam]);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <h1 className="text-2xl font-bold text-white">Equipe & Heures</h1>

      {/* Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setTab('employes')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            tab === 'employes'
              ? 'bg-amber-500 text-black'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }`}
        >
          Sous-traitants
        </button>
        <button
          onClick={() => setTab('heures')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
            tab === 'heures'
              ? 'bg-amber-500 text-black'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }`}
        >
          Heures & Montants
        </button>
      </div>

      {tab === 'employes' ? <EmployesTab /> : <HeuresTab preselectedProjet={projetParam} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   TAB 1: EMPLOYES
   ═══════════════════════════════════════════════════ */
function EmployesTab() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ nom: '', telephone: '', role: 'installateur', taux_horaire: '' });
  const [editingRate, setEditingRate] = useState<number | null>(null);
  const [editRateVal, setEditRateVal] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/equipe');
    if (res.ok) {
      const json = await res.json();
      setEmployees(json.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/equipe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nom: form.nom,
        telephone: form.telephone || null,
        role: form.role,
        taux_horaire: parseFloat(form.taux_horaire) || 0,
      }),
    });
    if (res.ok) {
      setForm({ nom: '', telephone: '', role: 'installateur', taux_horaire: '' });
      setShowForm(false);
      load();
    }
  }

  async function toggleActif(emp: Employee) {
    await fetch(`/api/equipe?id=${emp.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actif: !emp.actif }),
    });
    load();
  }

  async function saveRate(id: number) {
    await fetch(`/api/equipe?id=${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taux_horaire: parseFloat(editRateVal) || 0 }),
    });
    setEditingRate(null);
    load();
  }

  if (loading) return <p className="text-slate-400">Chargement...</p>;

  return (
    <div className="space-y-4">
      <button
        onClick={() => setShowForm(!showForm)}
        className="bg-amber-500 text-black px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-400 transition"
      >
        {showForm ? 'Annuler' : '+ Ajouter employe'}
      </button>

      {showForm && (
        <form onSubmit={handleAdd} className="bg-slate-800 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input
            required
            placeholder="Nom"
            value={form.nom}
            onChange={e => setForm({ ...form, nom: e.target.value })}
            className="bg-slate-700 text-white rounded-lg px-3 py-2 text-sm"
          />
          <input
            placeholder="Telephone"
            value={form.telephone}
            onChange={e => setForm({ ...form, telephone: e.target.value })}
            className="bg-slate-700 text-white rounded-lg px-3 py-2 text-sm"
          />
          <select
            value={form.role}
            onChange={e => setForm({ ...form, role: e.target.value })}
            className="bg-slate-700 text-white rounded-lg px-3 py-2 text-sm"
          >
            {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="Taux horaire ($)"
            value={form.taux_horaire}
            onChange={e => setForm({ ...form, taux_horaire: e.target.value })}
            className="bg-slate-700 text-white rounded-lg px-3 py-2 text-sm"
          />
          <button type="submit" className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-500 sm:col-span-2">
            Enregistrer
          </button>
        </form>
      )}

      {/* Employees table */}
      <div className="bg-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-700/50 text-slate-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3">Nom</th>
                <th className="px-4 py-3 hidden sm:table-cell">Telephone</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Taux/h</th>
                <th className="px-4 py-3">Statut</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {employees.map(emp => (
                <tr key={emp.id} className={`${emp.actif ? '' : 'opacity-50'}`}>
                  <td className="px-4 py-3 text-white font-medium">{emp.nom}</td>
                  <td className="px-4 py-3 text-slate-300 hidden sm:table-cell">{emp.telephone || '—'}</td>
                  <td className="px-4 py-3 text-slate-300">{ROLE_LABEL[emp.role] || emp.role}</td>
                  <td className="px-4 py-3 text-slate-300">
                    {editingRate === emp.id ? (
                      <span className="flex items-center gap-1">
                        <input
                          type="number"
                          step="0.01"
                          value={editRateVal}
                          onChange={e => setEditRateVal(e.target.value)}
                          className="bg-slate-600 text-white rounded px-2 py-1 w-20 text-sm"
                          autoFocus
                          onKeyDown={e => { if (e.key === 'Enter') saveRate(emp.id); if (e.key === 'Escape') setEditingRate(null); }}
                        />
                        <button onClick={() => saveRate(emp.id)} className="text-green-400 text-xs">OK</button>
                      </span>
                    ) : (
                      <span
                        onClick={() => { setEditingRate(emp.id); setEditRateVal(String(emp.taux_horaire)); }}
                        className="cursor-pointer hover:text-amber-400 transition"
                        title="Cliquer pour modifier"
                      >
                        {formatMoney(emp.taux_horaire)}/h
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      emp.actif ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                    }`}>
                      {emp.actif ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleActif(emp)}
                      className="text-xs text-slate-400 hover:text-white transition"
                    >
                      {emp.actif ? 'Desactiver' : 'Activer'}
                    </button>
                  </td>
                </tr>
              ))}
              {employees.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Aucun employe</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   TAB 2: HEURES & SALAIRES
   ═══════════════════════════════════════════════════ */
function HeuresTab({ preselectedProjet }: { preselectedProjet: string | null }) {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [summary, setSummary] = useState<Summary[]>([]);
  const [totals, setTotals] = useState({ heures: 0, montant: 0 });
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [showForm, setShowForm] = useState(!!preselectedProjet);

  // Date range
  const [rangeType, setRangeType] = useState<'semaine' | 'mois' | 'custom'>('semaine');
  const [weekRange] = useState(getWeekRange);
  const [monthRange] = useState(getMonthRange);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  // Form
  const [form, setForm] = useState({
    employee_id: '', quote_id: preselectedProjet || '', date_travail: new Date().toISOString().slice(0, 10),
    heure_debut: '', heure_fin: '', heures: '', type: 'travail', notes: '',
  });

  const dateFrom = rangeType === 'semaine' ? weekRange[0] : rangeType === 'mois' ? monthRange[0] : customFrom;
  const dateTo = rangeType === 'semaine' ? weekRange[1] : rangeType === 'mois' ? monthRange[1] : customTo;

  const loadEntries = useCallback(async () => {
    const params = new URLSearchParams();
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);

    const res = await fetch(`/api/equipe/heures?${params}`);
    if (res.ok) {
      const json = await res.json();
      setEntries(json.data);
      setSummary(json.summary);
      setTotals(json.totals);
    }
    setLoading(false);
  }, [dateFrom, dateTo]);

  const loadMeta = useCallback(async () => {
    const [empRes, quoRes] = await Promise.all([
      fetch('/api/equipe?actif=true'),
      fetch('/api/quotes?statut=accepted'),
    ]);
    if (empRes.ok) {
      const json = await empRes.json();
      setEmployees(json.data);
    }
    if (quoRes.ok) {
      const json = await quoRes.json();
      const list = json.data ?? json;
      setQuotes(Array.isArray(list) ? list : []);
    }
  }, []);

  useEffect(() => { loadEntries(); }, [loadEntries]);
  useEffect(() => { loadMeta(); }, [loadMeta]);

  // Auto-calc heures from times
  const calcHeures = (debut: string, fin: string): string => {
    if (!debut || !fin) return '';
    const [sh, sm] = debut.split(':').map(Number);
    const [eh, em] = fin.split(':').map(Number);
    const mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins <= 0) return '';
    return (Math.round((mins / 60) * 100) / 100).toString();
  };

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/equipe/heures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: form.employee_id,
        quote_id: form.quote_id || null,
        date_travail: form.date_travail,
        heure_debut: form.heure_debut || null,
        heure_fin: form.heure_fin || null,
        heures: form.heures || null,
        type: form.type,
        notes: form.notes || null,
      }),
    });
    if (res.ok) {
      setForm({
        employee_id: '', quote_id: '', date_travail: new Date().toISOString().slice(0, 10),
        heure_debut: '', heure_fin: '', heures: '', type: 'travail', notes: '',
      });
      setShowForm(false);
      loadEntries();
    }
  }

  async function handleDelete(id: number) {
    if (!confirm('Supprimer cette entree?')) return;
    await fetch(`/api/equipe/heures?id=${id}`, { method: 'DELETE' });
    loadEntries();
  }

  /* Weekly calendar data */
  const weekDates = useMemo(() => getWeekDates(dateFrom), [dateFrom]);

  const calendarData = useMemo(() => {
    // Map: employeeName -> { [date]: totalHours }
    const map: Record<string, Record<string, number>> = {};
    // Include all active employees so they appear even with 0 hours
    for (const emp of employees) {
      map[emp.nom] = {};
    }
    for (const entry of entries) {
      const name = entry.employee_nom;
      if (!map[name]) map[name] = {};
      // Normalize date: "2026-03-30T00:00:00.000Z" → "2026-03-30"
      const date = String(entry.date_travail).slice(0, 10);
      if (!map[name][date]) map[name][date] = 0;
      map[name][date] += parseFloat(String(entry.heures ?? 0));
    }
    return map;
  }, [entries, employees]);

  const employeeNames = useMemo(() => Object.keys(calendarData).sort(), [calendarData]);

  return (
    <div className="space-y-4">
      {/* Date range filter + Export */}
      <div className="flex flex-wrap gap-2 items-center">
        <button
          onClick={() => setRangeType('semaine')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
            rangeType === 'semaine' ? 'bg-amber-500 text-black' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }`}
        >
          Cette semaine
        </button>
        <button
          onClick={() => setRangeType('mois')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
            rangeType === 'mois' ? 'bg-amber-500 text-black' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }`}
        >
          Ce mois
        </button>
        <button
          onClick={() => setRangeType('custom')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
            rangeType === 'custom' ? 'bg-amber-500 text-black' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }`}
        >
          Personnalise
        </button>
        {rangeType === 'custom' && (
          <>
            <input
              type="date"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              className="bg-slate-700 text-white rounded-lg px-2 py-1.5 text-xs"
            />
            <span className="text-slate-500 text-xs">au</span>
            <input
              type="date"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              className="bg-slate-700 text-white rounded-lg px-2 py-1.5 text-xs"
            />
          </>
        )}
        {dateFrom && dateTo && (
          <span className="text-slate-500 text-xs ml-2">{dateFrom} — {dateTo}</span>
        )}

        {/* Export CSV */}
        {entries.length > 0 && (
          <button
            onClick={() => exportCSV(entries, dateFrom, dateTo)}
            className="ml-auto bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded-lg text-xs font-medium transition"
          >
            Exporter CSV
          </button>
        )}
      </div>

      <button
        onClick={() => setShowForm(!showForm)}
        className="bg-amber-500 text-black px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-400 transition"
      >
        {showForm ? 'Annuler' : '+ Ajouter entree'}
      </button>

      {showForm && (
        <form onSubmit={handleAdd} className="bg-slate-800 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <select
            required
            value={form.employee_id}
            onChange={e => setForm({ ...form, employee_id: e.target.value })}
            className="bg-slate-700 text-white rounded-lg px-3 py-2 text-sm"
          >
            <option value="">— Employe —</option>
            {employees.map(emp => (
              <option key={emp.id} value={emp.id}>{emp.nom}</option>
            ))}
          </select>

          <select
            value={form.quote_id}
            onChange={e => setForm({ ...form, quote_id: e.target.value })}
            className="bg-slate-700 text-white rounded-lg px-3 py-2 text-sm"
          >
            <option value="">— Projet (optionnel) —</option>
            {quotes.map(q => (
              <option key={q.id} value={q.id}>{q.client_nom} #{q.id}</option>
            ))}
          </select>

          <input
            type="date"
            required
            value={form.date_travail}
            onChange={e => setForm({ ...form, date_travail: e.target.value })}
            className="bg-slate-700 text-white rounded-lg px-3 py-2 text-sm"
          />

          <div className="flex gap-2">
            <input
              type="time"
              placeholder="Debut"
              value={form.heure_debut}
              onChange={e => {
                const v = e.target.value;
                const h = calcHeures(v, form.heure_fin);
                setForm({ ...form, heure_debut: v, heures: h || form.heures });
              }}
              className="bg-slate-700 text-white rounded-lg px-3 py-2 text-sm flex-1"
            />
            <input
              type="time"
              placeholder="Fin"
              value={form.heure_fin}
              onChange={e => {
                const v = e.target.value;
                const h = calcHeures(form.heure_debut, v);
                setForm({ ...form, heure_fin: v, heures: h || form.heures });
              }}
              className="bg-slate-700 text-white rounded-lg px-3 py-2 text-sm flex-1"
            />
          </div>

          <input
            type="number"
            step="0.5"
            min="0"
            placeholder="Heures (auto ou manuel)"
            value={form.heures}
            onChange={e => setForm({ ...form, heures: e.target.value })}
            className="bg-slate-700 text-white rounded-lg px-3 py-2 text-sm"
          />

          <select
            value={form.type}
            onChange={e => setForm({ ...form, type: e.target.value })}
            className="bg-slate-700 text-white rounded-lg px-3 py-2 text-sm"
          >
            {TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>

          <input
            placeholder="Notes (optionnel)"
            value={form.notes}
            onChange={e => setForm({ ...form, notes: e.target.value })}
            className="bg-slate-700 text-white rounded-lg px-3 py-2 text-sm sm:col-span-2 lg:col-span-2"
          />

          <button type="submit" className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-500 sm:col-span-2 lg:col-span-3">
            Enregistrer
          </button>
        </form>
      )}

      {/* Time entries table */}
      {loading ? (
        <p className="text-slate-400">Chargement...</p>
      ) : (
        <div className="bg-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-700/50 text-slate-400 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3">Employe</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3 hidden sm:table-cell">Projet</th>
                  <th className="px-4 py-3">Heures</th>
                  <th className="px-4 py-3 hidden md:table-cell">Type</th>
                  <th className="px-4 py-3">Montant</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {entries.map(entry => (
                  <tr key={entry.id}>
                    <td className="px-4 py-3 text-white font-medium">{entry.employee_nom}</td>
                    <td className="px-4 py-3 text-slate-300">{String(entry.date_travail).slice(0, 10)}</td>
                    <td className="px-4 py-3 text-slate-300 hidden sm:table-cell">
                      {entry.projet_nom ? `${entry.projet_nom} #${entry.quote_id}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      {entry.heures != null ? `${entry.heures}h` : '—'}
                      {entry.heure_debut && entry.heure_fin && (
                        <span className="text-slate-500 text-xs ml-1">
                          ({entry.heure_debut.slice(0, 5)}–{entry.heure_fin.slice(0, 5)})
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-300 hidden md:table-cell">
                      <span className="px-2 py-0.5 rounded-full text-xs bg-slate-700">
                        {TYPE_LABEL[entry.type] || entry.type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-amber-400 font-medium">
                      {formatMoney(parseFloat(String(entry.montant ?? 0)))}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleDelete(entry.id)}
                        className="text-red-400 hover:text-red-300 text-xs transition"
                        title="Supprimer"
                      >
                        Suppr.
                      </button>
                    </td>
                  </tr>
                ))}
                {entries.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">Aucune entree pour cette periode</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Summary */}
      {summary.length > 0 && (
        <div className="bg-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-white font-semibold text-sm">Resume par sous-traitant</h3>
            <button
              onClick={() => {
                const today = new Date();
                const day = today.getDay();
                const sunStart = new Date(today);
                sunStart.setDate(today.getDate() - day - 7); // last Sunday
                const satEnd = new Date(today);
                satEnd.setDate(today.getDate() - day - 1); // last Saturday
                setCustomFrom(sunStart.toISOString().slice(0, 10));
                setCustomTo(satEnd.toISOString().slice(0, 10));
                setRangeType('custom');
              }}
              className="bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition"
            >
              Paiement semaine (dim-sam)
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-slate-400 text-xs uppercase">
                <tr>
                  <th className="px-4 py-2">Employe</th>
                  <th className="px-4 py-2">Taux/h</th>
                  <th className="px-4 py-2">Total heures</th>
                  <th className="px-4 py-2">Montant</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {summary.map(s => (
                  <tr key={s.employee_id}>
                    <td className="px-4 py-2 text-white">{s.employee_nom}</td>
                    <td className="px-4 py-2 text-slate-300">{formatMoney(s.taux_horaire)}/h</td>
                    <td className="px-4 py-2 text-slate-300">{s.total_heures}h</td>
                    <td className="px-4 py-2 text-amber-400 font-medium">{formatMoney(s.total_montant)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-slate-600">
                <tr>
                  <td className="px-4 py-2 text-white font-bold">TOTAL</td>
                  <td className="px-4 py-2"></td>
                  <td className="px-4 py-2 text-white font-bold">{totals.heures}h</td>
                  <td className="px-4 py-2 text-amber-400 font-bold">{formatMoney(totals.montant)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Weekly Calendar View */}
      {weekDates.length > 0 && employeeNames.length > 0 && (
        <div className="bg-slate-800 rounded-xl p-4 space-y-3">
          <h3 className="text-white font-semibold text-sm">Vue calendrier hebdomadaire</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-slate-400 text-xs uppercase">
                <tr>
                  <th className="px-3 py-2">Employe</th>
                  {weekDates.map((date, i) => (
                    <th key={date} className="px-3 py-2 text-center">
                      <div>{DAY_LABELS[i]}</div>
                      <div className="text-[10px] text-slate-500 font-normal">{date.slice(5)}</div>
                    </th>
                  ))}
                  <th className="px-3 py-2 text-center">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {employeeNames.map(name => {
                  const dayMap = calendarData[name] || {};
                  let weekTotal = 0;
                  return (
                    <tr key={name}>
                      <td className="px-3 py-2 text-white font-medium whitespace-nowrap">{name}</td>
                      {weekDates.map(date => {
                        const h = Math.round((dayMap[date] || 0) * 100) / 100;
                        weekTotal += h;
                        // Color intensity based on hours
                        let bg = '';
                        if (h > 0 && h < 4) bg = 'bg-amber-500/20';
                        else if (h >= 4 && h < 8) bg = 'bg-amber-500/40';
                        else if (h >= 8) bg = 'bg-amber-500/60';

                        return (
                          <td key={date} className={`px-3 py-2 text-center ${bg} rounded`}>
                            {h > 0 ? (
                              <span className="text-white font-medium text-xs">{h}h</span>
                            ) : (
                              <span className="text-slate-600 text-xs">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-center">
                        <span className="text-amber-400 font-bold text-xs">{Math.round(weekTotal * 100) / 100}h</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
