'use client';

import { useState } from 'react';

interface Booking {
  id: number;
  jour1_date: string;
  jour1_slot: string;
  jour2_date: string;
  jour2_slot: string;
  statut: string;
  client_nom: string;
  client_adresse: string | null;
  client_tel: string | null;
  client_email: string | null;
  type_service: string;
  superficie: number;
  total: number;
  quote_id: number;
}

function formatDate(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' });
}

function formatMoney(n: number) {
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(n);
}

export default function CalendrierClient({ bookings, calendarToken }: { bookings: Booking[]; calendarToken: string }) {
  const [view, setView] = useState<'list' | 'week'>('list');
  const [showSync, setShowSync] = useState(false);

  const today = new Date().toISOString().split('T')[0];

  // Build day map for events
  const dayMap = new Map<string, { type: 'jour1' | 'jour2'; slot: string; booking: Booking }[]>();
  for (const b of bookings) {
    if (!dayMap.has(b.jour1_date)) dayMap.set(b.jour1_date, []);
    dayMap.get(b.jour1_date)!.push({ type: 'jour1', slot: b.jour1_slot, booking: b });

    if (!dayMap.has(b.jour2_date)) dayMap.set(b.jour2_date, []);
    dayMap.get(b.jour2_date)!.push({ type: 'jour2', slot: b.jour2_slot, booking: b });
  }

  const feedUrl = calendarToken
    ? `https://novus-epoxy.vercel.app/api/calendar/feed?token=${calendarToken}`
    : '';

  return (
    <div style={{ padding: '20px', maxWidth: '900px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 700, margin: 0 }}>Calendrier des travaux</h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setShowSync(!showSync)}
            style={{
              padding: '8px 16px', borderRadius: '8px', border: '1px solid #f59e0b',
              background: 'transparent', color: '#f59e0b', fontSize: '13px', cursor: 'pointer',
            }}
          >
            Sync telephone
          </button>
        </div>
      </div>

      {/* Sync instructions */}
      {showSync && (
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '16px', marginBottom: '16px', border: '1px solid #334155' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '15px', color: '#f59e0b' }}>Ajouter a votre telephone</h3>
          {feedUrl ? (
            <>
              <p style={{ margin: '0 0 8px', fontSize: '13px', color: '#94a3b8' }}>
                <strong>iPhone (Apple Calendar):</strong> Reglages &gt; Calendrier &gt; Comptes &gt; Ajouter &gt; Autre &gt; Calendrier avec abonnement &gt; Collez l'URL
              </p>
              <p style={{ margin: '0 0 8px', fontSize: '13px', color: '#94a3b8' }}>
                <strong>Google Calendar:</strong> Parametres &gt; Ajouter un calendrier &gt; A partir de l'URL &gt; Collez l'URL
              </p>
              <div style={{
                background: '#0f172a', borderRadius: '8px', padding: '10px', marginTop: '8px',
                fontSize: '12px', color: '#f59e0b', wordBreak: 'break-all', cursor: 'pointer',
              }}
                onClick={() => navigator.clipboard?.writeText(feedUrl)}
              >
                {feedUrl}
                <span style={{ display: 'block', color: '#64748b', marginTop: '4px' }}>Cliquez pour copier</span>
              </div>
            </>
          ) : (
            <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>
              Ajoutez CALENDAR_TOKEN dans les variables Vercel pour activer le feed.
            </p>
          )}
        </div>
      )}

      {/* Upcoming bookings list */}
      {bookings.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: '#64748b' }}>
          Aucune reservation pour le moment
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {bookings.map(b => {
            const isPast = b.jour2_date < today;
            return (
              <div
                key={b.id}
                style={{
                  background: '#1e293b',
                  borderRadius: '12px',
                  padding: '16px',
                  border: isPast ? '1px solid #334155' : '1px solid #475569',
                  opacity: isPast ? 0.6 : 1,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <div style={{ fontSize: '16px', fontWeight: 700 }}>{b.client_nom}</div>
                    <div style={{ color: '#94a3b8', fontSize: '13px', marginTop: '2px' }}>
                      {b.type_service} — {b.superficie} pi² — {formatMoney(b.total)}
                    </div>
                    {b.client_adresse && (
                      <div style={{ color: '#64748b', fontSize: '12px', marginTop: '4px' }}>{b.client_adresse}</div>
                    )}
                    {b.client_tel && (
                      <a href={`tel:${b.client_tel}`} style={{ color: '#f59e0b', fontSize: '12px', textDecoration: 'none' }}>
                        {b.client_tel}
                      </a>
                    )}
                  </div>
                  <a
                    href={`/dashboard/devis/${b.quote_id}`}
                    style={{
                      padding: '6px 12px', borderRadius: '6px', background: '#0f172a',
                      color: '#94a3b8', fontSize: '12px', textDecoration: 'none',
                    }}
                  >
                    Devis #{b.quote_id}
                  </a>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <div style={{
                    flex: 1, background: '#0f172a', borderRadius: '8px', padding: '10px',
                    borderLeft: b.jour1_date === today ? '3px solid #f59e0b' : b.jour1_date < today ? '3px solid #22c55e' : '3px solid #3b82f6',
                  }}>
                    <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: '11px', textTransform: 'uppercase' as const }}>Jour 1</div>
                    <div style={{ fontSize: '14px', fontWeight: 600, marginTop: '2px' }}>{formatDate(b.jour1_date)}</div>
                    <div style={{ color: '#64748b', fontSize: '12px' }}>Matin: 8h-12h</div>
                  </div>
                  <div style={{
                    flex: 1, background: '#0f172a', borderRadius: '8px', padding: '10px',
                    borderLeft: b.jour2_date === today ? '3px solid #f59e0b' : b.jour2_date < today ? '3px solid #22c55e' : '3px solid #3b82f6',
                  }}>
                    <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: '11px', textTransform: 'uppercase' as const }}>Jour 2</div>
                    <div style={{ fontSize: '14px', fontWeight: 600, marginTop: '2px' }}>{formatDate(b.jour2_date)}</div>
                    <div style={{ color: '#64748b', fontSize: '12px' }}>
                      {b.jour2_slot === 'matin' ? 'Matin: 8h-12h' : 'PM: 12h-16h'}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
