'use client';

import { useState, useCallback } from 'react';
import { PollingProvider } from '@/components/polling-provider';

/* ── Types ─────────────────────────────────────────────── */

type Action = 'prospection' | 'campagne' | 'analyse';

interface HistoryItem {
  id: string;
  action: Action;
  details: string;
  result: string;
  created_at: string;
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
        // Prepend to local history
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

  function actionBadge(a: Action) {
    const colors: Record<Action, string> = {
      prospection: 'bg-amber-500/20 text-amber-400',
      campagne: 'bg-blue-500/20 text-blue-400',
      analyse: 'bg-emerald-500/20 text-emerald-400',
    };
    return colors[a] ?? 'bg-slate-700 text-slate-300';
  }

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
            onClick={() => { setAction(a.value); setResult(null); }}
            className={`group relative bg-slate-800 border rounded-xl p-5 text-left transition-all duration-200 hover:bg-slate-700/50 hover:border-amber-500/50 ${
              action === a.value
                ? 'border-amber-500 ring-1 ring-amber-500/30'
                : 'border-slate-700'
            }`}
          >
            <div className={`mb-3 transition ${action === a.value ? 'text-amber-400' : 'text-slate-400 group-hover:text-amber-400'}`}>
              {a.icon}
            </div>
            <h3 className="text-white font-semibold text-lg">{a.label}</h3>
            <p className="text-slate-400 text-sm mt-1">{a.desc}</p>
          </button>
        ))}
      </div>

      {/* Details textarea + Generate */}
      {action && (
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
      {result && (
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
                    {item.action.charAt(0).toUpperCase() + item.action.slice(1)}
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
