'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface AdDraft {
  id: number;
  service: string;
  headline: string;
  primary_text: string;
  image_url: string;
  image_source: string;
  daily_budget_usd: string;
  duration_days: number;
  statut: string;
  approved_at: string | null;
  launched_at: string | null;
  meta_campaign_id: string | null;
  meta_ad_id: string | null;
  spend_usd: string | null;
  impressions: number | null;
  clicks: number | null;
  leads_generated: number | null;
  created_at: string;
  error: string | null;
}

interface ApiResponse {
  drafts: AdDraft[];
  summary: {
    total_drafts: number;
    by_statut: Record<string, number>;
    by_service: Record<string, number>;
    total_spend_usd: number;
    total_impressions: number;
    total_clicks: number;
    total_leads: number;
  };
  recent_spend: Array<{
    date_day: string;
    spend_cad: string;
    impressions: number;
    clicks: number;
    leads: number;
  }>;
}

const STATUT_BADGE: Record<string, string> = {
  brouillon: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
  approve: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  lance: 'bg-green-500/20 text-green-300 border-green-500/30',
  rejete: 'bg-red-500/20 text-red-300 border-red-500/30',
  remplacee: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  erreur: 'bg-red-500/20 text-red-300 border-red-500/30',
};

const SERVICE_LABELS: Record<string, string> = {
  flake: 'Flocon (Flake)', metallique: 'Métallique', couleur_unie: 'Couleur unie',
  quartz: 'Quartz', commercial: 'Commercial', antiderapant: 'Antidérapant', meulage: 'Meulage', vinyl_click: 'Vinyl Click',
};

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('fr-CA', { dateStyle: 'short', timeStyle: 'short' });
}

function fmtMoney(v: string | number | null) {
  return Number(v ?? 0).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' });
}

export default function PubsPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/ads/list')
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-8 text-slate-400">Chargement...</div>;
  if (!data) return <div className="p-8 text-red-400">Erreur de chargement</div>;

  const { drafts, summary, recent_spend } = data;
  const active = drafts.filter(d => d.statut === 'lance');

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-white">📢 Pubs Facebook</h1>
          <p className="text-sm text-slate-400 mt-1">{summary.total_drafts} drafts · {active.length} actives</p>
        </div>
        <a href="https://business.facebook.com/adsmanager/manage/campaigns?act=250180039560083" target="_blank" rel="noopener" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-white text-sm font-medium">
          📊 Ouvrir Ads Manager
        </a>
      </div>

      {/* KPI summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
          <div className="text-xs text-slate-500 uppercase">Spend total</div>
          <div className="text-2xl font-bold text-amber-400 mt-1">{fmtMoney(summary.total_spend_usd)}</div>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
          <div className="text-xs text-slate-500 uppercase">Impressions</div>
          <div className="text-2xl font-bold text-white mt-1">{summary.total_impressions.toLocaleString('fr-CA')}</div>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
          <div className="text-xs text-slate-500 uppercase">Clics</div>
          <div className="text-2xl font-bold text-white mt-1">{summary.total_clicks.toLocaleString('fr-CA')}</div>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
          <div className="text-xs text-slate-500 uppercase">Leads générés</div>
          <div className="text-2xl font-bold text-green-400 mt-1">{summary.total_leads}</div>
        </div>
      </div>

      {/* Spend 7 derniers jours */}
      {recent_spend.length > 0 && (
        <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
          <h3 className="text-sm uppercase text-slate-400 mb-3">Spend 7 derniers jours</h3>
          <div className="grid grid-cols-7 gap-2">
            {recent_spend.map(d => (
              <div key={d.date_day} className="text-center">
                <div className="text-xs text-slate-500">{new Date(d.date_day).toLocaleDateString('fr-CA', { weekday: 'short' })}</div>
                <div className="text-amber-400 font-semibold text-sm">{fmtMoney(d.spend_cad)}</div>
                <div className="text-xs text-slate-500">{d.leads ?? 0} leads</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Liste de tous les drafts */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-3">Toutes les pubs</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {drafts.map(d => (
            <div key={d.id} className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden">
              {d.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={d.image_url} alt="" className="w-full h-48 object-cover" />
              )}
              <div className="p-4 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">#{d.id}</span>
                    <span className="text-sm text-amber-400">{SERVICE_LABELS[d.service] ?? d.service}</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs border ${STATUT_BADGE[d.statut] ?? 'bg-slate-500/20 text-slate-300'}`}>{d.statut}</span>
                </div>
                <h3 className="text-white font-semibold text-base">{d.headline}</h3>
                <p className="text-slate-400 text-xs line-clamp-3 whitespace-pre-wrap">{d.primary_text}</p>

                <div className="flex items-center gap-3 text-xs text-slate-500 pt-1">
                  <span>💰 {fmtMoney(Number(d.daily_budget_usd))} / j × {d.duration_days}j</span>
                  <span>·</span>
                  <span>📸 {d.image_source === 'sage' ? 'Sage/uploaded' : d.image_source === 'llm' ? 'IA' : d.image_source}</span>
                </div>

                {d.statut === 'lance' && (
                  <div className="grid grid-cols-4 gap-2 pt-2 border-t border-slate-700">
                    <div>
                      <div className="text-xs text-slate-500">Spend</div>
                      <div className="text-sm text-amber-400 font-semibold">{fmtMoney(d.spend_usd)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Impressions</div>
                      <div className="text-sm text-white">{(d.impressions ?? 0).toLocaleString('fr-CA')}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Clics</div>
                      <div className="text-sm text-white">{d.clicks ?? 0}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Leads</div>
                      <div className="text-sm text-green-400 font-semibold">{d.leads_generated ?? 0}</div>
                    </div>
                  </div>
                )}

                {d.error && (
                  <div className="text-xs text-red-400 bg-red-500/10 p-2 rounded border border-red-500/30">
                    ❌ {d.error.slice(0, 200)}
                  </div>
                )}

                {d.meta_campaign_id && (
                  <a
                    href={`https://business.facebook.com/adsmanager/manage/campaigns?act=250180039560083&selected_campaign_ids=${d.meta_campaign_id}`}
                    target="_blank" rel="noopener"
                    className="block w-full text-center px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-sm text-white"
                  >
                    📊 Voir dans Ads Manager
                  </a>
                )}

                <div className="text-xs text-slate-600 pt-1">Créée {fmtDate(d.created_at)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
