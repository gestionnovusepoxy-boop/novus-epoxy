'use client';

import { useState, useCallback } from 'react';
import { PollingProvider } from '@/components/polling-provider';

/* ── Types ─────────────────────────────────────────────── */

type Action = 'prospection' | 'campagne' | 'analyse';

interface HistoryItem {
  id: string;
  action: Action | 'offre_service';
  details: string;
  result: string;
  created_at: string;
}

interface Recipient {
  email: string;
  prenom: string;
  entreprise: string;
}

const ACTIONS: { value: Action; label: string; desc: string; icon: React.ReactNode; placeholder: string }[] = [
  {
    value: 'prospection',
    label: 'Prospection',
    desc: 'Generer des messages d\'outreach personnalises',
    placeholder: 'Decrivez votre cible... Ex: Proprietaires de maisons neuves a Aylmer, garages doubles',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-8 h-8">
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    ),
  },
  {
    value: 'campagne',
    label: 'Campagne',
    desc: 'Creer une strategie de campagne complete',
    placeholder: 'Decrivez votre objectif... Ex: 10 nouveaux clients ce mois dans Gatineau',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-8 h-8">
        <path d="M3 11l6-4v16l-6-4V11z" />
        <path d="M9 7l12-4v18l-12-4" />
        <line x1="9" y1="7" x2="9" y2="21" />
      </svg>
    ),
  },
  {
    value: 'analyse',
    label: 'Analyse',
    desc: 'Analyser un marche ou territoire',
    placeholder: 'Quel territoire analyser? Ex: Secteur Hull, marche commercial',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-8 h-8">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
];

/* ── Inner component (needs polling context) ───────────── */

function LeadHunterInner({ history, setHistory }: {
  history: HistoryItem[];
  setHistory: React.Dispatch<React.SetStateAction<HistoryItem[]>>;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const [details, setDetails] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Offre de service state
  const [showOffer, setShowOffer] = useState(false);
  const [offerPreview, setOfferPreview] = useState(false);
  const [recipients, setRecipients] = useState<Recipient[]>([{ email: '', prenom: '', entreprise: '' }]);
  const [sendingOffer, setSendingOffer] = useState(false);
  const [offerResult, setOfferResult] = useState<{ sent: number; total: number } | null>(null);

  const selected = ACTIONS.find(a => a.value === action);

  async function generate() {
    if (!action || !details.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/leads/hunter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, details }),
      });
      const json = await res.json();
      if (json.result) {
        setResult(json.result);
        if (json.id) {
          setHistory(prev => [{
            id: json.id,
            action,
            details,
            result: json.result,
            created_at: new Date().toISOString(),
          }, ...prev]);
        }
      }
    } catch {
      setResult('Erreur lors de la generation. Reessayez.');
    }
    setLoading(false);
  }

  function copyResult() {
    if (!result) return;
    navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function actionBadge(a: string) {
    const colors: Record<string, string> = {
      prospection: 'bg-amber-500/20 text-amber-400',
      campagne: 'bg-blue-500/20 text-blue-400',
      analyse: 'bg-emerald-500/20 text-emerald-400',
      offre_service: 'bg-purple-500/20 text-purple-400',
    };
    return colors[a] ?? 'bg-slate-700 text-slate-300';
  }

  function addRecipient() {
    setRecipients(prev => [...prev, { email: '', prenom: '', entreprise: '' }]);
  }

  function removeRecipient(idx: number) {
    setRecipients(prev => prev.filter((_, i) => i !== idx));
  }

  function updateRecipient(idx: number, field: keyof Recipient, value: string) {
    setRecipients(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  }

  async function sendOffer() {
    const valid = recipients.filter(r => r.email.trim() && r.prenom.trim());
    if (valid.length === 0) return;

    if (!confirm(`Envoyer l'offre de service a ${valid.length} destinataire(s) ?`)) return;

    setSendingOffer(true);
    setOfferResult(null);
    try {
      const res = await fetch('/api/leads/offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipients: valid }),
      });
      const json = await res.json();
      setOfferResult({ sent: json.sent, total: json.total });
    } catch {
      setOfferResult({ sent: 0, total: valid.length });
    }
    setSendingOffer(false);
  }

  const validCount = recipients.filter(r => r.email.trim() && r.prenom.trim()).length;

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-white">Lead Hunter</h2>
        <p className="text-slate-400 text-sm mt-1">Agent de prospection IA</p>
      </div>

      {/* Action selector */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {ACTIONS.map(a => (
          <button
            key={a.value}
            onClick={() => { setAction(a.value); setResult(null); setShowOffer(false); }}
            className={`group relative bg-slate-800 border rounded-xl p-5 text-left transition-all duration-200 hover:bg-slate-700/50 hover:border-amber-500/50 ${
              action === a.value && !showOffer
                ? 'border-amber-500 ring-1 ring-amber-500/30'
                : 'border-slate-700'
            }`}
          >
            <div className={`mb-3 transition ${action === a.value && !showOffer ? 'text-amber-400' : 'text-slate-400 group-hover:text-amber-400'}`}>
              {a.icon}
            </div>
            <h3 className="text-white font-semibold text-lg">{a.label}</h3>
            <p className="text-slate-400 text-sm mt-1">{a.desc}</p>
          </button>
        ))}
      </div>

      {/* Offre de service card */}
      <div
        onClick={() => { setShowOffer(!showOffer); setAction(null); setResult(null); }}
        className={`bg-slate-800 border rounded-xl p-5 cursor-pointer transition-all duration-200 hover:bg-slate-700/50 hover:border-purple-500/50 ${
          showOffer ? 'border-purple-500 ring-1 ring-purple-500/30' : 'border-slate-700'
        }`}
      >
        <div className="flex items-center gap-4">
          <div className={`transition ${showOffer ? 'text-purple-400' : 'text-slate-400'}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-8 h-8">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </div>
          <div>
            <h3 className="text-white font-semibold text-lg">Offre de service</h3>
            <p className="text-slate-400 text-sm mt-1">Envoyer l&apos;offre de partenariat par email (envoi manuel seulement)</p>
          </div>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className={`w-5 h-5 text-slate-500 ml-auto transition-transform ${showOffer ? 'rotate-180' : ''}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>

      {/* Offre de service panel */}
      {showOffer && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-5">
          {/* Preview toggle */}
          <div className="flex items-center justify-between">
            <h3 className="text-white font-semibold">Destinataires</h3>
            <button
              onClick={() => setOfferPreview(!offerPreview)}
              className="text-xs bg-purple-500/20 text-purple-400 px-3 py-1.5 rounded hover:bg-purple-500/30 transition"
            >
              {offerPreview ? 'Masquer apercu' : 'Voir apercu'}
            </button>
          </div>

          {/* Preview */}
          {offerPreview && (
            <div className="border border-slate-600 rounded-lg overflow-hidden">
              <iframe
                srcDoc={`<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;font-family:'Segoe UI',Arial,sans-serif;background:#f5f5f5;color:#1a1a1a;line-height:1.6;"><div style="max-width:640px;margin:0 auto;background:#fff;"><div style="background:linear-gradient(135deg,#111827,#1e3a5f);padding:40px;text-align:center;"><h1 style="color:#fff;font-size:28px;margin:0;">NOVUS EPOXY</h1><p style="color:#94a3b8;font-size:14px;margin:6px 0 0;">Planchers haut de gamme au Québec</p></div><div style="height:4px;background:linear-gradient(90deg,#d4a853,#f0c674,#d4a853);"></div><div style="padding:40px;"><p style="font-size:16px;">Bonjour <strong>[Prénom]</strong>,</p><p style="font-size:15px;color:#374151;margin:20px 0 30px;">Je me présente, <strong>Luca Hayes</strong>, copropriétaire de Novus Epoxy. On travaille déjà avec plusieurs entrepreneurs en construction et rénovation, et on cherche à bâtir des <strong>partenariats solides</strong> avec des entreprises comme la vôtre.</p><h2 style="font-size:18px;border-bottom:2px solid #d4a853;display:inline-block;padding-bottom:8px;">Nos services</h2><p style="margin-top:16px;">Résidentiel | Commercial | Industriel | Antidérapant</p><p style="margin-top:12px;"><strong>Service clé en main</strong> — soumission rapide, installation professionnelle, garantie 10 ans incluse.</p><div style="background:linear-gradient(135deg,#111827,#1e3a5f);border-radius:12px;padding:30px;margin:30px 0;color:#fff;"><h2 style="color:#f0c674;font-size:20px;margin:0 0 18px;">Programme Partenaire</h2><p>✓ Commission de 5% sur chaque projet référé</p><p>✓ Prix partenaire préférentiel</p><p>✓ Priorité de planification</p><p>✓ Soumission en 24h</p></div><div style="text-align:center;margin:30px 0;"><a href="tel:+15813075983" style="display:inline-block;background:#d4a853;color:#111827;padding:16px 40px;border-radius:8px;font-weight:700;text-decoration:none;">Parlons-en → 581-307-5983</a></div><div style="border-top:1px solid #e2e8f0;padding-top:25px;margin-top:30px;"><strong>Luca Hayes</strong><br><span style="color:#64748b;">Copropriétaire — Novus Epoxy</span><br>581-307-5983 | gestionnovusepoxy@gmail.com | novusepoxy.ca</div></div></div></body></html>`}
                className="w-full h-[500px] bg-white rounded"
                title="Apercu offre de service"
              />
            </div>
          )}

          {/* Recipients list */}
          <div className="space-y-3">
            {recipients.map((r, idx) => (
              <div key={idx} className="flex gap-2 items-start">
                <div className="flex-1 grid grid-cols-3 gap-2">
                  <input
                    type="text"
                    placeholder="Prenom"
                    value={r.prenom}
                    onChange={e => updateRecipient(idx, 'prenom', e.target.value)}
                    className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-purple-500"
                  />
                  <input
                    type="email"
                    placeholder="Email"
                    value={r.email}
                    onChange={e => updateRecipient(idx, 'email', e.target.value)}
                    className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-purple-500"
                  />
                  <input
                    type="text"
                    placeholder="Entreprise (optionnel)"
                    value={r.entreprise}
                    onChange={e => updateRecipient(idx, 'entreprise', e.target.value)}
                    className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-purple-500"
                  />
                </div>
                {recipients.length > 1 && (
                  <button
                    onClick={() => removeRecipient(idx)}
                    className="text-slate-500 hover:text-red-400 p-2.5 transition"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>

          <button
            onClick={addRecipient}
            className="text-sm text-slate-400 hover:text-purple-400 transition flex items-center gap-1"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Ajouter un destinataire
          </button>

          {/* Send button */}
          <div className="flex items-center gap-4 pt-2">
            <button
              onClick={sendOffer}
              disabled={sendingOffer || validCount === 0}
              className="bg-purple-600 text-white font-bold px-6 py-3 rounded-lg hover:bg-purple-500 transition disabled:opacity-50 flex items-center gap-2"
            >
              {sendingOffer ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                    <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="opacity-75" />
                  </svg>
                  Envoi en cours...
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                  Envoyer l&apos;offre ({validCount})
                </>
              )}
            </button>
            <span className="text-xs text-slate-500">
              Envoi manuel seulement — jamais automatique
            </span>
          </div>

          {/* Result */}
          {offerResult && (
            <div className={`p-4 rounded-lg text-sm ${
              offerResult.sent === offerResult.total
                ? 'bg-emerald-500/20 text-emerald-400'
                : offerResult.sent > 0
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'bg-red-500/20 text-red-400'
            }`}>
              {offerResult.sent}/{offerResult.total} offre(s) envoyee(s) avec succes
            </div>
          )}
        </div>
      )}

      {/* Details textarea + Generate */}
      {action && !showOffer && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4">
          <textarea
            value={details}
            onChange={e => setDetails(e.target.value)}
            placeholder={selected?.placeholder}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500 resize-none"
            rows={4}
          />
          <button
            onClick={generate}
            disabled={loading || !details.trim()}
            className="bg-amber-500 text-slate-900 font-bold px-6 py-3 rounded-lg hover:bg-amber-400 transition disabled:opacity-50 flex items-center gap-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                  <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="opacity-75" />
                </svg>
                Generation en cours...
              </>
            ) : 'Generer'}
          </button>
        </div>
      )}

      {/* Result display */}
      {result && !showOffer && (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className={`text-xs px-2 py-1 rounded font-medium ${actionBadge(action!)}`}>
              {selected?.label}
            </span>
            <div className="flex gap-2">
              <button
                onClick={copyResult}
                className="text-xs bg-slate-700 text-slate-300 px-3 py-1.5 rounded hover:bg-slate-600 transition"
              >
                {copied ? 'Copie!' : 'Copier'}
              </button>
              <button
                onClick={async () => {
                  try {
                    await fetch('/api/leads/hunter', {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action, details, result }),
                    });
                  } catch { /* ignore */ }
                }}
                className="text-xs bg-amber-500/20 text-amber-400 px-3 py-1.5 rounded hover:bg-amber-500/30 transition"
              >
                Sauvegarder
              </button>
            </div>
          </div>
          <div className="text-white text-sm leading-relaxed whitespace-pre-wrap">
            {result}
          </div>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-white">Historique</h3>
          <div className="space-y-2">
            {history.map(item => (
              <div key={item.id} className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
                <button
                  onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                  className="w-full p-4 text-left flex items-center gap-3 hover:bg-slate-700/50 transition"
                >
                  <span className={`text-xs px-2 py-1 rounded font-medium shrink-0 ${actionBadge(item.action)}`}>
                    {item.action === 'offre_service' ? 'Offre' : item.action.charAt(0).toUpperCase() + item.action.slice(1)}
                  </span>
                  <span className="text-slate-300 text-sm truncate flex-1">
                    {item.details.length > 100 ? item.details.slice(0, 100) + '...' : item.details}
                  </span>
                  <span className="text-slate-500 text-xs shrink-0">
                    {new Date(item.created_at).toLocaleDateString('fr-CA')}
                  </span>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ${expandedId === item.id ? 'rotate-180' : ''}`}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {expandedId === item.id && (
                  <div className="px-4 pb-4 border-t border-slate-700 pt-3">
                    <p className="text-white text-sm leading-relaxed whitespace-pre-wrap">{item.result}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Page wrapper with polling ─────────────────────────── */

export default function LeadHunterPage() {
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/leads/hunter');
      const json = await res.json();
      if (Array.isArray(json.items)) {
        setHistory(json.items);
      }
    } catch { /* ignore */ }
  }, []);

  return (
    <PollingProvider onRefresh={fetchHistory} intervalMs={60_000}>
      <LeadHunterInner history={history} setHistory={setHistory} />
    </PollingProvider>
  );
}
