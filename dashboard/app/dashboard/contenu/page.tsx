'use client';

import { useState } from 'react';

const TYPES = [
  { value: 'projet', label: 'Projet recent', icon: '🏗️' },
  { value: 'conseil', label: 'Conseil entretien', icon: '💡' },
  { value: 'promo', label: 'Promotion', icon: '🎉' },
  { value: 'temoignage', label: 'Temoignage client', icon: '⭐' },
  { value: 'educatif', label: 'Educatif', icon: '📚' },
];

interface GeneratedContent {
  post: string;
  hashtags: string;
  type: string;
  image_suggestion: string;
}

export default function ContenuPage() {
  const [type, setType] = useState('conseil');
  const [details, setDetails] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<GeneratedContent[]>([]);
  const [copied, setCopied] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/content/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, details }),
      });
      const json = await res.json();
      if (json.content) {
        setResults(prev => [json.content, ...prev]);
      } else {
        setError(json.error ?? 'Erreur lors de la generation');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion');
    }
    setLoading(false);
  }

  function copyPost(index: number) {
    const r = results[index];
    const text = `${r.post}\n\n${r.hashtags}`;
    navigator.clipboard.writeText(text);
    setCopied(index);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-2xl font-bold text-white">Contenu Marketing</h2>
      <p className="text-slate-400 text-sm">Genere des posts Facebook/Instagram avec l&apos;IA</p>

      {/* Generator */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap gap-2">
          {TYPES.map(t => (
            <button key={t.value} onClick={() => setType(t.value)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                type === t.value
                  ? 'bg-amber-500 text-slate-900'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        <textarea
          value={details}
          onChange={e => setDetails(e.target.value)}
          placeholder="Details optionnels (ex: garage double 600pi2, couleur Nightfall, client tres satisfait...)"
          className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white text-sm placeholder-slate-500 focus:outline-none focus:border-amber-500 resize-none"
          rows={3}
        />

        <button onClick={generate} disabled={loading}
          className="bg-amber-500 text-slate-900 font-bold px-6 py-3 rounded-lg hover:bg-amber-400 transition disabled:opacity-50">
          {loading ? 'Generation en cours...' : 'Generer un post'}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Results */}
      <div className="space-y-4">
        {results.map((r, i) => (
          <div key={i} className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-1 rounded font-medium">
                {TYPES.find(t => t.value === r.type)?.icon} {TYPES.find(t => t.value === r.type)?.label ?? r.type}
              </span>
              <button onClick={() => copyPost(i)}
                className="text-xs bg-slate-700 text-slate-300 px-3 py-1.5 rounded hover:bg-slate-600 transition">
                {copied === i ? 'Copie!' : 'Copier'}
              </button>
            </div>

            <p className="text-white text-sm leading-relaxed whitespace-pre-wrap">{r.post}</p>

            {r.hashtags && (
              <p className="text-amber-400 text-xs">{r.hashtags}</p>
            )}

            {r.image_suggestion && (
              <div className="bg-slate-700/50 rounded-lg p-3">
                <p className="text-slate-400 text-xs"><span className="text-slate-500 font-medium">Image suggeree:</span> {r.image_suggestion}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
