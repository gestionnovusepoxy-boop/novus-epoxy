'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

interface QuoteData {
  id: number;
  client_nom: string;
  client_email: string;
  client_tel: string | null;
  client_adresse: string | null;
  type_service: string;
  superficie: number;
  etat_plancher: string | null;
  notes: string | null;
  sous_total: number;
  tps: number;
  tvq: number;
  total: number;
  depot_requis: number;
  statut: string;
  contrat_signe_at: string | null;
  contrat_signature_nom: string | null;
  created_at: string;
  booking_jour1_date?: string | null;
  booking_jour2_date?: string | null;
  booking_jour2_slot?: string | null;
}

const SERVICE_LABELS: Record<string, string> = {
  flake: 'Flocon (Flake)',
  metallique: 'Metallique',
  commercial: 'Commercial',
};

function formatMoney(n: number) {
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(n);
}

function formatDate(d: string) {
  return new Intl.DateTimeFormat('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(d));
}

export default function ContratPage() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [signatureNom, setSignatureNom] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [signing, setSigning] = useState(false);
  const [done, setDone] = useState(false);
  const [alreadySigned, setAlreadySigned] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });

  const getPos = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) {
      return { x: (e.touches[0].clientX - rect.left) * scaleX, y: (e.touches[0].clientY - rect.top) * scaleY };
    }
    return { x: ((e as React.MouseEvent).clientX - rect.left) * scaleX, y: ((e as React.MouseEvent).clientY - rect.top) * scaleY };
  }, []);

  const startDraw = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    isDrawingRef.current = true;
    lastPosRef.current = getPos(e);
  }, [getPos]);

  const draw = useCallback((e: React.TouchEvent | React.MouseEvent) => {
    if (!isDrawingRef.current) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    lastPosRef.current = pos;
    setHasDrawn(true);
  }, [getPos]);

  const stopDraw = useCallback(() => {
    isDrawingRef.current = false;
  }, []);

  const clearSignature = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || !canvasRef.current) return;
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setHasDrawn(false);
  }, []);

  useEffect(() => {
    // Fetch quote data for display via the public contract data endpoint
    fetch(`/api/quotes/${id}/contract/data?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          if (data.already_signed) setAlreadySigned(true);
          setError(data.error);
        } else {
          setQuote(data);
          if (['contrat_signe', 'depot_paye', 'planifie', 'complete'].includes(data.statut)) {
            setAlreadySigned(true);
          }
        }
      })
      .catch(() => setError('Erreur de connexion'))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSign() {
    if (!quote || !signatureNom.trim() || !accepted || signing) return;
    setSigning(true);
    setError('');

    try {
      const res = await fetch(`/api/quotes/${id}/contract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_email: quote.client_email,
          signature_nom: signatureNom.trim(),
          token,
          signature_image: (() => {
            const canvas = canvasRef.current;
            if (!canvas) return null;
            // Draw on white background for export
            const exportCanvas = document.createElement('canvas');
            exportCanvas.width = canvas.width;
            exportCanvas.height = canvas.height;
            const ctx = exportCanvas.getContext('2d');
            if (!ctx) return null;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
            ctx.drawImage(canvas, 0, 0);
            return exportCanvas.toDataURL('image/png');
          })(),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setDone(true);
      } else {
        if (data.already_signed) setAlreadySigned(true);
        setError(data.error || 'Erreur lors de la signature');
      }
    } catch {
      setError('Erreur de connexion');
    } finally {
      setSigning(false);
    }
  }

  // Loading
  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: '#64748b' }}>Chargement du contrat...</div>
      </div>
    );
  }

  // Already signed
  if (alreadySigned) {
    const isPaid = quote?.statut === 'depot_paye' || quote?.statut === 'planifie' || quote?.statut === 'complete';
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
        <div style={{ textAlign: 'center', maxWidth: '500px' }}>
          <div style={{ fontSize: '64px', marginBottom: '16px', color: '#22c55e' }}>&#10003;</div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 12px' }}>Contrat deja signe</h1>
          <p style={{ color: '#94a3b8', fontSize: '14px', marginBottom: '20px' }}>
            {quote?.contrat_signature_nom && `Signe par ${quote.contrat_signature_nom}`}
            {quote?.contrat_signe_at && ` le ${formatDate(quote.contrat_signe_at)}`}
          </p>

          {/* Progress steps */}
          <div style={{ background: '#1e293b', borderRadius: '12px', padding: '16px', marginBottom: '20px', border: '1px solid #334155', textAlign: 'left' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 700, flexShrink: 0, color: '#fff' }}>{'\u2713'}</div>
              <span style={{ color: '#94a3b8', fontSize: '14px', textDecoration: 'line-through' }}>Choisir vos dates</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 700, flexShrink: 0, color: '#fff' }}>{'\u2713'}</div>
              <span style={{ color: '#94a3b8', fontSize: '14px', textDecoration: 'line-through' }}>Signer le contrat</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: isPaid ? '#22c55e' : '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 700, flexShrink: 0, color: isPaid ? '#fff' : '#0f172a' }}>{isPaid ? '\u2713' : '3'}</div>
              <span style={{ color: isPaid ? '#94a3b8' : '#f8fafc', fontSize: '14px', fontWeight: isPaid ? 400 : 700, textDecoration: isPaid ? 'line-through' : 'none' }}>Payer le depot (30%)</span>
            </div>
          </div>

          {!isPaid && (
            <>
              <a
                href={`/paiement/${id}?token=${encodeURIComponent(token)}`}
                style={{
                  display: 'block', width: '100%', padding: '14px',
                  background: '#f59e0b', color: '#0f172a', border: 'none', borderRadius: '8px',
                  fontSize: '16px', fontWeight: 700, textAlign: 'center', textDecoration: 'none',
                  cursor: 'pointer', boxSizing: 'border-box', marginBottom: '12px',
                }}
              >
                Etape suivante: Payer le depot — {quote ? formatMoney(Number(quote.depot_requis)) : ''}
              </a>
              <a
                href={`/api/quotes/${id}/interac?token=${encodeURIComponent(token)}`}
                style={{
                  display: 'block', width: '100%', padding: '14px',
                  background: '#1e293b', color: '#f8fafc', border: '2px solid #f59e0b', borderRadius: '8px',
                  fontSize: '15px', fontWeight: 700, textAlign: 'center', textDecoration: 'none',
                  cursor: 'pointer', boxSizing: 'border-box',
                }}
              >
                💸 Payer par virement Interac — 0$ de frais
              </a>
            </>
          )}
          {isPaid && (
            <div style={{ background: '#065f46', border: '1px solid #10b981', borderRadius: '8px', padding: '16px', color: '#d1fae5', fontWeight: 600 }}>
              Tout est confirme! Merci pour votre confiance.
            </div>
          )}
        </div>
      </div>
    );
  }

  // Success after signing
  if (done) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
        <div style={{ textAlign: 'center', maxWidth: '500px' }}>
          <div style={{ fontSize: '64px', marginBottom: '16px', color: '#22c55e' }}>&#10003;</div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, margin: '0 0 12px' }}>Contrat signe!</h1>
          <p style={{ color: '#94a3b8', fontSize: '14px', marginBottom: '20px' }}>
            Merci {signatureNom}! Vous recevrez une confirmation par email.
          </p>

          {/* Progress steps */}
          <div style={{ background: '#1e293b', borderRadius: '12px', padding: '16px', marginBottom: '20px', border: '1px solid #334155', textAlign: 'left' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 700, flexShrink: 0, color: '#fff' }}>{'\u2713'}</div>
              <span style={{ color: '#94a3b8', fontSize: '14px', textDecoration: 'line-through' }}>Choisir vos dates</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 700, flexShrink: 0, color: '#fff' }}>{'\u2713'}</div>
              <span style={{ color: '#94a3b8', fontSize: '14px', textDecoration: 'line-through' }}>Signer le contrat</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 700, flexShrink: 0, color: '#0f172a' }}>3</div>
              <span style={{ color: '#f8fafc', fontSize: '14px', fontWeight: 700 }}>Payer le depot (30%)</span>
            </div>
          </div>

          <a
            href={`/paiement/${id}?token=${encodeURIComponent(token)}`}
            style={{
              display: 'block', width: '100%', padding: '16px',
              background: '#f59e0b', color: '#0f172a', border: 'none', borderRadius: '8px',
              fontSize: '18px', fontWeight: 700, textAlign: 'center', textDecoration: 'none',
              cursor: 'pointer', boxSizing: 'border-box', marginBottom: '16px',
            }}
          >
            Etape suivante: Payer le depot — {quote ? formatMoney(Number(quote.depot_requis)) : ''}
          </a>
          <a
            href={`/api/quotes/${id}/interac?token=${encodeURIComponent(token)}`}
            style={{
              display: 'block', width: '100%', padding: '14px',
              background: '#1e293b', color: '#f8fafc', border: '2px solid #f59e0b', borderRadius: '8px',
              fontSize: '15px', fontWeight: 700, textAlign: 'center', textDecoration: 'none',
              cursor: 'pointer', boxSizing: 'border-box', marginBottom: '12px',
            }}
          >
            💸 Payer par virement Interac — 0$ de frais
          </a>
          <p style={{ color: '#ef4444', fontSize: '12px', margin: '0' }}>Si le depot n&apos;est pas recu dans les 48 heures, vos dates pourraient etre attribuees a un autre client.</p>
        </div>
      </div>
    );
  }

  // Error without quote data
  if (!quote) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
        <div style={{ textAlign: 'center', maxWidth: '400px' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>&#9888;</div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 8px' }}>Contrat non disponible</h1>
          <p style={{ color: '#94a3b8', fontSize: '14px' }}>{error || 'Ce contrat n\'est pas accessible.'}</p>
        </div>
      </div>
    );
  }

  const penalite = Math.max(400, Number(quote.total) * 0.02);

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f8fafc' }}>
      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', borderBottom: '1px solid #334155', padding: '24px 16px', textAlign: 'center' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, margin: 0 }}>Contrat de services</h1>
        <p style={{ color: '#f59e0b', margin: '4px 0 0', fontSize: '14px', fontWeight: 600 }}>Novus Epoxy — Devis #{quote.id}</p>
      </div>

      <div style={{ maxWidth: '700px', margin: '0 auto', padding: '16px' }}>
        {/* Progress steps */}
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '16px', marginBottom: '16px', border: '1px solid #334155' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: quote.booking_jour1_date ? '#22c55e' : '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 700, flexShrink: 0, color: quote.booking_jour1_date ? '#fff' : '#94a3b8' }}>{quote.booking_jour1_date ? '\u2713' : '1'}</div>
            <span style={{ color: quote.booking_jour1_date ? '#94a3b8' : '#f8fafc', fontSize: '14px', textDecoration: quote.booking_jour1_date ? 'line-through' : 'none' }}>Choisir vos dates</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 700, flexShrink: 0, color: '#0f172a' }}>2</div>
            <span style={{ color: '#f8fafc', fontSize: '14px', fontWeight: 700 }}>Signer le contrat</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 700, flexShrink: 0, color: '#94a3b8' }}>3</div>
            <span style={{ color: '#64748b', fontSize: '14px' }}>Payer le depot (30%)</span>
          </div>
        </div>

        {error && (
          <div style={{ background: '#7f1d1d', border: '1px solid #dc2626', borderRadius: '8px', padding: '12px', marginBottom: '16px', color: '#fca5a5', fontSize: '14px' }}>
            {error}
          </div>
        )}

        {/* Contract content */}
        <div style={{ background: '#1e293b', borderRadius: '12px', border: '1px solid #334155', overflow: 'hidden', marginBottom: '16px' }}>
          {/* Parties */}
          <div style={{ padding: '20px', borderBottom: '1px solid #334155' }}>
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' as const }}>
              <div style={{ flex: 1, minWidth: '200px' }}>
                <div style={{ fontSize: '10px', textTransform: 'uppercase' as const, letterSpacing: '1.5px', color: '#64748b', fontWeight: 700, marginBottom: '4px' }}>Entrepreneur</div>
                <div style={{ fontWeight: 700, fontSize: '15px' }}>Novus Epoxy</div>
                <div style={{ color: '#94a3b8', fontSize: '12px', lineHeight: 1.6 }}>
                  44 rue de la Polyvalente, Quebec, G2N 1G8<br/>
                  581-307-5983<br/>
                  RBQ: 5861-8471-01 | Membre APCHQ
                </div>
              </div>
              <div style={{ flex: 1, minWidth: '200px' }}>
                <div style={{ fontSize: '10px', textTransform: 'uppercase' as const, letterSpacing: '1.5px', color: '#64748b', fontWeight: 700, marginBottom: '4px' }}>Client</div>
                <div style={{ fontWeight: 700, fontSize: '15px' }}>{quote.client_nom}</div>
                <div style={{ color: '#94a3b8', fontSize: '12px', lineHeight: 1.6 }}>
                  {quote.client_adresse && <>{quote.client_adresse}<br/></>}
                  {quote.client_email}<br/>
                  {quote.client_tel}
                </div>
              </div>
            </div>
          </div>

          {/* Article 1 */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #334155' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: '8px' }}>Article 1 — Description des travaux</h3>
            <div style={{ color: '#cbd5e1', fontSize: '13px' }}>
              <p style={{ margin: '2px 0' }}><strong>Service:</strong> {SERVICE_LABELS[quote.type_service] || quote.type_service}</p>
              <p style={{ margin: '2px 0' }}><strong>Superficie:</strong> {quote.superficie} pieds carres</p>
              {quote.etat_plancher && <p style={{ margin: '2px 0' }}><strong>Etat du plancher:</strong> {quote.etat_plancher}</p>}
              {quote.notes && <p style={{ margin: '2px 0' }}><strong>Notes:</strong> {quote.notes}</p>}
            </div>
          </div>

          {/* Article 2 */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #334155' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: '8px' }}>Article 2 — Prix et modalites de paiement</h3>
            <div style={{ color: '#cbd5e1', fontSize: '13px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #334155' }}>
                <span style={{ color: '#94a3b8' }}>Sous-total</span><span>{formatMoney(Number(quote.sous_total))}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #334155' }}>
                <span style={{ color: '#94a3b8' }}>TPS (5%)</span><span>{formatMoney(Number(quote.tps))}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #334155' }}>
                <span style={{ color: '#94a3b8' }}>TVQ (9,975%)</span><span>{formatMoney(Number(quote.tvq))}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontWeight: 700, fontSize: '16px' }}>
                <span>Total</span><span>{formatMoney(Number(quote.total))}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: '#f59e0b', fontWeight: 600 }}>
                <span>Depot (30%) a la signature</span><span>{formatMoney(Number(quote.depot_requis))}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span style={{ color: '#94a3b8' }}>Solde (70%) a la fin des travaux</span><span>{formatMoney(Number(quote.total) - Number(quote.depot_requis))}</span>
              </div>
              <p style={{ margin: '8px 0 0', color: '#94a3b8', fontSize: '12px' }}>Virement Interac : 0$ de frais | Carte de credit : 3% frais de traitement</p>
            </div>
          </div>

          {/* Article 3 */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #334155' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: '8px' }}>Article 3 — Echeancier</h3>
            {quote.booking_jour1_date ? (
              <div style={{ color: '#cbd5e1', fontSize: '13px' }}>
                <p style={{ margin: '0 0 8px', fontWeight: 600 }}>Dates provisoires choisies:</p>
                <div style={{ background: '#0f172a', borderRadius: '8px', padding: '10px', marginBottom: '8px' }}>
                  <p style={{ margin: '2px 0' }}><strong style={{ color: '#f59e0b' }}>Jour 1 (preparation):</strong> {formatDate(quote.booking_jour1_date)} — AM (8h-12h)</p>
                  {quote.booking_jour2_date && (
                    <p style={{ margin: '2px 0' }}><strong style={{ color: '#f59e0b' }}>Jour 2 (finition):</strong> {formatDate(quote.booking_jour2_date)} — {quote.booking_jour2_slot === 'matin' ? 'AM (8h-12h)' : 'PM (12h-16h)'}</p>
                  )}
                </div>
                <p style={{ margin: 0, color: '#94a3b8', fontSize: '12px' }}>Ces dates seront confirmees a la reception du depot de 30%.</p>
              </div>
            ) : (
              <p style={{ color: '#cbd5e1', fontSize: '13px', margin: 0 }}>Les dates des travaux seront convenues apres la signature du contrat et le paiement du depot. L'entrepreneur s'engage a executer les travaux selon les regles de l'art.</p>
            )}
          </div>

          {/* Article 4 */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #334155' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: '8px' }}>Article 4 — Obligations de l'entrepreneur</h3>
            <ul style={{ color: '#cbd5e1', fontSize: '13px', paddingLeft: '18px', margin: 0 }}>
              <li>Executer les travaux selon les normes RBQ et les regles de l'art</li>
              <li>Fournir tous les materiaux necessaires</li>
              <li>Respecter l'echeancier convenu</li>
              <li>Detenir une assurance responsabilite civile valide</li>
              <li>Garantie de 10 ans sur l'adhesion du revetement epoxy</li>
            </ul>
          </div>

          {/* Article 5 */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #334155' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: '8px' }}>Article 5 — Obligations du client</h3>
            <ul style={{ color: '#cbd5e1', fontSize: '13px', paddingLeft: '18px', margin: 0 }}>
              <li>Liberer l'espace de travail (garage/sous-sol vide)</li>
              <li>Assurer l'acces a l'electricite et l'eau</li>
              <li>Ne pas utiliser le plancher pendant la periode de sechage (72 heures minimum)</li>
            </ul>
          </div>

          {/* Article 6 */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #334155' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: '8px' }}>Article 6 — Annulation</h3>
            <ul style={{ color: '#cbd5e1', fontSize: '13px', paddingLeft: '18px', margin: 0 }}>
              <li>Le client peut annuler avant le debut des travaux.</li>
              <li>Penalite: {formatMoney(penalite)} (400 $ ou 2% du total, le plus eleve), plus materiaux commandes.</li>
              <li>Solde du depot rembourse dans les 30 jours suivant l'annulation.</li>
              <li>Annulation par l'entrepreneur: remboursement complet du depot.</li>
            </ul>
          </div>

          {/* Article 7 */}
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #334155' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: '8px' }}>Article 7 — Garantie</h3>
            <ul style={{ color: '#cbd5e1', fontSize: '13px', paddingLeft: '18px', margin: 0 }}>
              <li>Garantie de 10 ans sur l'adhesion du revetement epoxy.</li>
              <li>Garantie legale de 1 an contre les defauts de fabrication (Code civil du Quebec).</li>
              <li>Garantie legale de 5 ans contre la perte de l'ouvrage (Code civil du Quebec, art. 2118).</li>
              <li>Exclusions: utilisation inadequate, impacts mecaniques lourds, produits chimiques non compatibles.</li>
            </ul>
          </div>

          {/* Article 8 */}
          <div style={{ padding: '16px 20px' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: '8px' }}>Article 8 — Resolution des litiges</h3>
            <p style={{ color: '#cbd5e1', fontSize: '13px', margin: 0 }}>Les parties s'engagent a resoudre tout litige a l'amiable. A defaut, les tribunaux du Quebec seront competents.</p>
          </div>
        </div>

        {/* Signature section */}
        <div style={{ background: '#1e293b', borderRadius: '12px', padding: '20px', border: '1px solid #334155', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px' }}>Signature du contrat</h3>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', color: '#94a3b8', fontSize: '13px', marginBottom: '6px' }}>Votre nom complet</label>
            <input
              type="text"
              value={signatureNom}
              onChange={e => setSignatureNom(e.target.value)}
              placeholder={quote.client_nom}
              style={{
                width: '100%', padding: '12px', background: '#0f172a', border: '1px solid #334155',
                borderRadius: '8px', color: '#f8fafc', fontSize: '15px', outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ color: '#94a3b8', fontSize: '13px' }}>Votre signature</label>
              {hasDrawn && (
                <button
                  onClick={clearSignature}
                  type="button"
                  style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '12px', cursor: 'pointer', padding: 0 }}
                >
                  Effacer
                </button>
              )}
            </div>
            <div style={{
              background: '#0f172a', border: hasDrawn ? '2px solid #f59e0b' : '2px dashed #334155',
              borderRadius: '8px', overflow: 'hidden', position: 'relative',
              touchAction: 'none',
            }}>
              <canvas
                ref={canvasRef}
                width={600}
                height={160}
                onMouseDown={startDraw}
                onMouseMove={draw}
                onMouseUp={stopDraw}
                onMouseLeave={stopDraw}
                onTouchStart={startDraw}
                onTouchMove={draw}
                onTouchEnd={stopDraw}
                style={{
                  width: '100%', height: '120px', cursor: 'crosshair', display: 'block',
                }}
              />
              {!hasDrawn && (
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  pointerEvents: 'none', color: '#475569', fontSize: '14px',
                }}>
                  Signez ici avec votre doigt ou souris
                </div>
              )}
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', marginBottom: '16px' }}>
            <input
              type="checkbox"
              checked={accepted}
              onChange={e => setAccepted(e.target.checked)}
              style={{ marginTop: '3px', accentColor: '#f59e0b', width: '18px', height: '18px', flexShrink: 0 }}
            />
            <span style={{ color: '#94a3b8', fontSize: '13px', lineHeight: 1.5 }}>
              J&apos;ai lu et j&apos;accepte les conditions du contrat ci-dessus.
            </span>
          </label>

          <button
            onClick={handleSign}
            disabled={signing || !signatureNom.trim() || !accepted || !hasDrawn}
            style={{
              width: '100%', padding: '14px',
              background: signatureNom.trim() && accepted && hasDrawn ? '#f59e0b' : '#475569',
              color: signatureNom.trim() && accepted && hasDrawn ? '#0f172a' : '#94a3b8',
              border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 700,
              cursor: signatureNom.trim() && accepted && hasDrawn ? 'pointer' : 'not-allowed',
              opacity: signing ? 0.6 : 1,
            }}
          >
            {signing ? 'Signature en cours...' : 'Signer le contrat'}
          </button>
        </div>

        <p style={{ textAlign: 'center', color: '#64748b', fontSize: '12px' }}>
          Devis #{quote.id} — {formatDate(quote.created_at)}<br/>
          Novus Epoxy — Planchers epoxy haut de gamme — Quebec
        </p>
      </div>
    </div>
  );
}
