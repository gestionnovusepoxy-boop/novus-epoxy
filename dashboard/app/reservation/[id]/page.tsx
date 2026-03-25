'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

interface Slot {
  date: string;
  dayName: string;
  jour2_date: string;
  jour2_slot: string;
}

interface ExistingBooking {
  jour1_date: string;
  jour1_slot: string;
  jour2_date: string;
  jour2_slot: string;
  statut: string;
}

function formatDate(d: string) {
  const date = new Date(d + 'T12:00:00');
  return date.toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' });
}

function slotLabel(s: string) {
  return s === 'matin' ? 'AM (8h-12h)' : 'PM (12h-16h)';
}

export default function ReservationPage() {
  const { id } = useParams();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [secretToken, setSecretToken] = useState('');
  const [existingBooking, setExistingBooking] = useState<ExistingBooking | null>(null);
  const [quoteStatut, setQuoteStatut] = useState('');

  useEffect(() => {
    fetch(`/api/bookings/available?quote_id=${id}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) setError(data.error);
        else {
          if (data.client_email) setClientEmail(data.client_email);
          if (data.secret_token) setSecretToken(data.secret_token);
          if (data.already_booked && data.booking) {
            setExistingBooking(data.booking);
            setQuoteStatut(data.quote_statut || '');
          } else {
            setSlots(data.available || []);
          }
        }
      })
      .catch(() => setError('Erreur de connexion'))
      .finally(() => setLoading(false));
  }, [id]);

  async function confirm() {
    if (!selected || confirming) return;
    setConfirming(true);
    setError('');

    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quote_id: id,
          client_email: clientEmail,
          jour1_date: selected.date,
          jour2_date: selected.jour2_date,
          jour2_slot: selected.jour2_slot,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setDone(true);
      } else {
        setError(data.error || 'Erreur lors de la reservation');
      }
    } catch {
      setError('Erreur de connexion');
    } finally {
      setConfirming(false);
    }
  }

  // Already booked — show existing dates + next step
  if (existingBooking) {
    const isSigned = ['contrat_signe', 'depot_paye', 'planifie', 'complete'].includes(quoteStatut);
    const isPaid = ['depot_paye', 'planifie', 'complete'].includes(quoteStatut);

    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
        <div style={{ textAlign: 'center', maxWidth: '500px' }}>
          <div style={{ fontSize: '64px', marginBottom: '16px', color: '#22c55e' }}>&#10003;</div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 16px' }}>Vos dates sont choisies</h1>
          <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', textAlign: 'left', marginBottom: '20px' }}>
            <div style={{ background: '#0f172a', borderRadius: '8px', padding: '12px', marginBottom: '8px' }}>
              <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: '13px' }}>JOUR 1 — Preparation</div>
              <div style={{ fontSize: '16px', fontWeight: 600, marginTop: '4px' }}>{formatDate(existingBooking.jour1_date)}</div>
              <div style={{ color: '#94a3b8', fontSize: '14px' }}>{slotLabel(existingBooking.jour1_slot || 'matin')}</div>
            </div>
            <div style={{ background: '#0f172a', borderRadius: '8px', padding: '12px' }}>
              <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: '13px' }}>JOUR 2 — Finition</div>
              <div style={{ fontSize: '16px', fontWeight: 600, marginTop: '4px' }}>{formatDate(existingBooking.jour2_date)}</div>
              <div style={{ color: '#94a3b8', fontSize: '14px' }}>{slotLabel(existingBooking.jour2_slot)}</div>
            </div>
          </div>

          {/* Progress steps */}
          <div style={{ background: '#1e293b', borderRadius: '12px', padding: '16px', textAlign: 'left', marginBottom: '20px', border: '1px solid #334155' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 700, flexShrink: 0 }}>&#10003;</div>
              <span style={{ color: '#94a3b8', fontSize: '14px', textDecoration: 'line-through' }}>Choisir vos dates</span>
              {!isPaid && (
                <button
                  onClick={() => { setExistingBooking(null); setLoading(true); fetch(`/api/bookings/available?quote_id=${id}&force_new=1`).then(r => r.json()).then(data => { if (data.available) setSlots(data.available); if (data.client_email) setClientEmail(data.client_email); if (data.secret_token) setSecretToken(data.secret_token); }).catch(() => {}).finally(() => setLoading(false)); }}
                  style={{ marginLeft: 'auto', background: 'none', border: '1px solid #475569', color: '#94a3b8', padding: '4px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}
                >
                  Changer la date
                </button>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: isSigned ? '#22c55e' : '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 700, flexShrink: 0, color: '#0f172a' }}>{isSigned ? '\u2713' : '2'}</div>
              <span style={{ color: isSigned ? '#94a3b8' : '#f8fafc', fontSize: '14px', textDecoration: isSigned ? 'line-through' : 'none' }}>Signer le contrat</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: isPaid ? '#22c55e' : '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 700, flexShrink: 0, color: isPaid ? '#0f172a' : '#94a3b8' }}>{isPaid ? '\u2713' : '3'}</div>
              <span style={{ color: isPaid ? '#94a3b8' : '#64748b', fontSize: '14px', textDecoration: isPaid ? 'line-through' : 'none' }}>Payer le depot (30%)</span>
            </div>
          </div>

          {/* Next action button */}
          {!isSigned && (
            <a
              href={`/contrat/${id}?token=${encodeURIComponent(secretToken)}`}
              style={{
                display: 'block', background: '#f59e0b', color: '#0f172a',
                padding: '14px 32px', borderRadius: '8px', textDecoration: 'none',
                fontWeight: 700, fontSize: '16px', marginBottom: '12px',
              }}
            >
              Etape suivante: Signer le contrat
            </a>
          )}
          {isSigned && !isPaid && (
            <a
              href={`/paiement/${id}?token=${encodeURIComponent(secretToken)}`}
              style={{
                display: 'block', background: '#16a34a', color: '#fff',
                padding: '14px 32px', borderRadius: '8px', textDecoration: 'none',
                fontWeight: 700, fontSize: '16px', marginBottom: '12px',
              }}
            >
              Etape suivante: Payer le depot
            </a>
          )}
          {isPaid && (
            <div style={{ background: '#065f46', border: '1px solid #10b981', borderRadius: '8px', padding: '16px', color: '#d1fae5', fontWeight: 600 }}>
              Tout est confirme! On se voit le {formatDate(existingBooking.jour1_date)}.
            </div>
          )}
        </div>
      </div>
    );
  }

  // Success — just confirmed dates
  if (done && selected) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
        <div style={{ textAlign: 'center', maxWidth: '500px' }}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>&#10003;</div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 16px' }}>Dates choisies!</h1>
          <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', textAlign: 'left', marginBottom: '20px' }}>
            <p style={{ margin: '0 0 12px', color: '#94a3b8', fontSize: '14px' }}>Vos dates provisoires:</p>
            <div style={{ background: '#0f172a', borderRadius: '8px', padding: '12px', marginBottom: '8px' }}>
              <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: '13px' }}>JOUR 1 — Preparation</div>
              <div style={{ fontSize: '16px', fontWeight: 600, marginTop: '4px' }}>{formatDate(selected.date)}</div>
              <div style={{ color: '#94a3b8', fontSize: '14px' }}>AM: 8h — 12h</div>
            </div>
            <div style={{ background: '#0f172a', borderRadius: '8px', padding: '12px' }}>
              <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: '13px' }}>JOUR 2 — Finition</div>
              <div style={{ fontSize: '16px', fontWeight: 600, marginTop: '4px' }}>{formatDate(selected.jour2_date)}</div>
              <div style={{ color: '#94a3b8', fontSize: '14px' }}>{selected.jour2_slot === 'matin' ? 'AM' : 'PM'}: {slotLabel(selected.jour2_slot)}</div>
            </div>
          </div>
          <div style={{ background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: '8px', padding: '16px', marginBottom: '20px', textAlign: 'left' }}>
            <p style={{ margin: '0 0 4px', color: '#92400e', fontWeight: 700, fontSize: '14px' }}>Important</p>
            <p style={{ margin: 0, color: '#78716c', fontSize: '13px' }}>
              Ces dates sont provisoires et ne seront confirmees qu&apos;apres la signature du contrat et la reception du depot de 30% dans les 48 heures.
            </p>
          </div>
          <a
            href={`/contrat/${id}?token=${encodeURIComponent(secretToken)}`}
            style={{
              display: 'inline-block', background: '#f59e0b', color: '#0f172a',
              padding: '14px 32px', borderRadius: '8px', textDecoration: 'none',
              fontWeight: 700, fontSize: '16px',
            }}
          >
            Etape suivante: Signer le contrat
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f8fafc' }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', borderBottom: '1px solid #334155', padding: '24px 16px', textAlign: 'center' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>
          Planifier vos travaux
        </h1>
        <p style={{ color: '#94a3b8', margin: '8px 0 0', fontSize: '14px' }}>
          Choisissez la date du premier rendez-vous
        </p>
      </div>

      <div style={{ maxWidth: '600px', margin: '0 auto', padding: '16px' }}>
        {/* Info banner */}
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '16px', marginBottom: '16px', border: '1px solid #334155' }}>
          <p style={{ margin: '0 0 8px', fontSize: '14px', color: '#f59e0b', fontWeight: 600 }}>Comment ca fonctionne:</p>
          <p style={{ margin: '0 0 4px', fontSize: '13px', color: '#94a3b8' }}>
            <strong style={{ color: '#f8fafc' }}>Jour 1 (AM):</strong> Preparation et premiere couche
          </p>
          <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>
            <strong style={{ color: '#f8fafc' }}>Jour 2 (lendemain):</strong> Finition et deuxieme couche
          </p>
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>Chargement...</div>
        )}

        {error && (
          <div style={{ background: '#7f1d1d', border: '1px solid #dc2626', borderRadius: '8px', padding: '12px', marginBottom: '16px', color: '#fca5a5', fontSize: '14px' }}>
            {error}
          </div>
        )}

        {/* Available dates */}
        {!loading && slots.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {slots.map(slot => (
              <div
                key={slot.date}
                onClick={() => setSelected(slot)}
                style={{
                  background: '#1e293b',
                  border: selected?.date === slot.date ? '2px solid #f59e0b' : '2px solid #334155',
                  borderRadius: '12px',
                  padding: '14px 16px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '15px' }}>
                      {slot.dayName} {formatDate(slot.date)}
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: '13px', marginTop: '4px' }}>
                      AM: 8h-12h
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ color: '#64748b', fontSize: '12px' }}>Jour 2:</div>
                    <div style={{ color: '#94a3b8', fontSize: '13px' }}>
                      {formatDate(slot.jour2_date)} — {slotLabel(slot.jour2_slot)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && slots.length === 0 && !error && (
          <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
            Aucune disponibilite pour le moment. Contactez-nous directement.
          </div>
        )}

        {/* Confirm button */}
        {selected && (
          <div style={{ position: 'sticky', bottom: 0, padding: '16px 0', background: '#0f172a' }}>
            <div style={{ background: '#1e293b', borderRadius: '12px', padding: '16px', border: '1px solid #f59e0b' }}>
              <p style={{ margin: '0 0 4px', fontSize: '13px', color: '#94a3b8' }}>Vous avez choisi:</p>
              <p style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 600 }}>
                Jour 1: {formatDate(selected.date)} — AM (8h-12h)
              </p>
              <p style={{ margin: '0 0 12px', fontSize: '15px', fontWeight: 600 }}>
                Jour 2: {formatDate(selected.jour2_date)} — {slotLabel(selected.jour2_slot)}
              </p>
              <button
                onClick={confirm}
                disabled={confirming}
                style={{
                  width: '100%', padding: '14px',
                  background: '#f59e0b', color: '#0f172a', border: 'none',
                  borderRadius: '8px', fontSize: '16px', fontWeight: 700, cursor: 'pointer',
                }}
              >
                {confirming ? 'Confirmation...' : 'Confirmer la reservation'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
