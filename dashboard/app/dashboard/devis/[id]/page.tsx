'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { fetchQuote, updateQuote, sendQuote, sendQuoteSMS, type Quote, type QuoteStatut } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { SERVICES, formatMoney, type ServiceType } from '@/lib/pricing';

const BADGE: Record<QuoteStatut, string> = {
  brouillon:  'bg-slate-500/20 text-slate-300 border-slate-500/30',
  en_attente: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  approuve:   'bg-amber-500/20 text-amber-300 border-amber-500/30',
  envoye:     'bg-purple-500/20 text-purple-300 border-purple-500/30',
  depot_paye: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  planifie:   'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  complete:   'bg-green-500/20 text-green-300 border-green-500/30',
  refuse:     'bg-red-500/20 text-red-300 border-red-500/30',
};

const LABEL: Record<QuoteStatut, string> = {
  brouillon:  'Brouillon',
  en_attente: 'En attente',
  approuve:   'Approuve',
  envoye:     'Envoye',
  depot_paye: 'Depot paye',
  planifie:   'Planifie',
  complete:   'Complete',
  refuse:     'Refuse',
};

export default function DevisDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [quote, setQuote]     = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction]   = useState('');
  const [error, setError]     = useState('');

  useEffect(() => {
    fetchQuote(parseInt(id)).then(q => { setQuote(q); setLoading(false); }).catch(() => setLoading(false));
  }, [id]);

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
      await sendQuote(quote.id);
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

  if (loading) return <div className="p-6 text-slate-400">Chargement...</div>;
  if (!quote) return <div className="p-6 text-red-400">Devis introuvable</div>;

  const service = SERVICES[quote.type_service as ServiceType];

  return (
    <div className="p-6 max-w-3xl space-y-6">
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

      {/* Client */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
        <h3 className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-4">Client</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-slate-500">Nom</p>
            <p className="text-white font-medium">{quote.client_nom}</p>
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

      {/* Detail projet */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
        <h3 className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-4">Projet</h3>
        <div className="grid grid-cols-2 gap-4 text-sm mb-4">
          <div>
            <p className="text-slate-500">Service</p>
            <p className="text-white font-medium">{service.label}</p>
          </div>
          <div>
            <p className="text-slate-500">Superficie</p>
            <p className="text-white">{quote.superficie} pi²</p>
          </div>
          {quote.etat_plancher && (
            <div className="col-span-2">
              <p className="text-slate-500">Etat du plancher</p>
              <p className="text-white">{quote.etat_plancher}</p>
            </div>
          )}
          {quote.notes && (
            <div className="col-span-2">
              <p className="text-slate-500">Notes</p>
              <p className="text-white">{quote.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Prix */}
      <div className="bg-slate-800 border border-amber-500/30 rounded-xl p-6">
        <h3 className="text-amber-400 text-xs font-medium uppercase tracking-wider mb-4">Prix</h3>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between text-slate-300">
            <span>{service.label} x {quote.superficie} pi² @ {formatMoney(Number(quote.prix_pied_carre))}/pi²</span>
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
          {quote.paid_at && (
            <div className="flex justify-between">
              <span className="text-slate-400">Depot paye le</span>
              <span className="text-white">{formatDate(quote.paid_at)}</span>
            </div>
          )}
        </div>
      </div>

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
        {['brouillon', 'en_attente', 'envoye', 'depot_paye', 'planifie'].includes(quote.statut) && quote.client_tel && (
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
