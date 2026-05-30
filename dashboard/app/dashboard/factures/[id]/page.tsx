'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatDate } from '@/lib/utils';
import { SERVICES, formatMoney, type ServiceType } from '@/lib/pricing';

type InvoiceStatut = 'brouillon' | 'envoyee' | 'depot_recu' | 'travaux_en_cours' | 'completee' | 'annulee';

const BADGE: Record<InvoiceStatut, string> = {
  brouillon:        'bg-slate-500/20 text-slate-300 border-slate-500/30',
  envoyee:          'bg-blue-500/20 text-blue-300 border-blue-500/30',
  depot_recu:       'bg-amber-500/20 text-amber-300 border-amber-500/30',
  travaux_en_cours: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  completee:        'bg-green-500/20 text-green-300 border-green-500/30',
  annulee:          'bg-red-500/20 text-red-300 border-red-500/30',
};

const LABEL: Record<InvoiceStatut, string> = {
  brouillon:        'Brouillon',
  envoyee:          'Envoyee',
  depot_recu:       'Depot recu',
  travaux_en_cours: 'Travaux en cours',
  completee:        'Completee',
  annulee:          'Annulee',
};

// Stripe/carte retiré (feedback_stripe_never) — Interac, chèque, comptant seulement
const METHODES = ['virement', 'cheque', 'comptant', 'autre'] as const;
const METHODE_LABEL: Record<string, string> = {
  virement: 'Virement Interac', cheque: 'Chèque', comptant: 'Comptant', autre: 'Autre',
  carte: 'Carte (legacy)', // garde le label au cas où des anciennes factures aient 'carte' stocké
};

interface Invoice {
  id: number; numero: string; quote_id: number; client_id: number;
  client_nom: string; client_email: string; client_tel: string | null; client_adresse: string | null;
  type_service: string; superficie: number; prix_pied_carre: number;
  rabais_pct: number; rabais_montant: number;
  sous_total: number; tps: number; tvq: number; total: number;
  depot_montant: number; depot_paye: boolean; depot_paye_at: string | null; depot_methode: string | null;
  final_montant: number; final_paye: boolean; final_paye_at: string | null; final_methode: string | null;
  statut: InvoiceStatut; notes: string | null;
  date_emission: string; date_echeance: string | null;
  created_at: string; updated_at: string;
  contrat_signe_at: string | null; contrat_signature_nom: string | null; quote_token: string | null;
  payments: { id: number; type: string; montant: number; methode: string; reference: string | null; paid_at: string }[];
}

export default function FactureDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [inv, setInv]           = useState<Invoice | null>(null);
  const [loading, setLoading]   = useState(true);
  const [action, setAction]     = useState('');
  const [error, setError]       = useState('');
  const [toast, setToast]       = useState('');
  const [showPayment, setShowPayment] = useState<'depot' | 'final' | null>(null);
  const [payMethode, setPayMethode]   = useState('virement');
  const [payRef, setPayRef]           = useState('');

  useEffect(() => {
    fetch(`/api/invoices/${id}`).then(r => r.json()).then(data => { setInv(data); setLoading(false); }).catch(() => setLoading(false));
  }, [id]);

  async function reload() {
    const data = await fetch(`/api/invoices/${id}`).then(r => r.json());
    setInv(data);
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  }

  async function handleSend() {
    setAction('send'); setError('');
    try {
      const res = await fetch(`/api/invoices/${id}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      if (!res.ok) { const j = await res.json(); setError(j.error); }
      else { await reload(); showToast('Email envoyé ✓'); }
    } catch { setError('Erreur envoi'); }
    setAction('');
  }

  async function handleSendSMS() {
    setAction('sms'); setError('');
    try {
      const res = await fetch(`/api/invoices/${id}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sms_only: true }) });
      if (!res.ok) { const j = await res.json(); setError(j.error); }
      else { showToast('SMS envoyé ✓'); }
    } catch { setError('Erreur SMS'); }
    setAction('');
  }

  async function handlePayment(type: 'depot' | 'final') {
    if (!inv) return;
    setAction('pay'); setError('');
    const montant = type === 'depot' ? inv.depot_montant : inv.final_montant;
    try {
      const res = await fetch(`/api/invoices/${id}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, montant, methode: payMethode, reference: payRef || null }),
      });
      if (!res.ok) { const j = await res.json(); setError(j.error); }
      else { await reload(); setShowPayment(null); setPayRef(''); }
    } catch { setError('Erreur paiement'); }
    setAction('');
  }

  async function handlePartialPayment() {
    if (!inv) return;
    const raw = window.prompt('Montant du paiement partiel reçu (ex: 10000)?', '');
    if (!raw) return;
    const montant = parseFloat(raw.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(montant) || montant <= 0) { setError('Montant invalide'); return; }
    const methode = window.prompt('Méthode? (virement / cheque / comptant / autre)', 'virement') ?? 'virement';
    setAction('pay'); setError('');
    try {
      const res = await fetch(`/api/invoices/${id}/payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'partial', montant, methode: methode.trim() || 'virement' }),
      });
      if (!res.ok) { setError((await res.json()).error || 'Erreur'); }
      else {
        const j = await res.json();
        showToast(`Partiel de ${formatMoney(j.payment_recorded)} enregistré · Reste ${formatMoney(j.remaining_after)}`);
        await reload();
      }
    } catch { setError('Erreur paiement partiel'); }
    setAction('');
  }

  async function handleMarkFullyPaid() {
    if (!inv) return;
    if (!confirm(`Confirmer le paiement complet de ${formatMoney(Number(inv.total))} (depot + solde, methode: ${METHODE_LABEL[payMethode]}) ?`)) return;
    setAction('paycomplete'); setError('');
    try {
      if (!inv.depot_paye) {
        const r1 = await fetch(`/api/invoices/${id}/payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'depot', montant: inv.depot_montant, methode: payMethode, reference: payRef || null }),
        });
        if (!r1.ok) { setError((await r1.json()).error || 'Erreur dépôt'); setAction(''); return; }
      }
      if (!inv.final_paye) {
        const r2 = await fetch(`/api/invoices/${id}/payment`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'final', montant: inv.final_montant, methode: payMethode, reference: payRef || null }),
        });
        if (!r2.ok) { setError((await r2.json()).error || 'Erreur solde'); setAction(''); return; }
      }
      // Force status completee
      await fetch(`/api/invoices/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statut: 'completee' }),
      });
      await reload();
      showToast(`Facture marquée payée complet ✅ — ${formatMoney(Number(inv.total))}`);
    } catch { setError('Erreur lors de la confirmation'); }
    setAction('');
  }

  async function handleStatusChange(statut: InvoiceStatut) {
    setAction('status');
    try {
      await fetch(`/api/invoices/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statut }),
      });
      await reload();
    } catch { setError('Erreur'); }
    setAction('');
  }

  if (loading) return <div className="p-6 text-slate-400">Chargement...</div>;
  if (!inv) return <div className="p-6 text-red-400">Facture introuvable</div>;

  const service = SERVICES[inv.type_service as ServiceType];

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <button onClick={() => router.push('/dashboard/factures')} className="text-slate-400 hover:text-white text-sm mb-2 block transition">
            &larr; Retour aux factures
          </button>
          <h2 className="text-2xl font-bold text-white">Facture {inv.numero}</h2>
        </div>
        <span className={`text-sm font-medium px-3 py-1.5 rounded border ${BADGE[inv.statut]}`}>
          {LABEL[inv.statut]}
        </span>
      </div>

      {toast && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-2">
          <p className="text-green-400 text-sm font-medium">{toast}</p>
        </div>
      )}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* PAYÉ COMPLET — gros banner visible immédiatement */}
      {inv.depot_paye && inv.final_paye && (
        <div className="bg-gradient-to-r from-emerald-500/20 to-green-500/20 border-2 border-emerald-500/60 rounded-xl p-4 sm:p-5 flex items-center gap-4 shadow-lg shadow-emerald-500/10">
          <div className="text-4xl sm:text-5xl">✅</div>
          <div className="flex-1">
            <p className="text-emerald-300 text-xs font-bold uppercase tracking-wider">Payé complet</p>
            <p className="text-white text-lg sm:text-xl font-bold">{formatMoney(Number(inv.total))} encaissé</p>
            <p className="text-emerald-400/80 text-xs mt-0.5">
              Dépôt {inv.depot_paye_at ? formatDate(inv.depot_paye_at) : ''} · Solde {inv.final_paye_at ? formatDate(inv.final_paye_at) : ''}
            </p>
          </div>
        </div>
      )}

      {/* Bouton rapide — marquer payé complet en 1 clic */}
      {!(inv.depot_paye && inv.final_paye) && inv.statut !== 'annulee' && (
        <div className="bg-emerald-500/10 border border-emerald-500/40 rounded-xl p-4 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[200px]">
            <p className="text-emerald-300 text-xs font-bold uppercase tracking-wider">Tout est payé ?</p>
            <p className="text-white text-sm">Un seul clic pour enregistrer dépôt + solde et passer en complétée.</p>
          </div>
          <select value={payMethode} onChange={e => setPayMethode(e.target.value)}
            className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500">
            {METHODES.map(m => <option key={m} value={m}>{METHODE_LABEL[m]}</option>)}
          </select>
          <button
            onClick={handleMarkFullyPaid}
            disabled={!!action}
            className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-bold rounded-lg px-5 py-2.5 text-sm transition shadow-lg shadow-emerald-500/30"
          >
            {action === 'paycomplete' ? 'Enregistrement…' : `✅ Payé complet — ${formatMoney(Number(inv.total))}`}
          </button>
        </div>
      )}

      {/* Client */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
        <h3 className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-4">Client</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><p className="text-slate-500">Nom</p><Link href={`/dashboard/crm?search=${encodeURIComponent(inv.client_nom)}`} className="text-amber-400 hover:text-amber-300 font-medium transition hover:underline">{inv.client_nom}</Link></div>
          <div><p className="text-slate-500">Courriel</p><p className="text-white">{inv.client_email}</p></div>
          <div><p className="text-slate-500">Telephone</p><p className="text-white">{inv.client_tel ?? '—'}</p></div>
          <div><p className="text-slate-500">Adresse</p><p className="text-white">{inv.client_adresse ?? '—'}</p></div>
        </div>
      </div>

      {/* Prix */}
      <div className="bg-slate-800 border border-amber-500/30 rounded-xl p-6">
        <h3 className="text-amber-400 text-xs font-medium uppercase tracking-wider mb-4">Detail</h3>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between text-slate-300">
            <span>{service.label} x {inv.superficie} pi² @ {formatMoney(Number(inv.prix_pied_carre))}/pi²</span>
            <span>{formatMoney(Number(inv.prix_pied_carre) * Number(inv.superficie))}</span>
          </div>
          {Number(inv.rabais_pct) > 0 && (
            <div className="flex justify-between text-green-400 font-semibold">
              <span>Rabais {inv.rabais_pct}%</span>
              <span>-{formatMoney(Number(inv.rabais_montant))}</span>
            </div>
          )}
          <div className="flex justify-between text-slate-300">
            <span>Sous-total</span>
            <span>{formatMoney(Number(inv.sous_total))}</span>
          </div>
          <div className="flex justify-between text-slate-400"><span>TPS (5%)</span><span>{formatMoney(Number(inv.tps))}</span></div>
          <div className="flex justify-between text-slate-400"><span>TVQ (9,975%)</span><span>{formatMoney(Number(inv.tvq))}</span></div>
          <div className="flex justify-between text-white font-bold text-lg pt-3 border-t border-slate-700">
            <span>Total</span><span>{formatMoney(Number(inv.total))}</span>
          </div>
        </div>
      </div>

      {/* Devis + Contrat + Projet */}
      {inv.quote_id && (
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-xl p-5 border bg-purple-500/5 border-purple-500/30">
            <h3 className="text-xs font-medium uppercase tracking-wider mb-2 text-slate-400">Devis</h3>
            <p className="text-purple-400 font-semibold text-sm">Devis #{inv.quote_id}</p>
            <p className="text-slate-500 text-xs mb-3">Soumission originale</p>
            <Link
              href={`/dashboard/devis/${inv.quote_id}`}
              className="inline-block bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
            >
              Voir le devis
            </Link>
          </div>
          <div className="rounded-xl p-5 border bg-green-500/5 border-green-500/30">
            <h3 className="text-xs font-medium uppercase tracking-wider mb-2 text-slate-400">Contrat</h3>
            <p className="text-green-400 font-semibold text-sm">Signé par {inv.contrat_signature_nom ?? inv.client_nom}</p>
            {inv.contrat_signe_at && <p className="text-slate-500 text-xs mb-3">{formatDate(inv.contrat_signe_at)}</p>}
            <a
              href={`/api/quotes/${inv.quote_id}/contract`}
              target="_blank"
              className="inline-block bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
            >
              Voir le contrat
            </a>
          </div>
          <div className="rounded-xl p-5 border bg-blue-500/5 border-blue-500/30">
            <h3 className="text-xs font-medium uppercase tracking-wider mb-2 text-slate-400">Projet</h3>
            <p className="text-blue-400 font-semibold text-sm">Projet #{inv.quote_id}</p>
            <p className="text-slate-500 text-xs mb-3">Heures, dépenses, photos, profit</p>
            <Link
              href={`/dashboard/travaux?projet=${inv.quote_id}`}
              className="inline-block bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
            >
              Voir le projet
            </Link>
          </div>
        </div>
      )}

      {/* Statut "Payé en entier" */}
      {inv.final_paye && (
        <div className="rounded-xl p-4 border-2 border-green-500 bg-green-500/10 text-center">
          <p className="text-green-400 text-lg font-bold">✓ Facture payée en entier — {formatMoney(Number(inv.total))}</p>
        </div>
      )}

      {/* Bouton paiement partiel — pour encaisser n'importe quel montant (ex: 10 000$ reçu) sans encore fermer la facture */}
      {!inv.final_paye && (
        <button
          onClick={handlePartialPayment}
          disabled={!!action}
          className="bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white font-medium rounded-lg px-4 py-2 text-sm transition"
        >
          + Paiement partiel reçu
        </button>
      )}

      {/* Paiements */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className={`rounded-xl p-6 border ${inv.depot_paye ? 'bg-green-500/5 border-green-500/30' : 'bg-slate-800 border-slate-700'}`}>
          <h3 className="text-xs font-medium uppercase tracking-wider mb-3 text-slate-400">Depot 30%</h3>
          <p className="text-2xl font-bold text-white">{formatMoney(Number(inv.depot_montant))}</p>
          {inv.depot_paye ? (
            <div className="mt-2">
              <span className="text-green-400 text-sm font-medium">Paye</span>
              <p className="text-slate-400 text-xs">{inv.depot_paye_at ? formatDate(inv.depot_paye_at) : ''} — {METHODE_LABEL[inv.depot_methode ?? ''] ?? ''}</p>
            </div>
          ) : (
            <button
              onClick={() => setShowPayment('depot')}
              className="mt-3 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold rounded-lg px-4 py-2 text-sm transition"
            >
              Enregistrer depot
            </button>
          )}
        </div>

        <div className={`rounded-xl p-6 border ${inv.final_paye ? 'bg-green-500/5 border-green-500/30' : 'bg-slate-800 border-slate-700'}`}>
          <h3 className="text-xs font-medium uppercase tracking-wider mb-3 text-slate-400">Solde 70%</h3>
          <p className="text-2xl font-bold text-white">{formatMoney(Number(inv.final_montant))}</p>
          {inv.final_paye ? (
            <div className="mt-2">
              <span className="text-green-400 text-sm font-medium">Paye</span>
              <p className="text-slate-400 text-xs">{inv.final_paye_at ? formatDate(inv.final_paye_at) : ''} — {METHODE_LABEL[inv.final_methode ?? ''] ?? ''}</p>
            </div>
          ) : (
            <button
              onClick={() => setShowPayment('final')}
              disabled={!inv.depot_paye}
              className="mt-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-slate-900 font-semibold rounded-lg px-4 py-2 text-sm transition"
            >
              Enregistrer solde
            </button>
          )}
        </div>
      </div>

      {/* Payment Modal */}
      {showPayment && (
        <div className="bg-slate-800 border border-amber-500/30 rounded-xl p-6">
          <h3 className="text-white font-semibold mb-4">
            Enregistrer {showPayment === 'depot' ? 'le depot (30%)' : 'le solde (70%)'}
          </h3>
          <div className="space-y-3">
            <div>
              <label className="block text-sm text-slate-400 mb-1">Methode de paiement</label>
              <select value={payMethode} onChange={e => setPayMethode(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500">
                {METHODES.map(m => <option key={m} value={m}>{METHODE_LABEL[m]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400 mb-1">Reference (optionnel)</label>
              <input value={payRef} onChange={e => setPayRef(e.target.value)}
                placeholder="No. cheque, ref. virement..."
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500" />
            </div>
            <div className="flex gap-3">
              <button onClick={() => handlePayment(showPayment)} disabled={!!action}
                className="bg-green-500 hover:bg-green-400 disabled:opacity-50 text-white font-semibold rounded-lg px-6 py-2.5 text-sm transition">
                {action === 'pay' ? 'Enregistrement...' : `Confirmer ${formatMoney(Number(showPayment === 'depot' ? inv.depot_montant : inv.final_montant))}`}
              </button>
              <button onClick={() => setShowPayment(null)}
                className="bg-slate-700 hover:bg-slate-600 text-white rounded-lg px-4 py-2.5 text-sm transition">
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Historique paiements */}
      {inv.payments && inv.payments.length > 0 && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
          <h3 className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-4">Historique des paiements</h3>
          <div className="space-y-2">
            {inv.payments.map((p: { id: number; type: string; montant: number; methode: string; reference: string | null; paid_at: string }) => (
              <div key={p.id} className="flex justify-between items-center text-sm border-b border-slate-700 pb-2">
                <div>
                  <span className="text-white font-medium">{p.type === 'depot' ? 'Depot' : 'Solde'}</span>
                  <span className="text-slate-400 ml-2">{METHODE_LABEL[p.methode]}</span>
                  {p.reference && <span className="text-slate-500 ml-2">({p.reference})</span>}
                </div>
                <div className="text-right">
                  <span className="text-green-400 font-medium">{formatMoney(Number(p.montant))}</span>
                  <p className="text-slate-500 text-xs">{formatDate(p.paid_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
        <h3 className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-4">Historique</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-slate-400">Emise le</span><span className="text-white">{formatDate(inv.date_emission)}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Creee le</span><span className="text-white">{formatDate(inv.created_at)}</span></div>
          {inv.depot_paye_at && <div className="flex justify-between"><span className="text-slate-400">Depot recu le</span><span className="text-white">{formatDate(inv.depot_paye_at)}</span></div>}
          {inv.final_paye_at && <div className="flex justify-between"><span className="text-slate-400">Solde recu le</span><span className="text-white">{formatDate(inv.final_paye_at)}</span></div>}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 flex-wrap">
        <button onClick={handleSend} disabled={!!action}
          className="bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white font-semibold rounded-lg px-6 py-2.5 text-sm transition">
          {action === 'send' ? 'Envoi...' : inv.statut === 'brouillon' ? 'Envoyer par email' : 'Renvoyer par email'}
        </button>
        {inv.client_tel && (
          <button onClick={handleSendSMS} disabled={!!action}
            className="bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-semibold rounded-lg px-6 py-2.5 text-sm transition">
            {action === 'sms' ? 'Envoi SMS...' : 'Envoyer par SMS'}
          </button>
        )}
        {inv.statut === 'depot_recu' && (
          <button onClick={() => handleStatusChange('travaux_en_cours')} disabled={!!action}
            className="bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-white font-semibold rounded-lg px-6 py-2.5 text-sm transition">
            Demarrer les travaux
          </button>
        )}
        <a href={`/api/invoices/${inv.id}/pdf`} target="_blank" rel="noopener noreferrer"
          className="bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-lg px-6 py-2.5 text-sm transition inline-block">
          Telecharger PDF
        </a>
        {!['completee', 'annulee'].includes(inv.statut) && (
          <button onClick={() => handleStatusChange('annulee')} disabled={!!action}
            className="bg-red-500/20 hover:bg-red-500/30 text-red-400 font-semibold rounded-lg px-6 py-2.5 text-sm transition border border-red-500/30">
            Annuler
          </button>
        )}
      </div>
    </div>
  );
}
