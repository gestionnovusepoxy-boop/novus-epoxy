'use client';

import { useState, useCallback, useEffect } from 'react';
import { formatMoney } from '@/lib/pricing';

/* ─── Types ─── */
interface ProfitBreakdown {
  revenue: number;
  costs: number;
  profit: number;
  lucaShare: number;
  partnerShare: number;
}

interface Contract {
  id: number;
  client_nom: string;
  client_adresse: string | null;
  type_service: string;
  notes: string | null;
  statut: string;
  contract_price: number;
  profit_split_pct: number;
  partner_id: number | null;
  partner_nom: string | null;
  created_at: string;
  profit: ProfitBreakdown;
}

interface Partner {
  id: number;
  nom: string;
  telephone: string | null;
  email: string | null;
  split_defaut_pct: number;
  actif: boolean;
  notes: string | null;
}

/* ─── Constants ─── */
const STATUT_BADGE: Record<string, { label: string; cls: string }> = {
  planifie: { label: 'Planifie', cls: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' },
  en_cours: { label: 'En cours', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  complete: { label: 'Complete', cls: 'bg-green-500/20 text-green-300 border-green-500/30' },
  facture: { label: 'Facture', cls: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
  paye: { label: 'Paye', cls: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' },
};

/* ─── Helpers ─── */
function statutBadge(statut: string): { label: string; cls: string } {
  return STATUT_BADGE[statut] || { label: statut, cls: 'bg-slate-700 text-slate-300 border-slate-600' };
}

/* ─── Nouveau contrat modal ─── */
function NewContractModal({
  partners,
  onClose,
  onCreated,
}: {
  partners: Partner[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [clientNom, setClientNom] = useState('');
  const [clientAdresse, setClientAdresse] = useState('');
  const [partnerId, setPartnerId] = useState<string>(partners[0] ? String(partners[0].id) : '');
  const [contractPrice, setContractPrice] = useState('');
  const [splitPct, setSplitPct] = useState('50');
  const [jour1Date, setJour1Date] = useState('');
  const [jour2Date, setJour2Date] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Quand on change de partenaire, pré-remplir le split avec son défaut.
  useEffect(() => {
    const p = partners.find(p => String(p.id) === partnerId);
    if (p) setSplitPct(String(Number(p.split_defaut_pct)));
  }, [partnerId, partners]);

  async function handleSubmit() {
    if (!clientNom.trim()) {
      setError('Le nom du client est requis');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/sous-traitance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_nom: clientNom.trim(),
          client_adresse: clientAdresse.trim() || null,
          partner_id: partnerId ? parseInt(partnerId) : null,
          contract_price: contractPrice ? Number(contractPrice) : null,
          profit_split_pct: splitPct ? Number(splitPct) : 50,
          jour1_date: jour1Date || null,
          jour2_date: jour2Date || null,
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? 'Echec de la creation');
        return;
      }
      onCreated();
    } catch {
      setError('Erreur reseau');
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    'w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 transition';
  const labelCls = 'block text-xs font-medium text-slate-400 mb-1';

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-slate-800 border border-slate-700 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-white font-bold text-lg">Nouveau contrat</h3>
          <button onClick={onClose} className="w-9 h-9 bg-slate-700 hover:bg-slate-600 text-white rounded-full flex items-center justify-center text-xl transition">
            &times;
          </button>
        </div>

        <div>
          <label className={labelCls}>Partenaire</label>
          <select value={partnerId} onChange={e => setPartnerId(e.target.value)} className={inputCls}>
            <option value="">Aucun</option>
            {partners.map(p => (
              <option key={p.id} value={p.id}>
                {p.nom} ({Number(p.split_defaut_pct)}%)
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Prix du contrat ($)</label>
            <input
              type="number"
              inputMode="decimal"
              value={contractPrice}
              onChange={e => setContractPrice(e.target.value)}
              placeholder="0.00"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Part Novus (%)</label>
            <input
              type="number"
              inputMode="decimal"
              value={splitPct}
              onChange={e => setSplitPct(e.target.value)}
              placeholder="50"
              className={inputCls}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Date jour 1 (optionnel)</label>
            <input type="date" value={jour1Date} onChange={e => setJour1Date(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Date jour 2 (optionnel)</label>
            <input type="date" value={jour2Date} onChange={e => setJour2Date(e.target.value)} className={inputCls} />
          </div>
        </div>

        <div>
          <label className={labelCls}>Nom du client</label>
          <input
            type="text"
            value={clientNom}
            onChange={e => setClientNom(e.target.value)}
            placeholder="Ex: Jean Tremblay"
            className={inputCls}
          />
        </div>

        <div>
          <label className={labelCls}>Adresse du client (optionnel)</label>
          <input
            type="text"
            value={clientAdresse}
            onChange={e => setClientAdresse(e.target.value)}
            placeholder="123 rue Principale, Ville"
            className={inputCls}
          />
        </div>

        <div>
          <label className={labelCls}>Notes (optionnel)</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            placeholder="Details du contrat..."
            className={inputCls}
          />
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition">
            Annuler
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black transition"
          >
            {saving ? 'Creation...' : 'Creer le contrat'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Gestion des partenaires modal ─── */
function PartnersModal({
  partners,
  onClose,
  onChanged,
}: {
  partners: Partner[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [nom, setNom] = useState('');
  const [telephone, setTelephone] = useState('');
  const [email, setEmail] = useState('');
  const [splitDefaut, setSplitDefaut] = useState('50');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleAdd() {
    if (!nom.trim()) {
      setError('Le nom est requis');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/partners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nom: nom.trim(),
          telephone: telephone.trim() || null,
          email: email.trim() || null,
          split_defaut_pct: splitDefaut ? Number(splitDefaut) : 50,
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? 'Echec de l\'ajout');
        return;
      }
      setNom('');
      setTelephone('');
      setEmail('');
      setSplitDefaut('50');
      setNotes('');
      onChanged();
    } catch {
      setError('Erreur reseau');
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    'w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 transition';
  const labelCls = 'block text-xs font-medium text-slate-400 mb-1';

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-slate-800 border border-slate-700 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-white font-bold text-lg">Partenaires</h3>
          <button onClick={onClose} className="w-9 h-9 bg-slate-700 hover:bg-slate-600 text-white rounded-full flex items-center justify-center text-xl transition">
            &times;
          </button>
        </div>

        {/* Liste existante */}
        <div className="space-y-2">
          {partners.length === 0 ? (
            <p className="text-slate-500 text-sm">Aucun partenaire pour le moment</p>
          ) : (
            partners.map(p => (
              <div key={p.id} className="flex items-center justify-between bg-slate-900/50 rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <div className="text-white text-sm font-medium truncate">{p.nom}</div>
                  <div className="text-slate-500 text-xs truncate">
                    {[p.telephone, p.email].filter(Boolean).join(' — ') || 'Aucun contact'}
                  </div>
                </div>
                <span className="text-amber-400 text-xs font-semibold whitespace-nowrap">{Number(p.split_defaut_pct)}%</span>
              </div>
            ))
          )}
        </div>

        {/* Ajouter */}
        <div className="border-t border-slate-700 pt-4 space-y-3">
          <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Ajouter un partenaire</h4>
          <div>
            <label className={labelCls}>Nom</label>
            <input type="text" value={nom} onChange={e => setNom(e.target.value)} placeholder="Ex: JJ" className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Telephone</label>
              <input type="tel" value={telephone} onChange={e => setTelephone(e.target.value)} placeholder="514-555-1234" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Split defaut (%)</label>
              <input type="number" inputMode="decimal" value={splitDefaut} onChange={e => setSplitDefaut(e.target.value)} placeholder="50" className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="partenaire@email.com" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={inputCls} />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex items-center justify-end">
            <button
              onClick={handleAdd}
              disabled={saving}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black transition"
            >
              {saving ? 'Ajout...' : 'Ajouter'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Page ─── */
export default function SousTraitancePage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [showPartners, setShowPartners] = useState(false);

  const loadContracts = useCallback(async () => {
    const res = await fetch('/api/sous-traitance');
    if (res.ok) {
      const json = await res.json();
      setContracts(json.data ?? []);
    }
    setLoading(false);
  }, []);

  const loadPartners = useCallback(async () => {
    const res = await fetch('/api/partners');
    if (res.ok) {
      const json = await res.json();
      setPartners(json.data ?? []);
    }
  }, []);

  useEffect(() => {
    loadContracts();
    loadPartners();
  }, [loadContracts, loadPartners]);

  // Totaux
  const totalRevenue = contracts.reduce((s, c) => s + Number(c.profit.revenue), 0);
  const totalProfit = contracts.reduce((s, c) => s + Number(c.profit.profit), 0);
  const totalLuca = contracts.reduce((s, c) => s + Number(c.profit.lucaShare), 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-white">Sous-traitance</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowPartners(true)}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
          >
            Partenaires
          </button>
          <button
            onClick={() => setShowNew(true)}
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 text-black transition"
          >
            + Nouveau contrat
          </button>
        </div>
      </div>

      {/* Totaux */}
      {contracts.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <div className="text-slate-500 text-xs uppercase tracking-wider">Revenu total</div>
            <div className="text-white font-bold text-lg mt-1">{formatMoney(totalRevenue)}</div>
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <div className="text-slate-500 text-xs uppercase tracking-wider">Profit total</div>
            <div className={`font-bold text-lg mt-1 ${totalProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatMoney(totalProfit)}</div>
          </div>
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <div className="text-slate-500 text-xs uppercase tracking-wider">Part Novus</div>
            <div className={`font-bold text-lg mt-1 ${totalLuca >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatMoney(totalLuca)}</div>
          </div>
        </div>
      )}

      {/* Tableau des contrats */}
      {loading ? (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-12 text-center">
          <p className="text-slate-500 text-sm">Chargement...</p>
        </div>
      ) : contracts.length === 0 ? (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-12 text-center">
          <p className="text-slate-500 text-sm">Aucun contrat de sous-traitance</p>
        </div>
      ) : (
        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-slate-400 text-xs uppercase tracking-wider">
                  <th className="text-left font-semibold px-4 py-3">Client</th>
                  <th className="text-left font-semibold px-4 py-3">Partenaire</th>
                  <th className="text-right font-semibold px-4 py-3">Prix contrat</th>
                  <th className="text-right font-semibold px-4 py-3">Couts</th>
                  <th className="text-right font-semibold px-4 py-3">Profit</th>
                  <th className="text-right font-semibold px-4 py-3">Part Novus</th>
                  <th className="text-right font-semibold px-4 py-3">Part partenaire</th>
                  <th className="text-center font-semibold px-4 py-3">Statut</th>
                </tr>
              </thead>
              <tbody>
                {contracts.map(c => {
                  const badge = statutBadge(c.statut);
                  return (
                    <tr key={c.id} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-900/40 transition">
                      <td className="px-4 py-3">
                        <div className="text-white font-medium">{c.client_nom}</div>
                        {c.client_adresse && <div className="text-slate-500 text-xs truncate max-w-[200px]">{c.client_adresse}</div>}
                      </td>
                      <td className="px-4 py-3 text-slate-300">
                        {c.partner_nom || <span className="text-slate-600">—</span>}
                        <span className="text-slate-600 text-xs ml-1">({Number(c.profit_split_pct)}%)</span>
                      </td>
                      <td className="px-4 py-3 text-right text-white font-medium">{formatMoney(Number(c.profit.revenue))}</td>
                      <td className="px-4 py-3 text-right text-red-400">{formatMoney(Number(c.profit.costs))}</td>
                      <td className={`px-4 py-3 text-right font-semibold ${Number(c.profit.profit) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {formatMoney(Number(c.profit.profit))}
                      </td>
                      <td className="px-4 py-3 text-right text-emerald-400">{formatMoney(Number(c.profit.lucaShare))}</td>
                      <td className="px-4 py-3 text-right text-slate-300">{formatMoney(Number(c.profit.partnerShare))}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs font-medium px-2.5 py-1 rounded-full border whitespace-nowrap ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showNew && (
        <NewContractModal
          partners={partners}
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            loadContracts();
          }}
        />
      )}

      {showPartners && (
        <PartnersModal
          partners={partners}
          onClose={() => setShowPartners(false)}
          onChanged={loadPartners}
        />
      )}
    </div>
  );
}
