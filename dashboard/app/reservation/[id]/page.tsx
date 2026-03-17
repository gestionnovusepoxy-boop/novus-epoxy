'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

interface Slot {
  date: string;
  dayName: string;
  jour2_date: string;
  jour2_slot: string;
}

function formatDate(d: string) {
  const date = new Date(d + 'T12:00:00');
  return date.toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' });
}

function slotLabel(s: string) {
  return s === 'matin' ? '8h — 12h' : '12h — 16h';
}

export default function ReservationPage() {
  const { id } = useParams();
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/bookings/available?quote_id=${id}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) setError(data.error);
        else setSlots(data.available || []);
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

  // Success
  if (done && selected) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
        <div style={{ textAlign: 'center', maxWidth: '500px' }}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>&#10003;</div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 16px' }}>Reservation confirmee!</h1>
          <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', textAlign: 'left', marginBottom: '20px' }}>
            <p style={{ margin: '0 0 12px', color: '#94a3b8', fontSize: '14px' }}>Vos rendez-vous:</p>
            <div style={{ background: '#0f172a', borderRadius: '8px', padding: '12px', marginBottom: '8px' }}>
              <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: '13px' }}>JOUR 1 — Preparation</div>
              <div style={{ fontSize: '16px', fontWeight: 600, marginTop: '4px' }}>{formatDate(selected.date)}</div>
              <div style={{ color: '#94a3b8', fontSize: '14px' }}>Matin: 8h — 12h</div>
            </div>
            <div style={{ background: '#0f172a', borderRadius: '8px', padding: '12px' }}>
              <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: '13px' }}>JOUR 2 — Finition</div>
              <div style={{ fontSize: '16px', fontWeight: 600, marginTop: '4px' }}>{formatDate(selected.jour2_date)}</div>
              <div style={{ color: '#94a3b8', fontSize: '14px' }}>{selected.jour2_slot === 'matin' ? 'Matin' : 'Apres-midi'}: {slotLabel(selected.jour2_slot)}</div>
            </div>
          </div>
          <p style={{ color: '#94a3b8', fontSize: '14px' }}>
            Vous recevrez un rappel 24h avant chaque rendez-vous. Pensez a preparer l'espace des travaux!
          </p>
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
            <strong style={{ color: '#f8fafc' }}>Jour 1 (matin):</strong> Preparation et premiere couche
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
                      Matin: 8h-12h
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
                Jour 1: {formatDate(selected.date)} — Matin (8h-12h)
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
