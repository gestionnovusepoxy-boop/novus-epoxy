'use client';

import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

interface PaymentData {
  id: number;
  client_nom: string;
  type_service: string;
  superficie: number;
  total: number;
  depot_requis: number;
  statut: string;
  deposit_paid_at: string | null;
  balance_paid_at: string | null;
}

const SERVICE_LABELS: Record<string, string> = {
  flake: 'Flocon (Flake)',
  metallique: 'Metallique',
  commercial: 'Commercial',
};

function formatMoney(n: number) {
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(n);
}

export default function PaiementPage() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const success = searchParams.get('success') === 'true';
  const cancelled = searchParams.get('cancelled') === 'true';

  const [data, setData] = useState<PaymentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/quotes/${id}/payment-info`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(() => setError('Erreur de connexion'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#64748b' }}>Chargement...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
        <div style={{ textAlign: 'center', maxWidth: '400px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>&#9888;</div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 8px' }}>Page non disponible</h1>
          <p style={{ color: '#94a3b8', fontSize: '14px' }}>{error || 'Ce lien de paiement n\'est pas accessible.'}</p>
        </div>
      </div>
    );
  }

  const total = Number(data.total);
  const depot = Number(data.depot_requis);
  const balance = total - depot;
  const depositPaid = !!data.deposit_paid_at;
  const balancePaid = !!data.balance_paid_at;
  const fullyPaid = depositPaid && balancePaid;

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f8fafc' }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', borderBottom: '1px solid #334155', padding: '24px 16px', textAlign: 'center' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>Paiement</h1>
        <p style={{ color: '#f59e0b', margin: '4px 0 0', fontSize: '14px', fontWeight: 600 }}>Novus Epoxy — Devis #{data.id}</p>
      </div>

      <div style={{ maxWidth: '600px', margin: '0 auto', padding: '16px' }}>
        {/* Success message */}
        {success && (
          <div style={{ background: '#052e16', border: '1px solid #22c55e', borderRadius: '12px', padding: '20px', marginBottom: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '8px', color: '#22c55e' }}>&#10003;</div>
            <h2 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 8px', color: '#22c55e' }}>Paiement recu!</h2>
            <p style={{ color: '#86efac', fontSize: '14px', margin: 0 }}>Merci pour votre paiement. Vous recevrez une confirmation par email.</p>
          </div>
        )}

        {/* Cancelled message */}
        {cancelled && (
          <div style={{ background: '#450a0a', border: '1px solid #ef4444', borderRadius: '12px', padding: '20px', marginBottom: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '8px' }}>&#10060;</div>
            <h2 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 8px', color: '#ef4444' }}>Paiement annule</h2>
            <p style={{ color: '#fca5a5', fontSize: '14px', margin: '0 0 16px' }}>Le paiement n&apos;a pas ete complete. Vous pouvez reessayer.</p>
          </div>
        )}

        {/* Quote summary */}
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 16px' }}>Resume</h3>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #334155' }}>
            <span style={{ color: '#94a3b8', fontSize: '14px' }}>Client</span>
            <span style={{ fontSize: '14px', fontWeight: 600 }}>{data.client_nom}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #334155' }}>
            <span style={{ color: '#94a3b8', fontSize: '14px' }}>Service</span>
            <span style={{ fontSize: '14px' }}>{SERVICE_LABELS[data.type_service] || data.type_service}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #334155' }}>
            <span style={{ color: '#94a3b8', fontSize: '14px' }}>Superficie</span>
            <span style={{ fontSize: '14px' }}>{data.superficie} pi&sup2;</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', fontWeight: 700, fontSize: '18px' }}>
            <span>Total</span>
            <span>{formatMoney(total)}</span>
          </div>
        </div>

        {/* Payment status & actions */}
        {fullyPaid ? (
          <div style={{ background: '#052e16', border: '1px solid #22c55e', borderRadius: '12px', padding: '24px', textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '8px', color: '#22c55e' }}>&#10003;</div>
            <h2 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 8px', color: '#22c55e' }}>Tous les paiements completes</h2>
            <p style={{ color: '#86efac', fontSize: '14px', margin: 0 }}>Merci! Depot et solde ont ete payes.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Deposit section */}
            <div style={{
              background: depositPaid ? '#052e16' : '#1e293b',
              border: `1px solid ${depositPaid ? '#22c55e' : '#f59e0b'}`,
              borderRadius: '12px',
              padding: '20px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: depositPaid ? '0' : '16px' }}>
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 4px', color: depositPaid ? '#22c55e' : '#f59e0b' }}>
                    {depositPaid ? 'Depot paye' : 'Depot de 30%'}
                    {depositPaid && ' \u2713'}
                  </h3>
                  <p style={{ color: depositPaid ? '#86efac' : '#94a3b8', fontSize: '14px', margin: 0 }}>
                    {formatMoney(depot)}
                  </p>
                </div>
              </div>
              {!depositPaid && (
                <a
                  href={`/api/quotes/${data.id}/pay`}
                  style={{
                    display: 'block', width: '100%', padding: '16px',
                    background: '#f59e0b', color: '#0f172a', border: 'none', borderRadius: '8px',
                    fontSize: '16px', fontWeight: 700, textAlign: 'center', textDecoration: 'none',
                    cursor: 'pointer', boxSizing: 'border-box',
                  }}
                >
                  Payer maintenant — {formatMoney(depot)}
                </a>
              )}
            </div>

            {/* Balance section */}
            <div style={{
              background: balancePaid ? '#052e16' : '#1e293b',
              border: `1px solid ${balancePaid ? '#22c55e' : depositPaid ? '#f59e0b' : '#334155'}`,
              borderRadius: '12px',
              padding: '20px',
              opacity: depositPaid ? 1 : 0.5,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: (balancePaid || !depositPaid) ? '0' : '16px' }}>
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: 700, margin: '0 0 4px', color: balancePaid ? '#22c55e' : depositPaid ? '#f59e0b' : '#64748b' }}>
                    {balancePaid ? 'Solde paye' : 'Solde de 70%'}
                    {balancePaid && ' \u2713'}
                  </h3>
                  <p style={{ color: balancePaid ? '#86efac' : '#94a3b8', fontSize: '14px', margin: 0 }}>
                    {formatMoney(balance)}
                    {!depositPaid && ' — Disponible apres le depot'}
                  </p>
                </div>
              </div>
              {depositPaid && !balancePaid && (
                <a
                  href={`/api/quotes/${data.id}/pay`}
                  style={{
                    display: 'block', width: '100%', padding: '16px',
                    background: '#f59e0b', color: '#0f172a', border: 'none', borderRadius: '8px',
                    fontSize: '16px', fontWeight: 700, textAlign: 'center', textDecoration: 'none',
                    cursor: 'pointer', boxSizing: 'border-box',
                  }}
                >
                  Payer le solde — {formatMoney(balance)}
                </a>
              )}
            </div>
          </div>
        )}

        {/* Alternative payment */}
        {!fullyPaid && (
          <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155', marginTop: '16px', textAlign: 'center' }}>
            <p style={{ color: '#94a3b8', fontSize: '14px', margin: '0 0 8px' }}>Ou payez par virement Interac a:</p>
            <p style={{ color: '#f59e0b', fontWeight: 700, fontSize: '16px', margin: '0 0 4px' }}>gestionnovusepoxy@gmail.com</p>
            <p style={{ color: '#64748b', fontSize: '12px', margin: 0 }}>Ou par cheque a l&apos;ordre de Novus Epoxy</p>
          </div>
        )}

        {/* Footer */}
        <p style={{ textAlign: 'center', color: '#64748b', fontSize: '12px', marginTop: '24px' }}>
          Novus Epoxy — Planchers epoxy haut de gamme — Quebec<br />
          581-307-5983 | 581-307-2678
        </p>
      </div>
    </div>
  );
}
