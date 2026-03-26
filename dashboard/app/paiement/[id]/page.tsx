'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

interface QuoteData {
  id: number;
  client_nom: string;
  type_service: string;
  superficie: number;
  total: number;
  depot_requis: number;
  statut: string;
  deposit_paid_at: string | null;
  balance_paid_at: string | null;
  contrat_signe_at: string | null;
  secret_token: string;
  jour1_date?: string;
  jour1_slot?: string;
  jour2_date?: string;
  jour2_slot?: string;
}

const SERVICE_LABELS: Record<string, string> = {
  flake: 'Flocon (Flake)',
  metallique: 'Métallique',
  commercial: 'Commercial',
  quartz: 'Quartz',
  couleur_unie: 'Couleur Unie',
  antiderapant: 'Antidérapant',
  meulage: 'Meulage',
};

function formatMoney(n: number) {
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(n);
}

function formatDate(d: string) {
  const date = new Date(d + 'T12:00:00');
  return date.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function slotLabel(s: string) {
  return s === 'matin' ? 'AM (8h-12h)' : 'PM (12h-16h)';
}

export default function ClientPortalPage() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const success = searchParams.get('success') === 'true';
  const cancelled = searchParams.get('cancelled') === 'true';
  const token = searchParams.get('token') || '';

  const [data, setData] = useState<QuoteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [interacSent, setInteracSent] = useState(false);

  const fetchData = useCallback(() => {
    fetch(`/api/quotes/${id}/payment-info?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(() => setError('Erreur de connexion'))
      .finally(() => setLoading(false));
  }, [id, token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh every 10s to pick up status changes
  useEffect(() => {
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

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
          <p style={{ color: '#94a3b8', fontSize: '14px' }}>{error || 'Ce lien n\'est pas accessible.'}</p>
        </div>
      </div>
    );
  }

  const total = Number(data.total);
  const depot = Number(data.depot_requis);
  const balance = total - depot;
  const statut = data.statut as string;

  const hasDates = !!data.jour1_date;
  const contractSigned = !!data.contrat_signe_at || ['contrat_signe', 'depot_paye', 'planifie', 'complete'].includes(statut);
  const depositPaid = !!data.deposit_paid_at || (success && statut === 'contrat_signe');
  const balancePaid = !!data.balance_paid_at || (success && ['depot_paye', 'planifie'].includes(statut));
  const fullyPaid = depositPaid && balancePaid;

  // Determine current step
  const currentStep = !hasDates ? 1 : !contractSigned ? 2 : !depositPaid ? 3 : !balancePaid ? 4 : 5;

  const handleInterac = async () => {
    try {
      await fetch(`/api/quotes/${data.id}/interac?token=${encodeURIComponent(token)}`);
      setInteracSent(true);
    } catch { /* ignore */ }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f8fafc' }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', borderBottom: '1px solid #334155', padding: '24px 16px', textAlign: 'center' }}>
        <img src="/logo-email.jpg" alt="Novus Epoxy" width="60" height="60" style={{ borderRadius: '8px', marginBottom: '8px' }} />
        <h1 style={{ fontSize: '22px', fontWeight: 700, margin: 0 }}>Votre projet Novus Epoxy</h1>
        <p style={{ color: '#f59e0b', margin: '4px 0 0', fontSize: '14px', fontWeight: 600 }}>Devis #{data.id} — {data.client_nom}</p>
      </div>

      <div style={{ maxWidth: '600px', margin: '0 auto', padding: '16px' }}>
        {/* Success / Cancelled messages */}
        {success && (
          <div style={{ background: '#052e16', border: '1px solid #22c55e', borderRadius: '12px', padding: '20px', marginBottom: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '40px', marginBottom: '8px', color: '#22c55e' }}>&#10003;</div>
            <h2 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 4px', color: '#22c55e' }}>Paiement recu!</h2>
            <p style={{ color: '#86efac', fontSize: '13px', margin: 0 }}>Merci! Vous recevrez une confirmation par email.</p>
          </div>
        )}
        {cancelled && (
          <div style={{ background: '#450a0a', border: '1px solid #ef4444', borderRadius: '12px', padding: '16px', marginBottom: '16px', textAlign: 'center' }}>
            <p style={{ color: '#fca5a5', fontSize: '14px', margin: 0 }}>Paiement annule — vous pouvez reessayer ci-dessous.</p>
          </div>
        )}

        {/* Progress steps */}
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '16px', marginBottom: '16px', border: '1px solid #334155' }}>
          {[
            { num: 1, label: 'Choisir vos dates', done: hasDates },
            { num: 2, label: 'Signer le contrat', done: contractSigned },
            { num: 3, label: `Depot 30% — ${formatMoney(depot)}`, done: depositPaid },
            { num: 4, label: `Solde 70% — ${formatMoney(balance)}`, done: balancePaid },
          ].map((step, i) => (
            <div key={step.num} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: i < 3 ? '10px' : 0 }}>
              <div style={{
                width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
                background: step.done ? '#22c55e' : step.num === currentStep ? '#f59e0b' : '#334155',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '13px', fontWeight: 700,
                color: step.done || step.num === currentStep ? '#fff' : '#64748b',
              }}>
                {step.done ? '\u2713' : step.num}
              </div>
              <span style={{
                color: step.done ? '#94a3b8' : step.num === currentStep ? '#f8fafc' : '#64748b',
                fontSize: '14px',
                fontWeight: step.num === currentStep ? 700 : 400,
                textDecoration: step.done ? 'line-through' : 'none',
                flex: 1,
              }}>
                {step.label}
              </span>
            </div>
          ))}
        </div>

        {/* Dates display */}
        {hasDates && data.jour2_date && (
          <div style={{ background: '#1e293b', borderRadius: '12px', padding: '16px', marginBottom: '16px', border: '1px solid #334155' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, margin: '0 0 10px', color: '#f59e0b' }}>
              {depositPaid ? 'Dates confirmees' : 'Dates provisoires'}
            </h3>
            <div style={{ background: '#0f172a', borderRadius: '8px', padding: '10px', marginBottom: '6px' }}>
              <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: '11px' }}>JOUR 1 — Preparation</div>
              <div style={{ fontSize: '14px', fontWeight: 600, marginTop: '2px' }}>{formatDate(data.jour1_date!)}</div>
              <div style={{ color: '#94a3b8', fontSize: '12px' }}>{slotLabel(data.jour1_slot || 'matin')}</div>
            </div>
            <div style={{ background: '#0f172a', borderRadius: '8px', padding: '10px' }}>
              <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: '11px' }}>JOUR 2 — Finition</div>
              <div style={{ fontSize: '14px', fontWeight: 600, marginTop: '2px' }}>{formatDate(data.jour2_date)}</div>
              <div style={{ color: '#94a3b8', fontSize: '12px' }}>{slotLabel(data.jour2_slot || 'apres-midi')}</div>
            </div>
            {!depositPaid && (
              <a href={`/reservation/${data.id}?token=${encodeURIComponent(token)}`}
                style={{ display: 'block', textAlign: 'center', color: '#94a3b8', fontSize: '12px', marginTop: '8px', textDecoration: 'underline' }}>
                Changer mes dates
              </a>
            )}
          </div>
        )}

        {/* Quote summary */}
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '16px', border: '1px solid #334155', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '15px', fontWeight: 700, margin: '0 0 12px' }}>Votre soumission</h3>
          {[
            { label: 'Service', value: SERVICE_LABELS[data.type_service] || data.type_service },
            { label: 'Superficie', value: `${data.superficie} pi²` },
          ].map(row => (
            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #334155' }}>
              <span style={{ color: '#94a3b8', fontSize: '13px' }}>{row.label}</span>
              <span style={{ fontSize: '13px', fontWeight: 600 }}>{row.value}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', fontWeight: 700, fontSize: '17px' }}>
            <span>Total</span>
            <span>{formatMoney(total)}</span>
          </div>
        </div>

        {/* === CURRENT ACTION BUTTON === */}
        {currentStep === 1 && (
          <a href={`/reservation/${data.id}?token=${encodeURIComponent(token)}`}
            style={{
              display: 'block', width: '100%', padding: '18px', textAlign: 'center',
              background: '#f59e0b', color: '#0f172a', borderRadius: '10px',
              textDecoration: 'none', fontWeight: 700, fontSize: '17px',
              marginBottom: '16px', boxSizing: 'border-box',
            }}>
            Choisir mes dates de travaux
          </a>
        )}

        {currentStep === 2 && (
          <a href={`/contrat/${data.id}?token=${encodeURIComponent(token)}`}
            style={{
              display: 'block', width: '100%', padding: '18px', textAlign: 'center',
              background: '#0f172a', color: '#ffffff', borderRadius: '10px', border: '2px solid #f59e0b',
              textDecoration: 'none', fontWeight: 700, fontSize: '17px',
              marginBottom: '16px', boxSizing: 'border-box',
            }}>
            Signer le contrat
          </a>
        )}

        {currentStep === 3 && (
          <div style={{ marginBottom: '16px' }}>
            <a href={`/api/quotes/${data.id}/pay?token=${encodeURIComponent(token)}`}
              style={{
                display: 'block', width: '100%', padding: '18px', textAlign: 'center',
                background: '#16a34a', color: '#ffffff', borderRadius: '10px',
                textDecoration: 'none', fontWeight: 700, fontSize: '17px',
                marginBottom: '10px', boxSizing: 'border-box',
              }}>
              Payer en ligne — {formatMoney(depot)}
            </a>
            {!interacSent ? (
              <button onClick={handleInterac}
                style={{
                  display: 'block', width: '100%', padding: '16px', textAlign: 'center',
                  background: '#1e293b', color: '#f8fafc', borderRadius: '10px', border: '1px solid #475569',
                  fontWeight: 700, fontSize: '15px', cursor: 'pointer',
                }}>
                Je paie par virement Interac
              </button>
            ) : (
              <div style={{ background: '#052e16', border: '1px solid #22c55e', borderRadius: '10px', padding: '16px', textAlign: 'center' }}>
                <p style={{ color: '#22c55e', fontWeight: 700, margin: '0 0 8px' }}>Notre equipe a ete notifiee!</p>
                <p style={{ color: '#86efac', fontSize: '13px', margin: '0 0 8px' }}>Envoyez <strong>{formatMoney(depot)}</strong> par virement Interac a :</p>
                <p style={{ color: '#f59e0b', fontWeight: 700, fontSize: '16px', margin: '0 0 4px' }}>gestionnovusepoxy@gmail.com</p>
                <p style={{ color: '#64748b', fontSize: '12px', margin: '4px 0 0' }}>Message: Devis #{data.id} — {data.client_nom}</p>
              </div>
            )}
          </div>
        )}

        {/* Step 4: Solde 70% — dispo dès que dépôt payé */}
        {currentStep === 4 && (
          <div style={{ marginBottom: '16px' }}>
            <div style={{ background: '#052e16', border: '1px solid #22c55e', borderRadius: '10px', padding: '14px', marginBottom: '12px', textAlign: 'center' }}>
              <p style={{ color: '#22c55e', fontWeight: 700, fontSize: '15px', margin: 0 }}>Depot de {formatMoney(depot)} recu &#10003;</p>
            </div>
            <a href={`/api/quotes/${data.id}/pay?token=${encodeURIComponent(token)}&type=balance`}
              style={{
                display: 'block', width: '100%', padding: '18px', textAlign: 'center',
                background: '#f59e0b', color: '#0f172a', borderRadius: '10px',
                textDecoration: 'none', fontWeight: 700, fontSize: '17px',
                marginBottom: '10px', boxSizing: 'border-box',
              }}>
              Payer le solde — {formatMoney(balance)}
            </a>
            <button onClick={handleInterac}
              style={{
                display: interacSent ? 'none' : 'block', width: '100%', padding: '14px', textAlign: 'center',
                background: '#1e293b', color: '#f8fafc', borderRadius: '10px', border: '1px solid #475569',
                fontWeight: 600, fontSize: '14px', cursor: 'pointer',
              }}>
              Je paie le solde par virement Interac
            </button>
            {interacSent && (
              <div style={{ background: '#052e16', border: '1px solid #22c55e', borderRadius: '10px', padding: '14px', textAlign: 'center' }}>
                <p style={{ color: '#22c55e', fontWeight: 700, margin: '0 0 6px' }}>Notre equipe a ete notifiee!</p>
                <p style={{ color: '#86efac', fontSize: '13px', margin: 0 }}>Envoyez <strong>{formatMoney(balance)}</strong> a <strong style={{ color: '#f59e0b' }}>gestionnovusepoxy@gmail.com</strong></p>
              </div>
            )}
          </div>
        )}

        {/* Step 5: Fully paid */}
        {currentStep === 5 && (
          <div style={{ background: '#052e16', border: '1px solid #22c55e', borderRadius: '12px', padding: '24px', textAlign: 'center', marginBottom: '16px' }}>
            <div style={{ fontSize: '48px', marginBottom: '8px', color: '#22c55e' }}>&#10003;</div>
            <h2 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 8px', color: '#22c55e' }}>Tout est paye!</h2>
            <p style={{ color: '#86efac', fontSize: '14px', margin: 0 }}>Merci pour votre confiance. Depot et solde completes.</p>
          </div>
        )}

        {/* Calendar — show when deposit paid + dates exist */}
        {depositPaid && data.jour1_date && data.jour2_date && (
          <div style={{ background: '#1e293b', borderRadius: '12px', padding: '16px', border: '1px solid #0ea5e9', marginBottom: '16px', textAlign: 'center' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 700, margin: '0 0 10px', color: '#0ea5e9' }}>Ajouter au calendrier</h3>
            <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <a href={`/api/quotes/${data.id}/calendar?type=google&day=1`} target="_blank" rel="noopener noreferrer"
                style={{ background: '#4285f4', color: '#fff', padding: '8px 14px', borderRadius: '6px', textDecoration: 'none', fontWeight: 600, fontSize: '12px' }}>
                Google - Jour 1
              </a>
              <a href={`/api/quotes/${data.id}/calendar?type=google&day=2`} target="_blank" rel="noopener noreferrer"
                style={{ background: '#4285f4', color: '#fff', padding: '8px 14px', borderRadius: '6px', textDecoration: 'none', fontWeight: 600, fontSize: '12px' }}>
                Google - Jour 2
              </a>
              <a href={`/api/quotes/${data.id}/calendar?type=ics`}
                style={{ background: '#334155', color: '#f8fafc', padding: '8px 14px', borderRadius: '6px', textDecoration: 'none', fontWeight: 600, fontSize: '12px' }}>
                Apple / Outlook
              </a>
            </div>
          </div>
        )}

        {/* Footer with names + roles */}
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '16px', border: '1px solid #334155', marginBottom: '16px' }}>
          <p style={{ color: '#94a3b8', fontSize: '12px', margin: '0 0 8px', fontWeight: 700 }}>Questions? Contactez-nous :</p>
          <p style={{ color: '#f8fafc', fontSize: '13px', margin: '0 0 4px' }}>
            <strong>Luca</strong> (facturation / soumission) : <a href="tel:5813075983" style={{ color: '#f59e0b' }}>581-307-5983</a>
          </p>
          <p style={{ color: '#f8fafc', fontSize: '13px', margin: 0 }}>
            <strong>Jason</strong> (chantier / soumission) : <a href="tel:5813072678" style={{ color: '#f59e0b' }}>581-307-2678</a>
          </p>
        </div>

        <p style={{ textAlign: 'center', color: '#475569', fontSize: '11px', margin: '0 0 24px' }}>
          Novus Epoxy — Planchers epoxy haut de gamme — RBQ 5861-8471-01<br />
          Garantie 10 ans | 15 ans d&apos;experience | novusepoxy.ca
        </p>
      </div>
    </div>
  );
}
