'use client';

import { useState, useEffect } from 'react';

const TOOLKITS = [
  { id: 'GOOGLESHEETS', label: 'Google Sheets', icon: '📊', desc: 'Exporter CRM, revenus, heures en Google Sheets' },
  { id: 'GMAIL', label: 'Gmail (Composio)', icon: '📧', desc: 'Actions Gmail avancées pour les agents IA' },
  { id: 'GOOGLECALENDAR', label: 'Google Calendar', icon: '📅', desc: 'Créer/modifier des événements via les agents' },
  { id: 'SLACK', label: 'Slack', icon: '💬', desc: 'Notifier une chaîne Slack' },
];

interface ConnectedAccount {
  id: string;
  toolkit?: string;
  appName?: string;
  status?: string;
}

export default function IntegrationsPage() {
  const [connected, setConnected] = useState<ConnectedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [reportUrl, setReportUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/composio/connect?action=status')
      .then(r => r.json())
      .then(d => { setConnected(d.connected ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const isConnected = (toolkit: string) =>
    connected.some(a =>
      (a.toolkit ?? a.appName ?? '').toUpperCase().includes(toolkit.replace('GOOGLE', ''))
    );

  async function connect(toolkit: string) {
    setConnecting(toolkit);
    try {
      const res = await fetch(`/api/composio/connect?toolkit=${toolkit}`);
      const data = await res.json() as { url?: string; error?: string };
      if (data.url) {
        window.open(data.url, '_blank');
      } else {
        alert('Erreur: ' + (data.error ?? 'impossible de générer le lien'));
      }
    } catch {
      alert('Erreur réseau');
    }
    setConnecting(null);
  }

  async function generateReport(type: string) {
    setGenerating(type);
    setReportUrl(null);
    try {
      const res = await fetch('/api/composio/sheets-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      const data = await res.json() as { url?: string; title?: string; error?: string };
      if (data.url) {
        setReportUrl(data.url);
      } else {
        alert('Erreur: ' + (data.error ?? 'rapport échoué'));
      }
    } catch {
      alert('Erreur réseau');
    }
    setGenerating(null);
  }

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-bold text-white mb-2">Intégrations</h1>
      <p className="text-slate-400 text-sm mb-8">Connecte des services externes. Une fois connecté, les agents IA peuvent les utiliser automatiquement.</p>

      {/* Toolkit connections */}
      <div className="space-y-3 mb-10">
        {loading ? (
          <p className="text-slate-500 text-sm">Chargement...</p>
        ) : (
          TOOLKITS.map(tk => {
            const ok = isConnected(tk.id);
            return (
              <div key={tk.id} className="flex items-center justify-between bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{tk.icon}</span>
                  <div>
                    <p className="text-white font-medium text-sm">{tk.label}</p>
                    <p className="text-slate-400 text-xs">{tk.desc}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {ok && <span className="text-xs text-emerald-400 font-medium">● Connecté</span>}
                  <button
                    onClick={() => connect(tk.id)}
                    disabled={connecting === tk.id}
                    className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                      ok
                        ? 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                        : 'bg-amber-500 text-black hover:bg-amber-400'
                    }`}
                  >
                    {connecting === tk.id ? '...' : ok ? 'Reconnecter' : 'Connecter'}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Reports section */}
      <h2 className="text-lg font-bold text-white mb-4">Rapports Google Sheets</h2>
      <p className="text-slate-400 text-xs mb-4">Génère un rapport et reçois le lien Google Sheets. Nécessite Google Sheets connecté.</p>

      <div className="grid grid-cols-2 gap-3 mb-4">
        {[
          { type: 'crm', label: 'Rapport CRM', icon: '👥', desc: 'Leads par source, statut, température + détail 200 derniers' },
          { type: 'revenue', label: 'Rapport Revenus', icon: '💰', desc: '24 derniers mois: devis, revenus, dépôts encaissés' },
        ].map(r => (
          <button
            key={r.type}
            onClick={() => generateReport(r.type)}
            disabled={!!generating}
            className="text-left bg-slate-800/50 border border-slate-700/50 hover:border-amber-500/40 rounded-xl p-4 transition-colors"
          >
            <p className="text-xl mb-1">{r.icon}</p>
            <p className="text-white font-medium text-sm">{r.label}</p>
            <p className="text-slate-400 text-xs mt-1">{r.desc}</p>
            {generating === r.type && <p className="text-amber-400 text-xs mt-2 animate-pulse">Génération en cours...</p>}
          </button>
        ))}
      </div>

      {reportUrl && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 flex items-center justify-between">
          <p className="text-emerald-400 text-sm font-medium">✅ Rapport prêt!</p>
          <a
            href={reportUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs bg-emerald-500 text-black font-bold px-4 py-1.5 rounded-lg hover:bg-emerald-400"
          >
            Ouvrir Google Sheets →
          </a>
        </div>
      )}

      <div className="mt-10 bg-slate-800/30 border border-slate-700/30 rounded-xl p-4">
        <p className="text-slate-400 text-xs font-medium mb-2">Commandes Telegram (groupe):</p>
        <div className="space-y-1">
          <code className="block text-amber-400 text-xs">Aria rapport crm</code>
          <code className="block text-amber-400 text-xs">Aria rapport revenus</code>
        </div>
        <p className="text-slate-500 text-xs mt-2">Aria génère le Sheet et t&apos;envoie le lien directement dans le groupe.</p>
      </div>
    </div>
  );
}
