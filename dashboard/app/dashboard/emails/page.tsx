'use client';

import { useState, useCallback } from 'react';
import { PollingProvider } from '@/components/polling-provider';
import { fetchEmails, type EmailLog } from '@/lib/api';
import { formatDate } from '@/lib/utils';

const BADGE: Record<EmailLog['statut'], string> = {
  sent:        'bg-slate-500/20 text-slate-300 border-slate-500/30',
  delivered:   'bg-blue-500/20 text-blue-300 border-blue-500/30',
  opened:      'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  clicked:     'bg-amber-500/20 text-amber-300 border-amber-500/30',
  bounced:     'bg-red-500/20 text-red-300 border-red-500/30',
  complained:  'bg-rose-500/20 text-rose-300 border-rose-500/30',
};

const LABEL: Record<EmailLog['statut'], string> = {
  sent:       'Envoyé',
  delivered:  'Livré',
  opened:     'Ouvert',
  clicked:    'Cliqué',
  bounced:    'Bounce',
  complained: 'Spam',
};

function PageContent() {
  const [data, setData]   = useState<EmailLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage]   = useState(1);

  const load = useCallback(async () => {
    const res = await fetchEmails({ page, limit: 25 });
    setData(res.data);
    setTotal(res.total);
  }, [page]);

  return (
    <PollingProvider onRefresh={load}>
      <div className="p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white">Emails</h2>
          <span className="text-slate-400 text-sm">{total} au total</span>
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-900/50">
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Destinataire</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Sujet</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Statut</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Ouvert le</th>
                <th className="text-left px-4 py-3 text-slate-400 text-xs font-medium uppercase tracking-wider">Envoyé le</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr><td colSpan={5} className="text-center py-8 text-slate-500 text-sm">Aucun email</td></tr>
              )}
              {data.map(e => (
                <tr key={e.id} className="border-b border-slate-700">
                  <td className="px-4 py-3 text-white text-sm">{e.destinataire}</td>
                  <td className="px-4 py-3 text-slate-300 text-sm max-w-xs truncate">{e.sujet ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded border ${BADGE[e.statut]}`}>
                      {LABEL[e.statut]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{e.opened_at ? formatDate(e.opened_at) : '—'}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{formatDate(e.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {total > 25 && (
          <div className="flex gap-2 justify-end">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-3 py-1.5 bg-slate-700 rounded text-sm text-white disabled:opacity-40">← Précédent</button>
            <span className="px-3 py-1.5 text-slate-400 text-sm">Page {page} / {Math.ceil(total / 25)}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil(total / 25)}
              className="px-3 py-1.5 bg-slate-700 rounded text-sm text-white disabled:opacity-40">Suivant →</button>
          </div>
        )}
      </div>
    </PollingProvider>
  );
}

export default function EmailsPage() {
  return <PageContent />;
}
