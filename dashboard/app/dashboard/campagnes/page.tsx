'use client';

import { useState, useEffect, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────
interface Promotion {
  id: number;
  nom: string;
  description: string | null;
  rabais_pct: number;
  date_debut: string;
  date_fin: string;
  actif: boolean;
  services: string[];
  created_at: string;
}

interface Campaign {
  id: number;
  promotion_id: number | null;
  nom: string;
  audience: string;
  message: string;
  destinataires_count: number;
  sent_at: string;
  promo_nom: string | null;
  rabais_pct: number | null;
}

const AUDIENCES = [
  { value: 'tous_leads', label: 'Tous les leads' },
  { value: 'leads_tiedes', label: 'Leads ti\u00e8des seulement' },
  { value: 'leads_chauds', label: 'Leads chauds seulement' },
  { value: 'anciens_clients', label: 'Anciens clients' },
  { value: 'leads_sans_reponse', label: 'Leads sans r\u00e9ponse' },
] as const;

// ── Helpers ────────────────────────────────────────────────────────────────
function daysUntil(dateStr: string): number {
  const target = new Date(dateStr + 'T23:59:59');
  const now = new Date();
  return Math.ceil((target.getTime() - now.getTime()) / 86400000);
}

function expiryBadge(dateFin: string) {
  const days = daysUntil(dateFin);
  if (days < 0) return <span className="px-2 py-0.5 rounded-full text-xs bg-red-500/20 text-red-400">Expir\u00e9e</span>;
  if (days <= 7) return <span className="px-2 py-0.5 rounded-full text-xs bg-amber-500/20 text-amber-400">Expire dans {days}j</span>;
  return <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-500/20 text-emerald-400">Expire dans {days}j</span>;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('fr-CA', { year: 'numeric', month: 'short', day: 'numeric' });
}

function audienceLabel(val: string) {
  return AUDIENCES.find(a => a.value === val)?.label ?? val;
}

// ── Component ──────────────────────────────────────────────────────────────
export default function CampagnesPage() {
  // State
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  // Promo form
  const [showPromoForm, setShowPromoForm] = useState(false);
  const [promoForm, setPromoForm] = useState({ nom: '', description: '', rabais_pct: '20', date_debut: '', date_fin: '', services: '' });
  const [promoSaving, setPromoSaving] = useState(false);

  // Campaign builder
  const [selectedPromo, setSelectedPromo] = useState<number | ''>('');
  const [audience, setAudience] = useState('tous_leads');
  const [customMessage, setCustomMessage] = useState('');
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ sent: number } | null>(null);

  // ── Data fetching ──
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [promosRes, campaignsRes] = await Promise.all([
        fetch('/api/promotions'),
        fetch('/api/campagnes'),
      ]);
      if (promosRes.ok) setPromotions(await promosRes.json());
      if (campaignsRes.ok) setCampaigns(await campaignsRes.json());
    } catch (err) {
      console.error('Fetch error:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Fetch recipient count when audience changes
  useEffect(() => {
    if (!audience) return;
    setCountLoading(true);
    fetch(`/api/campagnes/count?audience=${audience}`)
      .then(r => r.json())
      .then(d => setRecipientCount(d.count ?? 0))
      .catch(() => setRecipientCount(null))
      .finally(() => setCountLoading(false));
  }, [audience]);

  // Pre-fill message when promo changes
  useEffect(() => {
    if (selectedPromo === '') {
      setCustomMessage('Nous avons une offre sp\u00e9ciale pour vous!\n\nContactez-nous pour en savoir plus sur nos services de planchers \u00e9poxy haut de gamme.');
      return;
    }
    const promo = promotions.find(p => p.id === selectedPromo);
    if (promo) {
      setCustomMessage(
        `Profitez de notre promotion "${promo.nom}" !\n\n${promo.description ?? ''}\n\nRabais de ${promo.rabais_pct}% sur ${promo.services?.length ? 'les services s\u00e9lectionn\u00e9s' : 'tous nos services'}.\n\nValide du ${formatDate(promo.date_debut)} au ${formatDate(promo.date_fin)}.\n\nContactez-nous d\u00e8s maintenant pour obtenir votre soumission gratuite!`
      );
    }
  }, [selectedPromo, promotions]);

  // ── Promo actions ──
  async function createPromo() {
    setPromoSaving(true);
    try {
      const res = await fetch('/api/promotions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nom: promoForm.nom,
          description: promoForm.description || null,
          rabais_pct: promoForm.rabais_pct,
          date_debut: promoForm.date_debut,
          date_fin: promoForm.date_fin,
          services: promoForm.services ? promoForm.services.split(',').map(s => s.trim()) : '{}',
        }),
      });
      if (res.ok) {
        setShowPromoForm(false);
        setPromoForm({ nom: '', description: '', rabais_pct: '20', date_debut: '', date_fin: '', services: '' });
        fetchData();
      }
    } catch (err) {
      console.error('Create promo error:', err);
    }
    setPromoSaving(false);
  }

  async function togglePromo(id: number, actif: boolean) {
    await fetch('/api/promotions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, actif: !actif }),
    });
    fetchData();
  }

  async function deletePromo(id: number) {
    if (!confirm('Supprimer cette promotion?')) return;
    await fetch(`/api/promotions?id=${id}`, { method: 'DELETE' });
    fetchData();
  }

  // ── Send campaign ──
  async function sendCampaign() {
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch('/api/campagnes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          promotion_id: selectedPromo || null,
          audience,
          custom_message: customMessage,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setSendResult({ sent: data.sent });
        fetchData();
      } else {
        const err = await res.json();
        alert(err.error || 'Erreur lors de l\'envoi');
      }
    } catch (err) {
      console.error('Send campaign error:', err);
      alert('Erreur lors de l\'envoi');
    }
    setSending(false);
    setShowConfirm(false);
  }

  // ── Active promos for campaign dropdown ──
  const activePromos = promotions.filter(p => p.actif && daysUntil(p.date_fin) >= 0);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8">
      {/* ── Header ── */}
      <h2 className="text-2xl font-bold text-white">Campagnes</h2>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 1: Promotions actives
          ═══════════════════════════════════════════════════════════════════ */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Promotions</h3>
          <button
            onClick={() => setShowPromoForm(!showPromoForm)}
            className="px-4 py-2 bg-amber-500 text-slate-900 rounded-lg text-sm font-medium hover:bg-amber-400 transition"
          >
            {showPromoForm ? 'Annuler' : '+ Nouvelle promotion'}
          </button>
        </div>

        {/* New promo form */}
        {showPromoForm && (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 mb-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Nom</label>
                <input
                  value={promoForm.nom}
                  onChange={e => setPromoForm({ ...promoForm, nom: e.target.value })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  placeholder="Ex: Rabais printemps 2026"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Rabais (%)</label>
                <input
                  type="number"
                  value={promoForm.rabais_pct}
                  onChange={e => setPromoForm({ ...promoForm, rabais_pct: e.target.value })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                  min="1" max="100"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Date d\u00e9but</label>
                <input
                  type="date"
                  value={promoForm.date_debut}
                  onChange={e => setPromoForm({ ...promoForm, date_debut: e.target.value })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Date fin</label>
                <input
                  type="date"
                  value={promoForm.date_fin}
                  onChange={e => setPromoForm({ ...promoForm, date_fin: e.target.value })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Description</label>
              <textarea
                value={promoForm.description}
                onChange={e => setPromoForm({ ...promoForm, description: e.target.value })}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                rows={2}
                placeholder="Description optionnelle..."
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Services (vide = tous, ou s\u00e9par\u00e9s par virgule)</label>
              <input
                value={promoForm.services}
                onChange={e => setPromoForm({ ...promoForm, services: e.target.value })}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                placeholder="flake, metallique, quartz..."
              />
            </div>
            <button
              onClick={createPromo}
              disabled={promoSaving || !promoForm.nom || !promoForm.date_debut || !promoForm.date_fin}
              className="px-4 py-2 bg-amber-500 text-slate-900 rounded-lg text-sm font-medium hover:bg-amber-400 transition disabled:opacity-50"
            >
              {promoSaving ? 'Cr\u00e9ation...' : 'Cr\u00e9er la promotion'}
            </button>
          </div>
        )}

        {/* Promos list */}
        {promotions.length === 0 ? (
          <p className="text-slate-500 text-sm">Aucune promotion.</p>
        ) : (
          <div className="grid gap-3">
            {promotions.map(p => (
              <div key={p.id} className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-white font-medium">{p.nom}</span>
                    <span className="px-2 py-0.5 rounded-full text-xs bg-amber-500/20 text-amber-400 font-medium">
                      -{p.rabais_pct}%
                    </span>
                    {p.actif ? expiryBadge(p.date_fin) : (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-slate-600 text-slate-400">Inactif</span>
                    )}
                  </div>
                  <p className="text-slate-400 text-sm mt-1">
                    {formatDate(p.date_debut)} &rarr; {formatDate(p.date_fin)}
                    {p.description && <span className="ml-2 text-slate-500">&mdash; {p.description}</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <button
                    onClick={() => togglePromo(p.id, p.actif)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                      p.actif
                        ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                        : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                    }`}
                  >
                    {p.actif ? 'Actif' : 'Inactif'}
                  </button>
                  <button
                    onClick={() => deletePromo(p.id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition"
                  >
                    Supprimer
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 2: Campaign builder
          ═══════════════════════════════════════════════════════════════════ */}
      <section className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-5">
        <h3 className="text-lg font-semibold text-white">Envoyer une campagne</h3>

        {sendResult && (
          <div className="bg-emerald-500/20 border border-emerald-500/30 rounded-lg p-3 text-emerald-400 text-sm">
            Campagne envoy\u00e9e avec succ\u00e8s \u00e0 {sendResult.sent} destinataires.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Promo dropdown */}
          <div>
            <label className="block text-sm text-slate-400 mb-1">Promotion (optionnel)</label>
            <select
              value={selectedPromo}
              onChange={e => setSelectedPromo(e.target.value ? parseInt(e.target.value) : '')}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="">Aucune promotion</option>
              {activePromos.map(p => (
                <option key={p.id} value={p.id}>{p.nom} (-{p.rabais_pct}%)</option>
              ))}
            </select>
          </div>

          {/* Audience */}
          <div>
            <label className="block text-sm text-slate-400 mb-1">Audience</label>
            <select
              value={audience}
              onChange={e => setAudience(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              {AUDIENCES.map(a => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              {countLoading ? 'Chargement...' : recipientCount !== null ? `${recipientCount} destinataire${recipientCount !== 1 ? 's' : ''}` : ''}
            </p>
          </div>
        </div>

        {/* Message */}
        <div>
          <label className="block text-sm text-slate-400 mb-1">Message personnalis\u00e9</label>
          <textarea
            value={customMessage}
            onChange={e => setCustomMessage(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            rows={6}
            placeholder="Votre message..."
          />
        </div>

        {/* Send button */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowConfirm(true)}
            disabled={!customMessage.trim() || !audience || recipientCount === 0}
            className="px-5 py-2.5 bg-amber-500 text-slate-900 rounded-lg text-sm font-semibold hover:bg-amber-400 transition disabled:opacity-50"
          >
            Envoyer la campagne
          </button>
          {recipientCount !== null && recipientCount > 0 && (
            <span className="text-slate-400 text-sm">{recipientCount} destinataire{recipientCount !== 1 ? 's' : ''}</span>
          )}
        </div>
      </section>

      {/* ── Confirmation dialog ── */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 max-w-md w-full space-y-4">
            <h4 className="text-white font-semibold text-lg">Confirmer l&apos;envoi</h4>
            <p className="text-slate-300 text-sm">
              Vous allez envoyer un courriel \u00e0 <strong className="text-amber-400">{recipientCount}</strong> destinataire{recipientCount !== 1 ? 's' : ''}.
            </p>
            <p className="text-slate-400 text-xs">Audience: {audienceLabel(audience)}</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowConfirm(false)}
                disabled={sending}
                className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg text-sm hover:bg-slate-600 transition"
              >
                Annuler
              </button>
              <button
                onClick={sendCampaign}
                disabled={sending}
                className="px-4 py-2 bg-amber-500 text-slate-900 rounded-lg text-sm font-semibold hover:bg-amber-400 transition disabled:opacity-50"
              >
                {sending ? 'Envoi en cours...' : 'Confirmer l\'envoi'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          SECTION 3: Campaign history
          ═══════════════════════════════════════════════════════════════════ */}
      <section>
        <h3 className="text-lg font-semibold text-white mb-4">Historique des campagnes</h3>

        {campaigns.length === 0 ? (
          <p className="text-slate-500 text-sm">Aucune campagne envoy\u00e9e.</p>
        ) : (
          <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left text-slate-400 font-medium px-4 py-3">Date</th>
                  <th className="text-left text-slate-400 font-medium px-4 py-3">Campagne</th>
                  <th className="text-left text-slate-400 font-medium px-4 py-3">Audience</th>
                  <th className="text-right text-slate-400 font-medium px-4 py-3">Destinataires</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {campaigns.map(c => (
                  <tr key={c.id} className="hover:bg-slate-700/50">
                    <td className="px-4 py-3 text-slate-300">{formatDate(c.sent_at)}</td>
                    <td className="px-4 py-3 text-white">{c.nom}</td>
                    <td className="px-4 py-3 text-slate-400">{audienceLabel(c.audience)}</td>
                    <td className="px-4 py-3 text-right text-amber-400 font-medium">{c.destinataires_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
