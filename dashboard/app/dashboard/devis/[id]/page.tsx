'use client';

import { useState, useEffect, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { fetchQuote, updateQuote, sendQuote, sendQuoteSMS, type Quote, type QuoteStatut } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { SERVICES, formatMoney, type ServiceType } from '@/lib/pricing';

const BADGE: Record<QuoteStatut, string> = {
  brouillon:      'bg-slate-500/20 text-slate-300 border-slate-500/30',
  en_attente:     'bg-blue-500/20 text-blue-300 border-blue-500/30',
  approuve:       'bg-amber-500/20 text-amber-300 border-amber-500/30',
  envoye:         'bg-purple-500/20 text-purple-300 border-purple-500/30',
  contrat_signe:  'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  depot_paye:     'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  planifie:       'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  complete:       'bg-green-500/20 text-green-300 border-green-500/30',
  refuse:         'bg-red-500/20 text-red-300 border-red-500/30',
};

const LABEL: Record<QuoteStatut, string> = {
  brouillon:      'Brouillon',
  en_attente:     'En attente',
  approuve:       'Approuvé',
  envoye:         'Envoyé',
  contrat_signe:  'Contrat signé',
  depot_paye:     'Dépôt payé',
  planifie:       'Planifié',
  complete:       'Complété',
  refuse:         'Refusé',
};

export default function DevisDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [quote, setQuote]     = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction]   = useState('');
  const [error, setError]     = useState('');
  const [ccEmail, setCcEmail] = useState(searchParams.get('cc') ?? '');

  useEffect(() => {
    fetchQuote(parseInt(id)).then(q => { setQuote(q); setLoading(false); }).catch(() => setLoading(false));
    // Fetch booking for this quote
    fetch(`/api/bookings?quote_id=${id}`).then(r => r.json()).then(data => {
      if (data.booking) {
        setBooking(data.booking);
        setNewJ1(data.booking.jour1_date);
        setNewJ1Slot(data.booking.jour1_slot || 'matin');
        setNewJ2(data.booking.jour2_date);
        setNewJ2Slot(data.booking.jour2_slot);
      }
    }).catch(() => {});
    // Fetch linked invoice
    fetch(`/api/invoices?quote_id=${id}`).then(r => r.json()).then(res => {
      const list = res?.data ?? res;
      if (Array.isArray(list) && list.length > 0) setLinkedInvoice({ id: list[0].id, numero: list[0].numero });
    }).catch(() => {});
  }, [id]);

  async function handleSaveDates() {
    if (!newJ1 || !newJ2) return;
    setSavingDates(true);
    setError('');
    try {
      const res = await fetch(`/api/bookings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quote_id: parseInt(id), jour1_date: newJ1, jour1_slot: newJ1Slot, jour2_date: newJ2, jour2_slot: newJ2Slot }),
      });
      const data = await res.json();
      if (data.ok) {
        // Refresh booking from server
        const br = await fetch(`/api/bookings?quote_id=${id}`).then(r => r.json());
        if (br.booking) setBooking(br.booking);
        else setBooking({ id: 0, jour1_date: newJ1, jour1_slot: newJ1Slot, jour2_date: newJ2, jour2_slot: newJ2Slot, statut: 'en_attente' });
        setEditingDates(false);
        // Also update quote status to planifie if depot_paye
        const updated = await fetchQuote(parseInt(id));
        setQuote(updated);
      } else {
        setError(data.error || 'Erreur lors de la mise a jour des dates');
      }
    } catch { setError('Erreur reseau'); }
    setSavingDates(false);
  }

  async function handleApprove() {
    if (!quote) return;
    setAction('approve');
    setError('');
    try {
      const updated = await updateQuote(quote.id, { statut: 'approuve' });
      setQuote(updated);
    } catch { setError('Erreur lors de l\'approbation'); }
    setAction('');
  }

  async function handleSend() {
    if (!quote) return;
    setAction('send');
    setError('');
    try {
      await sendQuote(quote.id, ccEmail || undefined);
      const updated = await fetchQuote(quote.id);
      setQuote(updated);
    } catch (e) {
      setError(`Erreur lors de l'envoi: ${e instanceof Error ? e.message : String(e)}`);
    }
    setAction('');
  }

  async function handleSendSMS() {
    if (!quote) return;
    setAction('sms');
    setError('');
    try {
      await sendQuoteSMS(quote.id);
      const updated = await fetchQuote(quote.id);
      setQuote(updated);
    } catch (e) {
      setError(`Erreur SMS: ${e instanceof Error ? e.message : String(e)}`);
    }
    setAction('');
  }

  async function handleRefuse() {
    if (!quote) return;
    setAction('refuse');
    try {
      const updated = await updateQuote(quote.id, { statut: 'refuse' });
      setQuote(updated);
    } catch { setError('Erreur'); }
    setAction('');
  }

  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ client_nom: '', client_email: '', client_tel: '', client_adresse: '', type_service: '', superficie: '', notes: '', description_travaux: '', couleur_flake: '', rabais_pct: '', prix_fixe_montant: '' });
  const [editExtras, setEditExtras] = useState<{ id?: number; description: string; quantite: string; prix_unitaire: string; sous_total: string }[]>([]);
  const [saving, setSaving] = useState(false);

  function startEdit() {
    if (!quote) return;
    setEditForm({
      client_nom: quote.client_nom ?? '',
      client_email: quote.client_email ?? '',
      client_tel: quote.client_tel ?? '',
      client_adresse: quote.client_adresse ?? '',
      type_service: quote.type_service ?? 'flake',
      superficie: String(quote.superficie ?? ''),
      notes: quote.notes ?? '',
      description_travaux: quote.description_travaux ?? '',
      couleur_flake: quote.couleur_flake ?? '',
      rabais_pct: String(quote.rabais_pct ?? 0),
      prix_fixe_montant: Number(quote.prix_pied_carre) === 0 && Number(quote.sous_total) > 0 ? String(quote.sous_total) : '',
    });
    setEditExtras((quote.extras ?? []).map(ex => ({
      id: ex.id as number | undefined,
      description: String(ex.description ?? ''),
      quantite: String(ex.quantite ?? 1),
      prix_unitaire: String(ex.prix_unitaire ?? 0),
      sous_total: String(ex.sous_total ?? 0),
    })));
    setEditing(true);
  }

  async function handleSaveEdit() {
    if (!quote) return;
    setSaving(true);
    setError('');
    try {
      const isPrixFixe = Number(quote.prix_pied_carre) === 0 && Number(quote.sous_total) > 0;
      const updated = await updateQuote(quote.id, {
        ...editForm,
        superficie: parseFloat(editForm.superficie) || quote.superficie,
        rabais_pct: parseFloat(editForm.rabais_pct) || 0,
        ...(isPrixFixe && editForm.prix_fixe_montant ? { sous_total: parseFloat(editForm.prix_fixe_montant) } : {}),
      } as Record<string, unknown>);

      // Save extras: delete all then re-insert
      await fetch(`/api/quotes/${quote.id}/extras`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editExtras.map((ex, i) => ({
          id: ex.id,
          description: ex.description,
          quantite: parseFloat(ex.quantite) || 1,
          prix_unitaire: parseFloat(ex.prix_unitaire) || 0,
          sous_total: parseFloat(ex.sous_total) || parseFloat(ex.quantite) * parseFloat(ex.prix_unitaire),
          sort_order: i,
        }))),
      }).catch(() => {});

      setQuote(updated);
      setEditing(false);
      setSendSuccess('Modifications sauvegardées!');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Erreur sauvegarde: ${msg}`);
      console.error('handleSaveEdit error:', e);
    } finally {
      setSaving(false);
    }
  }

  const [sendSuccess, setSendSuccess] = useState('');
  async function handleResend() {
    if (!quote) return;
    setAction('resend');
    setError('');
    setSendSuccess('');
    try {
      await sendQuote(quote.id, ccEmail || undefined);
      const updated = await fetchQuote(quote.id);
      setQuote(updated);
      setSendSuccess('Devis envoyé au client avec succès!');
      setTimeout(() => setSendSuccess(''), 5000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('429')) {
        setSendSuccess('Devis déjà envoyé! Le client l\'a reçu.');
      } else {
        setError(`Erreur renvoi: ${msg}`);
      }
    }
    setAction('');
  }
  const [depositResult, setDepositResult] = useState<{ conflict?: boolean; available_dates?: { date: string; jour2_date: string; jour2_slot: string }[]; confirmed?: boolean; booking_confirmed?: boolean } | null>(null);
  const [linkedInvoice, setLinkedInvoice] = useState<{ id: number; numero: string } | null>(null);

  // Booking state
  const [booking, setBooking] = useState<{ id: number; jour1_date: string; jour1_slot: string; jour2_date: string; jour2_slot: string; statut: string } | null>(null);
  const [editingDates, setEditingDates] = useState(false);
  const [newJ1, setNewJ1] = useState('');
  const [newJ2, setNewJ2] = useState('');
  const [newJ1Slot, setNewJ1Slot] = useState('matin');
  const [newJ2Slot, setNewJ2Slot] = useState('apres-midi');
  const [savingDates, setSavingDates] = useState(false);

  function slotLabel(s: string) {
    if (s === 'journee') return 'Journée complète (8h-16h)';
    if (s === 'matin') return 'Matin (8h-12h)';
    return 'Après-midi (12h-16h)';
  }

  async function handleConfirmDeposit() {
    if (!quote) return;
    setAction('deposit');
    setError('');
    setDepositResult(null);
    try {
      const res = await fetch(`/api/quotes/${quote.id}/confirm-deposit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success) {
        setDepositResult({ confirmed: true, booking_confirmed: data.booking_confirmed });
        const updated = await fetchQuote(quote.id);
        setQuote(updated);
      } else if (data.conflict) {
        setDepositResult({ conflict: true, available_dates: data.available_dates });
      } else {
        setError(data.error || 'Erreur lors de la confirmation du depot');
      }
    } catch (e) {
      setError(`Erreur: ${e instanceof Error ? e.message : String(e)}`);
    }
    setAction('');
  }

  if (loading) return <div className="p-6 text-slate-400">Chargement...</div>;
  if (!quote) return <div className="p-6 text-red-400">Devis introuvable</div>;

  const service = SERVICES[quote.type_service as ServiceType];

  return (
    <div className="p-3 sm:p-6 max-w-3xl space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <button onClick={() => router.push('/dashboard/devis')} className="text-slate-400 hover:text-white text-sm mb-2 block transition">
            &larr; Retour aux devis
          </button>
          <h2 className="text-2xl font-bold text-white">Devis #{quote.id}</h2>
        </div>
        <span className={`text-sm font-medium px-3 py-1.5 rounded border ${BADGE[quote.statut]}`}>
          {LABEL[quote.statut]}
        </span>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}
      {sendSuccess && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-2">
          <p className="text-green-400 text-sm">{sendSuccess}</p>
        </div>
      )}

      {/* DÉPÔT REÇU — gros badge visible immédiatement */}
      {['depot_paye', 'planifie', 'complete'].includes(quote.statut) && (
        <div className="bg-gradient-to-r from-emerald-500/20 to-green-500/20 border-2 border-emerald-500/60 rounded-xl p-4 sm:p-5 flex items-center gap-4 shadow-lg shadow-emerald-500/10">
          <div className="text-4xl sm:text-5xl">✅</div>
          <div className="flex-1">
            <p className="text-emerald-300 text-xs font-bold uppercase tracking-wider">Dépôt reçu</p>
            <p className="text-white text-lg sm:text-xl font-bold">{formatMoney(Number(quote.depot_requis))} encaissé</p>
            {quote.paid_at && (
              <p className="text-emerald-400/80 text-xs mt-0.5">Confirmé le {formatDate(quote.paid_at)}</p>
            )}
          </div>
          {!!(quote as unknown as Record<string, unknown>).balance_paid_at && (
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-emerald-300 text-xs font-bold">SOLDE PAYÉ</span>
              <span className="text-white text-sm">{formatMoney(Number(quote.total) - Number(quote.depot_requis))}</span>
            </div>
          )}
        </div>
      )}

      {/* CC email input */}
      <div className="flex items-center gap-2">
        <label className="text-slate-500 text-xs whitespace-nowrap">CC :</label>
        <input
          type="email"
          value={ccEmail}
          onChange={e => setCcEmail(e.target.value)}
          placeholder="jason@exemple.com (optionnel)"
          className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white w-64 focus:outline-none focus:border-amber-500 placeholder:text-slate-600"
        />
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 flex-wrap">
        {!editing && (
          <button onClick={startEdit} className="bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg px-4 py-2 text-sm transition">
            ✏️ Modifier
          </button>
        )}
        {quote.sent_at && (
          <button onClick={handleResend} disabled={!!action} className="bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-lg px-4 py-2 text-sm transition disabled:opacity-40">
            {action === 'resend' ? 'Renvoi...' : '📤 Renvoyer au client'}
          </button>
        )}
      </div>

      {/* Edit mode */}
      {editing ? (
        <div className="bg-slate-800 border border-blue-500/30 rounded-xl p-3 sm:p-6 space-y-4">
          <h3 className="text-blue-400 text-xs font-medium uppercase tracking-wider">Modifier le devis</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-slate-500 text-xs mb-1 block">Nom</label>
              <input value={editForm.client_nom} onChange={e => setEditForm(f => ({ ...f, client_nom: e.target.value }))} className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white w-full focus:outline-none focus:border-amber-500" />
            </div>
            <div>
              <label className="text-slate-500 text-xs mb-1 block">Email</label>
              <input value={editForm.client_email} onChange={e => setEditForm(f => ({ ...f, client_email: e.target.value }))} className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white w-full focus:outline-none focus:border-amber-500" />
            </div>
            <div>
              <label className="text-slate-500 text-xs mb-1 block">Telephone</label>
              <input value={editForm.client_tel} onChange={e => setEditForm(f => ({ ...f, client_tel: e.target.value }))} className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white w-full focus:outline-none focus:border-amber-500" />
            </div>
            <div>
              <label className="text-slate-500 text-xs mb-1 block">Adresse</label>
              <input value={editForm.client_adresse} onChange={e => setEditForm(f => ({ ...f, client_adresse: e.target.value }))} className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white w-full focus:outline-none focus:border-amber-500" />
            </div>
            <div>
              <label className="text-slate-500 text-xs mb-1 block">Service</label>
              <select value={editForm.type_service} onChange={e => setEditForm(f => ({ ...f, type_service: e.target.value }))} className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white w-full focus:outline-none focus:border-amber-500">
                {Object.entries(SERVICES).map(([key, svc]) => <option key={key} value={key}>{svc.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-slate-500 text-xs mb-1 block">Couleur de flake</label>
              <input value={editForm.couleur_flake} onChange={e => setEditForm(f => ({ ...f, couleur_flake: e.target.value }))} placeholder="Ex: Blizzard, Sand Dollar..." className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white w-full focus:outline-none focus:border-amber-500" />
            </div>
            <div>
              <label className="text-slate-500 text-xs mb-1 block">Superficie (pi²)</label>
              <input value={editForm.superficie} onChange={e => setEditForm(f => ({ ...f, superficie: e.target.value }))} type="number" className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white w-full focus:outline-none focus:border-amber-500" />
            </div>
            {Number(quote.prix_pied_carre) === 0 && Number(quote.sous_total) > 0 && (
              <div>
                <label className="text-slate-500 text-xs mb-1 block">Prix fixe ($) — avant taxes</label>
                <input value={editForm.prix_fixe_montant} onChange={e => setEditForm(f => ({ ...f, prix_fixe_montant: e.target.value }))} type="number" className="bg-slate-700 border border-amber-500/50 rounded-lg px-3 py-2 text-sm text-white w-full focus:outline-none focus:border-amber-500" />
              </div>
            )}
            <div>
              <label className="text-slate-500 text-xs mb-1 block">Rabais %</label>
              <input value={editForm.rabais_pct} onChange={e => setEditForm(f => ({ ...f, rabais_pct: e.target.value }))} type="number" className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white w-full focus:outline-none focus:border-amber-500" />
            </div>
            <div className="col-span-2">
              <label className="text-slate-500 text-xs mb-2 block">Extras / Lignes supplémentaires</label>
              <div className="space-y-2">
                {editExtras.map((ex, i) => (
                  <div key={i} className="grid grid-cols-12 gap-1 items-center">
                    <input
                      value={ex.description}
                      onChange={e => setEditExtras(prev => prev.map((x, j) => j === i ? { ...x, description: e.target.value } : x))}
                      placeholder="Description"
                      className="col-span-5 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-amber-500"
                    />
                    <input
                      value={ex.quantite}
                      onChange={e => {
                        const q = e.target.value;
                        setEditExtras(prev => prev.map((x, j) => j === i ? { ...x, quantite: q, sous_total: String(Math.round(parseFloat(q || '0') * parseFloat(x.prix_unitaire || '0') * 100) / 100) } : x));
                      }}
                      placeholder="Qté"
                      type="number"
                      className="col-span-2 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-amber-500"
                    />
                    <input
                      value={ex.prix_unitaire}
                      onChange={e => {
                        const p = e.target.value;
                        setEditExtras(prev => prev.map((x, j) => j === i ? { ...x, prix_unitaire: p, sous_total: String(Math.round(parseFloat(x.quantite || '0') * parseFloat(p || '0') * 100) / 100) } : x));
                      }}
                      placeholder="$/u"
                      type="number"
                      className="col-span-2 bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-amber-500"
                    />
                    <div className="col-span-2 text-amber-400 text-sm text-right pr-1">{formatMoney(parseFloat(ex.sous_total) || 0)}</div>
                    <button onClick={() => setEditExtras(prev => prev.filter((_, j) => j !== i))} className="col-span-1 text-red-400 hover:text-red-300 text-lg leading-none">×</button>
                  </div>
                ))}
                <button
                  onClick={() => setEditExtras(prev => [...prev, { description: '', quantite: '1', prix_unitaire: '0', sous_total: '0' }])}
                  className="text-amber-400 hover:text-amber-300 text-sm font-medium"
                >
                  + Ajouter une ligne
                </button>
              </div>
            </div>
            <div className="col-span-2">
              <label className="text-slate-500 text-xs mb-1 block">Description des travaux</label>
              <textarea value={editForm.description_travaux} onChange={e => setEditForm(f => ({ ...f, description_travaux: e.target.value }))} rows={6} placeholder="Étape 1: Meulage complet...&#10;Étape 2: Première couche..." className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white w-full focus:outline-none focus:border-amber-500" />
            </div>
            <div className="col-span-2">
              <label className="text-slate-500 text-xs mb-1 block">Notes</label>
              <textarea value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white w-full focus:outline-none focus:border-amber-500" />
            </div>
            <div className="col-span-2">
              <label className="text-slate-500 text-xs mb-1 block">CC — copie email (optionnel)</label>
              <input type="email" value={ccEmail} onChange={e => setCcEmail(e.target.value)} placeholder="ex: jason@gmail.com" className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white w-full focus:outline-none focus:border-amber-500" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSaveEdit} disabled={saving} className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold rounded-lg px-5 py-2 text-sm transition disabled:opacity-40">
              {saving ? 'Sauvegarde...' : 'Sauvegarder + Recalculer'}
            </button>
            <button onClick={() => setEditing(false)} className="bg-slate-700 text-slate-300 rounded-lg px-4 py-2 text-sm hover:bg-slate-600">Annuler</button>
          </div>
        </div>
      ) : (
        /* Client (read-only) */
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
          <h3 className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-4">Client</h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-slate-500">Nom</p>
              <Link href={`/dashboard/crm?search=${encodeURIComponent(quote.client_nom)}`} className="text-amber-400 hover:text-amber-300 font-medium transition hover:underline">{quote.client_nom}</Link>
            </div>
            <div>
              <p className="text-slate-500">Courriel</p>
              <p className="text-white">{quote.client_email}</p>
            </div>
            <div>
              <p className="text-slate-500">Telephone</p>
              <p className="text-white">{quote.client_tel ?? '—'}</p>
            </div>
            <div>
              <p className="text-slate-500">Adresse</p>
              <p className="text-white">{quote.client_adresse ?? '—'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Detail projet */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
        <h3 className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-4">Projet</h3>
        <div className="space-y-3 text-sm mb-4">
          {/* Show items if available, otherwise show single service */}
          {quote.items && quote.items.length > 0 ? (
            <>
              <p className="text-slate-500 text-xs uppercase">Services</p>
              {quote.items.map((item, idx) => {
                const isPrixFixe = Number(item.prix_pied_carre) === 0 && Number(item.sous_total) > 0;
                return (
                  <div key={idx} className="flex justify-between bg-slate-900/50 rounded-lg px-3 py-2">
                    <span className="text-white font-medium">{SERVICES[item.type_service as ServiceType]?.label ?? item.type_service}</span>
                    <span className="text-slate-300">{isPrixFixe ? `Prix fixe — ${Number(item.superficie)} pi²` : `${Number(item.superficie)} pi² @ ${formatMoney(Number(item.prix_pied_carre))}/pi²`}</span>
                  </div>
                );
              })}
            </>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-slate-500">Service</p>
                <p className="text-white font-medium">{service.label}</p>
              </div>
              <div>
                <p className="text-slate-500">Superficie</p>
                <p className="text-white">{Number(quote.prix_pied_carre) === 0 && Number(quote.sous_total) > 0 ? `Prix fixe — ${quote.superficie} pi²` : `${quote.superficie} pi²`}</p>
              </div>
            </div>
          )}

          {/* Show extras if available */}
          {quote.extras && quote.extras.length > 0 && (
            <>
              <p className="text-slate-500 text-xs uppercase mt-3">Extras</p>
              {quote.extras.map((ex, idx) => (
                <div key={idx} className="flex justify-between bg-slate-900/50 rounded-lg px-3 py-2">
                  <span className="text-white">{ex.description} {Number(ex.quantite) > 1 ? `x${ex.quantite}` : ''}</span>
                  <span className="text-slate-300">{formatMoney(Number(ex.sous_total))}</span>
                </div>
              ))}
            </>
          )}

          {quote.etat_plancher && (
            <div>
              <p className="text-slate-500">Etat du plancher</p>
              <p className="text-white">{quote.etat_plancher}</p>
            </div>
          )}
          {quote.couleur_flake && (
            <div>
              <p className="text-slate-500">Couleur de flake</p>
              <p className="text-white font-medium">{quote.couleur_flake}</p>
            </div>
          )}
          {quote.description_travaux && (
            <div>
              <p className="text-slate-500">Description des travaux</p>
              <p className="text-white whitespace-pre-line">{quote.description_travaux}</p>
            </div>
          )}
          {quote.notes && (
            <div>
              <p className="text-slate-500">Notes</p>
              <p className="text-white">{quote.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Photos client (MMS reçus) */}
      {quote.photos && quote.photos.length > 0 && (
        <div className="bg-slate-800 border border-amber-500/30 rounded-xl p-6">
          <h3 className="text-amber-400 text-xs font-medium uppercase tracking-wider mb-4">📸 Photos du client ({quote.photos.length})</h3>
          <div className="grid grid-cols-2 gap-3">
            {quote.photos.map((photo, idx) => (
              <a key={idx} href={photo.url} target="_blank" rel="noopener noreferrer" className="block">
                <img
                  src={photo.url}
                  alt={`Photo ${idx + 1}`}
                  className="w-full h-40 object-cover rounded-lg border border-slate-600 hover:border-amber-500 transition"
                />
                <p className="text-slate-500 text-xs mt-1">{new Date(photo.received_at).toLocaleString('fr-CA')}</p>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Prix */}
      <div className="bg-slate-800 border border-amber-500/30 rounded-xl p-6">
        <h3 className="text-amber-400 text-xs font-medium uppercase tracking-wider mb-4">Prix</h3>
        <div className="space-y-3 text-sm">
          {/* Show items breakdown if available */}
          {quote.items && quote.items.length > 0 ? (
            quote.items.map((item, idx) => {
              const isPrixFixe = Number(item.prix_pied_carre) === 0 && Number(item.sous_total) > 0;
              return (
                <div key={idx} className="flex justify-between text-slate-300">
                  <span>{SERVICES[item.type_service as ServiceType]?.label ?? item.type_service}{isPrixFixe ? ` — Prix fixe — ${Number(item.superficie)} pi²` : ` x ${Number(item.superficie)} pi²`}</span>
                  <span>{formatMoney(Number(item.sous_total))}</span>
                </div>
              );
            })
          ) : (
            <div className="flex justify-between text-slate-300">
              {Number(quote.prix_pied_carre) === 0 && Number(quote.sous_total) > 0 ? (
                <>
                  <span>{service.label} — Prix fixe — {quote.superficie} pi²</span>
                  <span>{formatMoney(Number(quote.sous_total))}</span>
                </>
              ) : (
                <>
                  <span>{service.label} x {quote.superficie} pi² @ {formatMoney(Number(quote.prix_pied_carre))}/pi²</span>
                  <span>{formatMoney(Math.round(Number(quote.prix_pied_carre) * Number(quote.superficie) * 100) / 100)}</span>
                </>
              )}
            </div>
          )}

          {/* Extras in price breakdown */}
          {quote.extras && quote.extras.map((ex, idx) => (
            <div key={idx} className="flex justify-between text-slate-300">
              <span>{ex.description} {Number(ex.quantite) > 1 ? `x${ex.quantite}` : ''}</span>
              <span>{formatMoney(Number(ex.sous_total))}</span>
            </div>
          ))}

          {Number(quote.rabais_pct) > 0 && (
            <div className="flex justify-between text-green-400 font-medium">
              <span>Rabais {quote.rabais_pct}%</span>
              <span>-{formatMoney(Number(quote.rabais_montant))}</span>
            </div>
          )}
          <div className="flex justify-between text-slate-300 pt-1 border-t border-slate-700">
            <span>Sous-total</span>
            <span>{formatMoney(Number(quote.sous_total))}</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>TPS (5%)</span>
            <span>{formatMoney(Number(quote.tps))}</span>
          </div>
          <div className="flex justify-between text-slate-400">
            <span>TVQ (9,975%)</span>
            <span>{formatMoney(Number(quote.tvq))}</span>
          </div>
          <div className="flex justify-between text-white font-bold text-lg pt-3 border-t border-slate-700">
            <span>Total</span>
            <span>{formatMoney(Number(quote.total))}</span>
          </div>
          <div className="flex justify-between text-amber-400 font-semibold">
            <span>Depot requis (30%)</span>
            <span>{formatMoney(Number(quote.depot_requis))}</span>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
        <h3 className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-4">Historique</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-400">Cree le</span>
            <span className="text-white">{formatDate(quote.created_at)}</span>
          </div>
          {quote.approved_at && (
            <div className="flex justify-between">
              <span className="text-slate-400">Approuve le</span>
              <span className="text-white">{formatDate(quote.approved_at)}</span>
            </div>
          )}
          {quote.sent_at && (
            <div className="flex justify-between">
              <span className="text-slate-400">Envoye le</span>
              <span className="text-white">{formatDate(quote.sent_at)}</span>
            </div>
          )}
          {quote.contrat_signe_at && (
            <div className="flex justify-between">
              <span className="text-slate-400">Contrat signe le</span>
              <span className="text-white">{formatDate(quote.contrat_signe_at)}</span>
            </div>
          )}
          {quote.contrat_signature_nom && (
            <div className="flex justify-between">
              <span className="text-slate-400">Signe par</span>
              <span className="text-white">{quote.contrat_signature_nom}</span>
            </div>
          )}
          {quote.paid_at && (
            <div className="flex justify-between">
              <span className="text-slate-400">Depot paye le</span>
              <span className="text-white">{formatDate(quote.paid_at)}</span>
            </div>
          )}
          {!!(quote as unknown as Record<string, unknown>).deposit_paid_at && (
            <div className="flex justify-between">
              <span className="text-slate-400">Depot (Stripe) le</span>
              <span className="text-emerald-400">{formatDate((quote as unknown as Record<string, unknown>).deposit_paid_at as string)}</span>
            </div>
          )}
          {!!(quote as unknown as Record<string, unknown>).balance_paid_at && (
            <div className="flex justify-between">
              <span className="text-slate-400">Solde paye le</span>
              <span className="text-emerald-400">{formatDate((quote as unknown as Record<string, unknown>).balance_paid_at as string)}</span>
            </div>
          )}
          {!!(quote as unknown as Record<string, unknown>).stripe_deposit_session_id && (
            <div className="mt-3 pt-3 border-t border-slate-700">
              <a
                href={`https://dashboard.stripe.com/payments/${(quote as unknown as Record<string, unknown>).stripe_deposit_session_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 hover:text-indigo-200 hover:bg-indigo-500/30 px-3 py-2 rounded-lg text-sm font-medium transition"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z"/></svg>
                Voir sur Stripe
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Reservation */}
      {booking && (
        <div className="bg-slate-800 border border-cyan-500/30 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-cyan-400 text-xs font-medium uppercase tracking-wider">Reservation</h3>
            <span className={`text-xs font-medium px-2 py-1 rounded ${booking.statut === 'confirme' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
              {booking.statut === 'confirme' ? 'Confirmee' : 'En attente'}
            </span>
          </div>
          {!editingDates ? (
            <div>
              <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                <div className="bg-slate-900 rounded-lg p-3">
                  <p className="text-cyan-400 text-xs font-semibold mb-1">JOUR 1 — Preparation</p>
                  <p className="text-white font-medium">{new Date(booking.jour1_date + 'T12:00:00').toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                  <p className="text-slate-400 text-xs">{slotLabel(booking.jour1_slot)}</p>
                </div>
                <div className="bg-slate-900 rounded-lg p-3">
                  <p className="text-cyan-400 text-xs font-semibold mb-1">JOUR 2 — Finition</p>
                  <p className="text-white font-medium">{new Date(booking.jour2_date + 'T12:00:00').toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
                  <p className="text-slate-400 text-xs">{slotLabel(booking.jour2_slot)}</p>
                </div>
              </div>
              <button onClick={() => setEditingDates(true)} className="text-cyan-400 hover:text-cyan-300 text-sm font-medium transition">
                Modifier les dates
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 text-xs block mb-1">Jour 1 — Date</label>
                  <input type="date" value={newJ1} onChange={e => setNewJ1(e.target.value)} className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500" />
                </div>
                <div>
                  <label className="text-slate-400 text-xs block mb-1">Jour 1 — Horaire</label>
                  <select value={newJ1Slot} onChange={e => setNewJ1Slot(e.target.value)} className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500">
                    <option value="matin">Matin (8h-12h)</option>
                    <option value="apres-midi">Après-midi (12h-16h)</option>
                    <option value="journee">Journée complète (8h-16h)</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 text-xs block mb-1">Jour 2 — Date</label>
                  <input type="date" value={newJ2} onChange={e => setNewJ2(e.target.value)} className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500" />
                </div>
                <div>
                  <label className="text-slate-400 text-xs block mb-1">Jour 2 — Horaire</label>
                  <select value={newJ2Slot} onChange={e => setNewJ2Slot(e.target.value)} className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500">
                    <option value="matin">Matin (8h-12h)</option>
                    <option value="apres-midi">Après-midi (12h-16h)</option>
                    <option value="journee">Journée complète (8h-16h)</option>
                  </select>
                </div>
              </div>
              <p className="text-cyan-400/80 text-xs">📲 Synchronisé automatiquement avec ton agenda iPhone via l&apos;abonnement iCal.</p>
              <div className="flex gap-2">
                <button onClick={handleSaveDates} disabled={savingDates} className="bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-lg px-4 py-2 text-sm transition disabled:opacity-40">
                  {savingDates ? 'Sauvegarde...' : 'Sauvegarder'}
                </button>
                <button onClick={() => { setEditingDates(false); setNewJ1(booking.jour1_date); setNewJ2(booking.jour2_date); setNewJ1Slot(booking.jour1_slot || 'matin'); setNewJ2Slot(booking.jour2_slot); }} className="bg-slate-700 text-slate-300 rounded-lg px-4 py-2 text-sm hover:bg-slate-600">Annuler</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Payment link */}
      {['contrat_signe', 'depot_paye', 'planifie', 'complete'].includes(quote.statut) && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
          <h3 className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-4">Lien de paiement</h3>
          <div className="flex items-center gap-3">
            <code className="bg-slate-900 text-amber-400 px-3 py-2 rounded-lg text-sm flex-1 overflow-x-auto">
              https://novus-epoxy.vercel.app/paiement/{quote.id}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(`https://novus-epoxy.vercel.app/paiement/${quote.id}`);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 font-semibold rounded-lg px-4 py-2 text-sm transition border border-amber-500/30 whitespace-nowrap"
            >
              {copied ? 'Copie!' : 'Copier'}
            </button>
          </div>
        </div>
      )}

      {/* Mark balance paid (for Interac payments) */}
      {quote.statut === 'depot_paye' && !((quote as unknown as Record<string, unknown>).balance_paid_at) && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-6">
          <h3 className="text-emerald-400 text-xs font-medium uppercase tracking-wider mb-4">Solde</h3>
          <p className="text-slate-300 text-sm mb-4">Confirmez la reception du solde final ({formatMoney(Number(quote.total) - Number(quote.depot_requis))}) pour marquer le devis comme complet.</p>
          <button
            onClick={async () => {
              if (!quote) return;
              setAction('balance');
              setError('');
              try {
                const res = await fetch(`/api/quotes/${quote.id}/confirm-balance`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                });
                const data = await res.json();
                if (!data.success) {
                  setError(data.error || 'Erreur lors de la confirmation du solde');
                } else {
                  const updated = await fetchQuote(quote.id);
                  setQuote(updated);
                }
              } catch (e) {
                setError(`Erreur: ${e instanceof Error ? e.message : String(e)}`);
              }
              setAction('');
            }}
            disabled={!!action}
            className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold rounded-lg px-6 py-2.5 text-sm transition"
          >
            {action === 'balance' ? 'Confirmation...' : 'Confirmer le solde recu (Interac)'}
          </button>
        </div>
      )}

      {/* Planifier les dates — shown when no booking yet and statut is advanced enough */}
      {!booking && ['depot_paye', 'planifie', 'contrat_signe', 'envoye'].includes(quote.statut) && (
        <div className="bg-slate-800 border border-amber-500/30 rounded-xl p-6">
          <h3 className="text-amber-400 text-xs font-medium uppercase tracking-wider mb-3">Planifier les travaux</h3>
          <p className="text-slate-400 text-xs mb-4">Aucune date de travaux planifiée. Choisissez les dates ci-dessous.</p>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-slate-400 text-xs block mb-1">Jour 1 — Date (préparation)</label>
                <input type="date" value={newJ1} onChange={e => setNewJ1(e.target.value)} className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500" />
              </div>
              <div>
                <label className="text-slate-400 text-xs block mb-1">Jour 1 — Horaire</label>
                <select value={newJ1Slot} onChange={e => setNewJ1Slot(e.target.value)} className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500">
                  <option value="matin">Matin (8h-12h)</option>
                  <option value="apres-midi">Après-midi (12h-16h)</option>
                  <option value="journee">Journée complète (8h-16h)</option>
                </select>
              </div>
              <div>
                <label className="text-slate-400 text-xs block mb-1">Jour 2 — Date (finition)</label>
                <input type="date" value={newJ2} onChange={e => setNewJ2(e.target.value)} className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500" />
              </div>
              <div>
                <label className="text-slate-400 text-xs block mb-1">Jour 2 — Horaire</label>
                <select value={newJ2Slot} onChange={e => setNewJ2Slot(e.target.value)} className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500">
                  <option value="matin">Matin (8h-12h)</option>
                  <option value="apres-midi">Après-midi (12h-16h)</option>
                  <option value="journee">Journée complète (8h-16h)</option>
                </select>
              </div>
            </div>
            <p className="text-amber-400/80 text-xs">📲 Sauvegarde → ajouté à ton agenda iPhone via l&apos;abonnement iCal.</p>
            <button
              onClick={handleSaveDates}
              disabled={savingDates || !newJ1 || !newJ2}
              className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-semibold rounded-lg px-5 py-2 text-sm transition"
            >
              {savingDates ? 'Sauvegarde...' : 'Confirmer les dates'}
            </button>
          </div>
        </div>
      )}

      {/* Confirm deposit */}
      {['envoye', 'contrat_signe'].includes(quote.statut) && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-6">
          <h3 className="text-amber-400 text-xs font-medium uppercase tracking-wider mb-4">Depot</h3>
          <p className="text-slate-300 text-sm mb-4">{quote.statut === 'contrat_signe' ? 'Le contrat est signe.' : 'Devis envoye.'} Confirmez la reception du depot.</p>
          <button
            onClick={handleConfirmDeposit}
            disabled={!!action}
            className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold rounded-lg px-6 py-2.5 text-sm transition"
          >
            {action === 'deposit' ? 'Confirmation...' : 'Confirmer le depot recu'}
          </button>
        </div>
      )}

      {/* Deposit result */}
      {depositResult?.confirmed && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-4 py-3">
          <p className="text-emerald-400 text-sm font-semibold">✅ Depot confirme! Le devis est maintenant a statut &quot;depot_paye&quot;{depositResult.booking_confirmed ? ' et les dates de travaux sont bloquees dans le calendrier' : ''}. Le client a ete notifie par SMS.</p>
        </div>
      )}

      {depositResult?.conflict && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6">
          <h3 className="text-red-400 font-semibold mb-2">Les dates sont deja prises!</h3>
          <p className="text-slate-300 text-sm mb-4">Une autre reservation confirmee occupe deja ces dates. Voici des dates alternatives:</p>
          <div className="space-y-2">
            {depositResult.available_dates?.map((d, i) => (
              <div key={i} className="bg-slate-800 rounded-lg p-3 text-sm text-slate-300">
                Jour 1: {d.date} — Jour 2: {d.jour2_date} ({d.jour2_slot === 'matin' ? 'AM' : 'PM'})
              </div>
            ))}
          </div>
          <p className="text-slate-400 text-xs mt-3">Contactez le client pour replanifier, puis confirmez le depot a nouveau.</p>
        </div>
      )}

      {/* Contract */}
      {['envoye', 'contrat_signe', 'depot_paye', 'planifie', 'complete'].includes(quote.statut) && (
        <div className="flex gap-3">
          <a
            href={`/api/quotes/${quote.id}/contract`}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 font-semibold rounded-lg px-6 py-2.5 text-sm transition border border-indigo-500/30 inline-block"
          >
            Voir le contrat
          </a>
        </div>
      )}

      {/* Liens rapides — Facture & Travaux */}
      {(linkedInvoice || ['depot_paye', 'planifie', 'complete'].includes(quote.statut)) && (
        <div className="flex gap-3 flex-wrap">
          {linkedInvoice && (
            <Link
              href={`/dashboard/factures/${linkedInvoice.id}`}
              className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 font-semibold rounded-lg px-6 py-2.5 text-sm transition border border-amber-500/30 inline-block"
            >
              Facture {linkedInvoice.numero}
            </Link>
          )}
          {['depot_paye', 'planifie', 'complete'].includes(quote.statut) && (
            <Link
              href={`/dashboard/travaux?projet=${quote.id}`}
              className="bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 font-semibold rounded-lg px-6 py-2.5 text-sm transition border border-blue-500/30 inline-block"
            >
              Voir le projet / travaux
            </Link>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 flex-wrap">
        {(quote.statut === 'brouillon' || quote.statut === 'en_attente') && (
          <button
            onClick={handleApprove} disabled={!!action}
            className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-900 font-semibold rounded-lg px-6 py-2.5 text-sm transition"
          >
            {action === 'approve' ? 'Approbation...' : 'Approuver'}
          </button>
        )}
        {quote.statut === 'approuve' && (
          <>
            <button
              onClick={handleSend} disabled={!!action}
              className="bg-purple-500 hover:bg-purple-400 disabled:opacity-50 text-white font-semibold rounded-lg px-6 py-2.5 text-sm transition"
            >
              {action === 'send' ? 'Envoi...' : 'Envoyer par email'}
            </button>
            {quote.client_tel && (
              <button
                onClick={handleSendSMS} disabled={!!action}
                className="bg-green-500 hover:bg-green-400 disabled:opacity-50 text-white font-semibold rounded-lg px-6 py-2.5 text-sm transition"
              >
                {action === 'sms' ? 'Envoi SMS...' : 'Envoyer par SMS'}
              </button>
            )}
          </>
        )}
        {['envoye', 'contrat_signe', 'depot_paye', 'planifie'].includes(quote.statut) && quote.client_email && (
          <button
            onClick={handleSend} disabled={!!action}
            className="bg-purple-500/20 hover:bg-purple-500/30 disabled:opacity-50 text-purple-400 font-semibold rounded-lg px-6 py-2.5 text-sm transition border border-purple-500/30"
          >
            {action === 'send' ? 'Envoi...' : '📧 Renvoyer par email'}
          </button>
        )}
        {['brouillon', 'en_attente', 'envoye', 'contrat_signe', 'depot_paye', 'planifie'].includes(quote.statut) && quote.client_tel && (
          <button
            onClick={handleSendSMS} disabled={!!action}
            className="bg-green-500/20 hover:bg-green-500/30 disabled:opacity-50 text-green-400 font-semibold rounded-lg px-6 py-2.5 text-sm transition border border-green-500/30"
          >
            {action === 'sms' ? 'Envoi SMS...' : 'Renvoyer par SMS'}
          </button>
        )}
        {(quote.statut === 'brouillon' || quote.statut === 'en_attente') && (
          <button
            onClick={handleRefuse} disabled={!!action}
            className="bg-red-500/20 hover:bg-red-500/30 text-red-400 font-semibold rounded-lg px-6 py-2.5 text-sm transition border border-red-500/30"
          >
            Refuser
          </button>
        )}
      </div>
    </div>
  );
}
