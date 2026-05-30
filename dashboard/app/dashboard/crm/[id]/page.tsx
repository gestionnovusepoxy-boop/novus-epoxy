'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';

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
  statut: string;
  temperature: string;
  type: string | null;
  prospect_sent_at: string | null;
  created_at: string;
}

interface QuoteSummary {
  id: number;
  type_service: string;
  superficie: number;
  total: string;
  statut: string;
  created_at: string;
  sent_at: string | null;
  first_view_at: string | null;
  deposit_paid_at: string | null;
}

interface SmsLog {
  id: number;
  direction: string;
  from_number: string;
  to_number: string;
  message: string;
  statut: string;
  created_at: string;
}

interface EmailLog {
  id: number;
  sujet: string;
  destinataire: string;
  statut: string | null;
  created_at: string;
  direction: string | null;
}

interface SubmissionRow {
  id: number;
  created_at: string;
  statut: string;
  service: string;
  message: string;
}

interface DetailResponse {
  lead: Lead;
  quotes: QuoteSummary[];
  sms: SmsLog[];
  emails: EmailLog[];
  submissions: SubmissionRow[];
}

const SERVICE_LABELS: Record<string, string> = {
  flake: 'Flocon (Flake)', metallique: 'Métallique', couleur_unie: 'Couleur unie',
  quartz: 'Quartz', commercial: 'Commercial', antiderapant: 'Antidérapant', meulage: 'Meulage',
};

const TEMP_BADGE: Record<string, string> = {
  chaud: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  tiede: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  froid: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
};

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' });
}

function fmtMoney(v: string | number) {
  return Number(v).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' });
}

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/crm/leads/${id}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-8 text-slate-400">Chargement...</div>;
  if (error || !data) return <div className="p-8 text-red-400">{error ?? 'Lead introuvable'}</div>;

  const { lead, quotes, sms, emails, submissions } = data;
  const cleanTel = (lead.telephone ?? '').replace(/\D/g, '');

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header avec nom + actions rapides */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link href="/dashboard/crm" className="text-sm text-slate-400 hover:text-amber-400">← Retour au CRM</Link>
          <h1 className="text-3xl font-bold text-white mt-2">{lead.nom}</h1>
          <Link href={`/dashboard/crm/${lead.id}/conversations`} className="inline-block mt-2 text-sm bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold rounded-lg px-3 py-1.5 transition">
            📜 Toutes les conversations (email, SMS, chat)
          </Link>
          <div className="flex items-center gap-2 mt-2">
            <span className={`px-2 py-0.5 rounded-full text-xs border ${TEMP_BADGE[lead.temperature] ?? 'bg-slate-500/20 text-slate-300'}`}>
              {lead.temperature === 'chaud' ? '🔥 Chaud' : lead.temperature === 'tiede' ? '🟡 Tiède' : '🔵 Froid'}
            </span>
            <span className="px-2 py-0.5 rounded-full text-xs bg-slate-700 text-slate-300 border border-slate-600">
              {lead.statut}
            </span>
            <span className="text-xs text-slate-500">{lead.source}</span>
            <span className="text-xs text-slate-500">· créé {fmtDate(lead.created_at)}</span>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {cleanTel && (
            <>
              <a href={`tel:+1${cleanTel.slice(-10)}`} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-white text-sm font-medium">📞 Appeler</a>
              <a href={`sms:+1${cleanTel.slice(-10)}`} className="px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded text-white text-sm font-medium">💬 SMS</a>
            </>
          )}
          {lead.email && (
            <a href={`mailto:${lead.email}`} className="px-3 py-2 bg-purple-600 hover:bg-purple-500 rounded text-white text-sm font-medium">📧 Email</a>
          )}
          <Link href={`/dashboard/devis/nouveau?lead_id=${lead.id}`} className="px-3 py-2 bg-amber-500 hover:bg-amber-400 rounded text-slate-900 text-sm font-bold">📋 Créer devis</Link>
        </div>
      </div>

      {/* Infos lead */}
      <div className="bg-slate-800/50 rounded-lg p-5 border border-slate-700 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div><span className="text-xs text-slate-500 uppercase tracking-wide">Téléphone</span><div className="text-white">{lead.telephone ?? '—'}</div></div>
        <div><span className="text-xs text-slate-500 uppercase tracking-wide">Email</span><div className="text-white text-sm break-all">{lead.email ?? '—'}</div></div>
        <div><span className="text-xs text-slate-500 uppercase tracking-wide">Service</span><div className="text-white">{SERVICE_LABELS[lead.service ?? ''] ?? lead.service ?? '—'}</div></div>
        <div><span className="text-xs text-slate-500 uppercase tracking-wide">Superficie</span><div className="text-white">{lead.superficie ?? '—'} {lead.superficie && 'pi²'}</div></div>
        <div className="col-span-2"><span className="text-xs text-slate-500 uppercase tracking-wide">Adresse</span><div className="text-white">{lead.adresse ?? '—'}</div></div>
        <div><span className="text-xs text-slate-500 uppercase tracking-wide">Ville</span><div className="text-white">{lead.ville ?? '—'}</div></div>
        <div><span className="text-xs text-slate-500 uppercase tracking-wide">Type</span><div className="text-white">{lead.type ?? '—'}</div></div>
        {lead.notes && (
          <div className="col-span-full"><span className="text-xs text-slate-500 uppercase tracking-wide">Notes</span><div className="text-slate-300 text-sm whitespace-pre-wrap">{lead.notes}</div></div>
        )}
      </div>

      {/* Devis liés */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-white">📋 Devis liés ({quotes.length})</h2>
          <Link href={`/dashboard/devis/nouveau?lead_id=${lead.id}`} className="text-sm text-amber-400 hover:text-amber-300">+ Nouveau devis</Link>
        </div>
        {quotes.length === 0 ? (
          <div className="bg-slate-800/30 rounded p-4 text-sm text-slate-400">Aucun devis créé pour ce lead. <Link href={`/dashboard/devis/nouveau?lead_id=${lead.id}`} className="text-amber-400 hover:underline">Créer le premier</Link></div>
        ) : (
          <div className="space-y-2">
            {quotes.map(q => (
              <Link key={q.id} href={`/dashboard/devis/${q.id}`} className={`block ${q.deposit_paid_at || ['depot_paye','planifie','complete'].includes(q.statut) ? 'bg-emerald-500/10 border-emerald-500/40 hover:bg-emerald-500/15' : 'bg-slate-800/50 hover:bg-slate-800 border-slate-700'} border rounded-lg p-3 transition`}>
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <span className="text-white font-medium">Devis #{q.id}</span>
                    <span className="ml-2 text-sm text-slate-400">{SERVICE_LABELS[q.type_service] ?? q.type_service} · {q.superficie} pi²</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="font-semibold text-amber-400">{fmtMoney(q.total)}</span>
                    {(q.deposit_paid_at || ['depot_paye','planifie','complete'].includes(q.statut)) ? (
                      <span className="px-2 py-0.5 bg-emerald-500/30 text-emerald-200 border border-emerald-500/40 rounded text-xs font-bold">✅ DÉPÔT REÇU</span>
                    ) : (
                      <span className="px-2 py-0.5 bg-slate-700 rounded text-xs">{q.statut}</span>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex gap-4 text-xs text-slate-500">
                  <span>Créé: {fmtDate(q.created_at)}</span>
                  {q.sent_at && <span>Envoyé: {fmtDate(q.sent_at)}</span>}
                  {q.first_view_at && <span className="text-cyan-400">👁 Vu: {fmtDate(q.first_view_at)}</span>}
                  {q.deposit_paid_at && <span className="text-emerald-400 font-medium">💰 Dépôt: {fmtDate(q.deposit_paid_at)}</span>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* SMS history */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-3">💬 Historique SMS ({sms.length})</h2>
        {sms.length === 0 ? (
          <div className="bg-slate-800/30 rounded p-4 text-sm text-slate-400">Aucun SMS échangé avec ce lead.</div>
        ) : (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {sms.map(m => (
              <div key={m.id} className={`p-2 rounded text-sm ${m.direction === 'outbound' ? 'bg-blue-500/10 border-l-2 border-blue-500' : 'bg-emerald-500/10 border-l-2 border-emerald-500'}`}>
                <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                  <span>{m.direction === 'outbound' ? '→ Envoyé' : '← Reçu'} · {m.from_number} → {m.to_number}</span>
                  <span>{fmtDate(m.created_at)}</span>
                </div>
                <div className="text-slate-200 whitespace-pre-wrap">{m.message}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Emails history */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-3">📧 Historique emails ({emails.length})</h2>
        {emails.length === 0 ? (
          <div className="bg-slate-800/30 rounded p-4 text-sm text-slate-400">Aucun email échangé.</div>
        ) : (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {emails.map(e => (
              <div key={e.id} className="p-2 rounded bg-slate-800/30 text-sm flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-white truncate">{e.sujet}</div>
                  <div className="text-xs text-slate-500">{e.direction === 'inbound' ? '←' : '→'} {e.destinataire}</div>
                </div>
                <div className="text-xs text-slate-500 whitespace-nowrap">{fmtDate(e.created_at)}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Submissions */}
      {submissions.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-white mb-3">📝 Soumissions formulaire ({submissions.length})</h2>
          <div className="space-y-1">
            {submissions.map(s => (
              <div key={s.id} className="p-2 rounded bg-slate-800/30 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-white">#{s.id} · {s.service}</span>
                  <span className="text-xs text-slate-500">{fmtDate(s.created_at)}</span>
                </div>
                {s.message && <div className="text-xs text-slate-400 mt-1 truncate">{s.message}</div>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
