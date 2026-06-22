'use client';

import { useState, useCallback } from 'react';
import { PollingProvider } from '@/components/polling-provider';
import { fetchSubmissions, updateSubmissionStatus, type Submission } from '@/lib/api';
import { formatDate } from '@/lib/utils';

const STATUTS = ['nouveau', 'lu', 'en_traitement', 'ferme'] as const;

const BADGE: Record<Submission['statut'], string> = {
  nouveau:        'bg-blue-500/20 text-blue-300 border-blue-500/30',
  lu:             'bg-slate-500/20 text-slate-300 border-slate-500/30',
  en_traitement:  'bg-amber-500/20 text-amber-300 border-amber-500/30',
  ferme:          'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
};

const LABEL: Record<Submission['statut'], string> = {
  nouveau:        'Nouveau',
  lu:             'Lu',
  en_traitement:  'En traitement',
  ferme:          'Fermé',
};

function DetailPanel({ s, onClose, onUpdate }: { s: Submission; onClose: () => void; onUpdate: () => void }) {
  const [loading, setLoading] = useState(false);
  const [smsOpen, setSmsOpen]       = useState(false);
  const [smsText, setSmsText]       = useState('');
  const [smsSending, setSmsSending] = useState(false);
  const [smsStatus, setSmsStatus]   = useState<string | null>(null);

  const tel = (s.telephone || '').replace(/[^0-9+]/g, '');

  async function handleStatut(statut: Submission['statut']) {
    setLoading(true);
    await updateSubmissionStatus(s.id, statut);
    onUpdate();
    setLoading(false);
  }

  async function sendSms() {
    if (!smsText.trim() || smsSending || !s.telephone) return;
    setSmsSending(true); setSmsStatus(null);
    try {
      const res = await fetch('/api/sms/logs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: s.telephone, message: smsText.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) { setSmsStatus('✅ Texto envoyé'); setSmsText(''); setSmsOpen(false); }
      else setSmsStatus('⚠️ ' + (data.deliveryError || data.error || 'Échec'));
    } catch { setSmsStatus('⚠️ Erreur de connexion'); }
    setSmsSending(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full max-w-lg bg-slate-800 border-l border-slate-700 h-full overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-slate-800 border-b border-slate-700 px-6 py-4 flex items-center justify-between z-10">
          <h3 className="text-lg font-bold text-white">Soumission #{s.id}</h3>
          <button onClick={onClose} className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white text-xl transition">&times;</button>
        </div>

        <div className="p-6 space-y-5">
          {/* Client info */}
          <div className="space-y-3">
            <h4 className="text-xs font-medium uppercase tracking-wider text-slate-500">Client</h4>
            <div className="bg-slate-900 rounded-lg p-4 space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-400 text-sm">Nom</span>
                <span className="text-white text-sm font-medium">{s.nom}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400 text-sm">Email</span>
                <a href={`mailto:${s.email}`} className="text-amber-400 text-sm hover:underline">{s.email}</a>
              </div>
              {s.telephone && (
                <div className="flex justify-between">
                  <span className="text-slate-400 text-sm">Téléphone</span>
                  <a href={`tel:${s.telephone}`} className="text-amber-400 text-sm hover:underline">{s.telephone}</a>
                </div>
              )}
              {s.ville && (
                <div className="flex justify-between">
                  <span className="text-slate-400 text-sm">Ville</span>
                  <span className="text-white text-sm">{s.ville}</span>
                </div>
              )}
              {s.adresse && (
                <div className="flex justify-between">
                  <span className="text-slate-400 text-sm">Adresse</span>
                  <span className="text-white text-sm text-right max-w-[60%]">{s.adresse}</span>
                </div>
              )}
            </div>
          </div>

          {/* Projet */}
          <div className="space-y-3">
            <h4 className="text-xs font-medium uppercase tracking-wider text-slate-500">Projet</h4>
            <div className="bg-slate-900 rounded-lg p-4 space-y-2">
              {s.service && (
                <div className="flex justify-between">
                  <span className="text-slate-400 text-sm">Service</span>
                  <span className="text-white text-sm">{s.service}</span>
                </div>
              )}
              {s.type_projet && (
                <div className="flex justify-between">
                  <span className="text-slate-400 text-sm">Type de projet</span>
                  <span className="text-white text-sm">{s.type_projet}</span>
                </div>
              )}
              {s.surface_estimee && (
                <div className="flex justify-between">
                  <span className="text-slate-400 text-sm">Surface estimée</span>
                  <span className="text-white text-sm">{s.surface_estimee} pi²</span>
                </div>
              )}
            </div>
          </div>

          {/* Message */}
          {s.message && (
            <div className="space-y-3">
              <h4 className="text-xs font-medium uppercase tracking-wider text-slate-500">Message</h4>
              <div className="bg-slate-900 rounded-lg p-4">
                <p className="text-slate-300 text-sm whitespace-pre-wrap">{s.message}</p>
              </div>
            </div>
          )}

          {/* Statut */}
          <div className="space-y-3">
            <h4 className="text-xs font-medium uppercase tracking-wider text-slate-500">Statut</h4>
            <select
              value={s.statut}
              disabled={loading}
              onChange={e => handleStatut(e.target.value as Submission['statut'])}
              className={`w-full text-sm font-medium px-3 py-2 rounded-lg border bg-transparent cursor-pointer ${BADGE[s.statut]}`}
            >
              {STATUTS.map(st => (
                <option key={st} value={st} className="bg-slate-800 text-white">
                  {LABEL[st]}
                </option>
              ))}
            </select>
          </div>

          {/* Date */}
          <div className="text-slate-500 text-xs">
            Reçue le {formatDate(s.created_at)}
          </div>

          {/* Actions */}
          <div className="space-y-2 pt-2">
            {/* Contact rapide */}
            {s.telephone && (
              <div className="flex gap-2">
                <a
                  href={`tel:${tel}`}
                  className="flex-1 text-center bg-green-600 hover:bg-green-500 text-white font-semibold py-3 rounded-lg transition"
                >
                  Appeler
                </a>
                <button
                  onClick={() => { setSmsOpen(o => !o); setSmsStatus(null); }}
                  className="flex-1 text-center bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 rounded-lg transition"
                >
                  Texter
                </button>
              </div>
            )}
            {smsOpen && s.telephone && (
              <div className="flex gap-2 items-start pt-1">
                <input
                  value={smsText}
                  onChange={e => setSmsText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') sendSms(); }}
                  placeholder="Texto au client…"
                  className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
                <button
                  onClick={sendSms}
                  disabled={!smsText.trim() || smsSending}
                  className="bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg px-4 py-2 text-sm transition disabled:opacity-50"
                >
                  {smsSending ? '…' : 'Envoyer'}
                </button>
              </div>
            )}
            {smsStatus && <div className="text-sm text-slate-300 pb-1">{smsStatus}</div>}

            <a
              href={`/dashboard/devis?from_submission=${s.id}&nom=${encodeURIComponent(s.nom)}&email=${encodeURIComponent(s.email)}&tel=${encodeURIComponent(s.telephone || '')}&service=${encodeURIComponent(s.service || '')}&surface=${encodeURIComponent(s.surface_estimee || '')}&adresse=${encodeURIComponent(s.adresse || '')}`}
              className="block w-full text-center bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold py-3 rounded-lg transition"
            >
              Créer un devis
            </a>
            <button
              onClick={async () => {
                if (!confirm(`Supprimer la soumission de ${s.nom} ?`)) return;
                await fetch(`/api/submissions?id=${s.id}`, { method: 'DELETE' });
                onClose();
                onUpdate();
              }}
              className="block w-full text-center bg-red-500/10 hover:bg-red-500/20 text-red-400 font-semibold py-3 rounded-lg transition border border-red-500/20"
            >
              Supprimer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SubmissionRow({ s, onUpdate, onClick }: { s: Submission; onUpdate: () => void; onClick: () => void }) {
  const [loading, setLoading] = useState(false);

  async function handleStatut(e: React.ChangeEvent<HTMLSelectElement>) {
    e.stopPropagation();
    setLoading(true);
    await updateSubmissionStatus(s.id, e.target.value as Submission['statut']);
    onUpdate();
    setLoading(false);
  }

  return (
    <tr className="border-b border-slate-700 hover:bg-slate-700/50 transition cursor-pointer" onClick={onClick}>
      <td className="px-4 py-3">
        <p className="text-white text-sm font-medium">{s.nom}</p>
        <p className="text-slate-400 text-xs">{s.email}</p>
      </td>
      <td className="px-4 py-3 text-slate-300 text-sm">{s.telephone ?? '—'}</td>
      <td className="px-4 py-3 text-slate-300 text-sm">{s.service ?? '—'}</td>
      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
        <select
          value={s.statut}
          disabled={loading}
          onChange={handleStatut}
          className={`text-xs font-medium px-2 py-1 rounded border bg-transparent cursor-pointer ${BADGE[s.statut]}`}
        >
          {STATUTS.map(st => (
            <option key={st} value={st} className="bg-slate-800 text-white">
              {LABEL[st]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{formatDate(s.created_at)}</td>
      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
        <button
          onClick={async () => {
            if (!confirm(`Supprimer la soumission de ${s.nom} ?`)) return;
            await fetch(`/api/submissions?id=${s.id}`, { method: 'DELETE' });
            onUpdate();
          }}
          className="text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition p-1.5 rounded"
          title="Supprimer"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        </button>
      </td>
    </tr>
  );
}

function PageContent() {
  const [data, setData]       = useState<Submission[]>([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [statut, setStatut]   = useState('');
  const [search, setSearch]   = useState('');
  const [selected, setSelected] = useState<Submission | null>(null);

  const load = useCallback(async () => {
    const res = await fetchSubmissions({ page, limit: 25, statut: statut || undefined, search: search || undefined });
    setData(res.data);
    setTotal(res.total);
    // Update selected if still open
    if (selected) {
      const updated = res.data.find(s => s.id === selected.id);
      if (updated) setSelected(updated);
    }
  }, [page, statut, search, selected]);

  return (
    <PollingProvider onRefresh={load}>
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">Soumissions</h2>
          <span className="text-slate-400 text-sm">{total} au total</span>
        </div>

        {/* Filtres */}
        <div className="flex gap-3 flex-wrap">
          <input
            type="text"
            placeholder="Rechercher nom ou email…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 w-64"
          />
          <select
            value={statut}
            onChange={e => { setStatut(e.target.value); setPage(1); }}
            className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
          >
            <option value="">Tous les statuts</option>
            {STATUTS.map(st => <option key={st} value={st}>{LABEL[st]}</option>)}
          </select>
        </div>

        {/* Table */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-900/50">
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Client</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Téléphone</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Service</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Statut</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Date</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-slate-500 text-sm">Aucune soumission</td></tr>
              )}
              {data.map(s => (
                <SubmissionRow key={s.id} s={s} onUpdate={load} onClick={() => setSelected(s)} />
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > 25 && (
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 bg-slate-700 rounded text-sm text-white disabled:opacity-40"
            >
              ← Précédent
            </button>
            <span className="px-3 py-1.5 text-slate-400 text-sm">
              Page {page} / {Math.ceil(total / 25)}
            </span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page >= Math.ceil(total / 25)}
              className="px-3 py-1.5 bg-slate-700 rounded text-sm text-white disabled:opacity-40"
            >
              Suivant →
            </button>
          </div>
        )}

        {/* Detail panel */}
        {selected && (
          <DetailPanel s={selected} onClose={() => setSelected(null)} onUpdate={load} />
        )}
      </div>
    </PollingProvider>
  );
}

export default function SoumissionsPage() {
  return <PageContent />;
}
