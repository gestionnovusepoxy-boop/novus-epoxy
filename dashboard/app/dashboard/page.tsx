'use client';

import { useState, useCallback } from 'react';
import { PollingProvider } from '@/components/polling-provider';
import Link from 'next/link';

function fmt(n: number): string {
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }).format(n);
}

function fmtFull(n: number): string {
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(n);
}

const CAT_LABEL: Record<string, string> = {
  materiaux: 'Materiaux', sous_traitance: 'Sous-traitance', transport: 'Transport',
  equipement: 'Equipement', marketing: 'Marketing', loyer: 'Loyer',
  assurance: 'Assurance', admin: 'Administration', autre: 'Autre',
};

interface OverviewData {
  financier: {
    encaisse: number;
    a_recevoir: number;
    pipeline_envoye: { count: number; montant: number };
    pipeline_signe: { count: number; montant: number };
    projets_completes: { count: number; montant: number };
    depenses: number;
    salaires: number;
    heures: number;
    profit: number;
    ce_mois: number;
    mois_dernier: number;
  };
  leads: { total: number; chauds: number; tiedes: number; froids: number; actifs: number; nouveaux_7j: number };
  bookings: { jour1_date: string | null; jour2_date: string | null; statut: string; client_nom: string; type_service: string; total: number }[];
  recent: {
    quotes: { id: number; client_nom: string; total: number; statut: string; created_at: string }[];
    leads: { id: number; nom: string; telephone: string; source: string; temperature: string; created_at: string }[];
  };
  expenses_by_cat: { categorie: string; total: number }[];
  submissions: { total: number; nouveaux: number };
  lead_sources: { source: string; count: number }[];
  chatbot: { conversations: number };
  sms: { envoyes: number; recus: number };
}

/* ─── KPI Card ─── */
function KpiCard({ label, value, sub, color, href }: { label: string; value: string; sub?: string; color: string; href?: string }) {
  const card = (
    <div className={`bg-slate-800 border rounded-xl p-5 ${href ? 'hover:border-slate-500 transition cursor-pointer' : ''}`}
      style={{ borderColor: color + '30' }}>
      <p className="text-slate-400 text-xs font-medium uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color }}>{value}</p>
      {sub && <p className="text-slate-500 text-xs mt-1">{sub}</p>}
    </div>
  );
  return href ? <Link href={href}>{card}</Link> : card;
}

/* ─── Pipeline Bar ─── */
function PipelineBar({ data }: { data: OverviewData['financier'] }) {
  const total = data.encaisse + data.a_recevoir + data.pipeline_envoye.montant;
  if (total === 0) return null;
  const pctEncaisse = (data.encaisse / total) * 100;
  const pctARecevoir = (data.a_recevoir / total) * 100;
  const pctPipeline = (data.pipeline_envoye.montant / total) * 100;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">
      <h3 className="text-white font-semibold text-sm">Pipeline financier</h3>
      <div className="flex rounded-full overflow-hidden h-4">
        {pctEncaisse > 0 && <div className="bg-green-500" style={{ width: `${pctEncaisse}%` }} title={`Encaisse: ${fmt(data.encaisse)}`} />}
        {pctARecevoir > 0 && <div className="bg-amber-500" style={{ width: `${pctARecevoir}%` }} title={`A recevoir: ${fmt(data.a_recevoir)}`} />}
        {pctPipeline > 0 && <div className="bg-blue-500" style={{ width: `${pctPipeline}%` }} title={`Pipeline: ${fmt(data.pipeline_envoye.montant)}`} />}
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
          <span className="text-slate-400">Encaisse</span>
          <span className="text-white font-medium">{fmt(data.encaisse)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
          <span className="text-slate-400">A recevoir</span>
          <span className="text-white font-medium">{fmt(data.a_recevoir)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
          <span className="text-slate-400">Devis envoyes ({data.pipeline_envoye.count})</span>
          <span className="text-white font-medium">{fmt(data.pipeline_envoye.montant)}</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Expenses Donut ─── */
function ExpensesList({ data }: { data: OverviewData['expenses_by_cat'] }) {
  const total = data.reduce((s, e) => s + e.total, 0);
  if (total === 0) return null;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-semibold text-sm">Depenses par categorie</h3>
        <Link href="/dashboard/depenses" className="text-amber-400 text-xs hover:text-amber-300">Voir tout</Link>
      </div>
      <div className="space-y-2">
        {data.map(e => {
          const pct = Math.round((e.total / total) * 100);
          return (
            <div key={e.categorie} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300">{CAT_LABEL[e.categorie] || e.categorie}</span>
                <span className="text-white font-medium">{fmtFull(e.total)} ({pct}%)</span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-1.5">
                <div className="bg-amber-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
        <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-700">
          <span className="text-slate-400 font-medium">Total</span>
          <span className="text-red-400 font-bold">{fmtFull(total)}</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Main Page ─── */
function DashboardContent() {
  const [data, setData] = useState<OverviewData | null>(null);

  const loadData = useCallback(async () => {
    const res = await fetch('/api/dashboard/overview');
    if (res.ok) setData(await res.json());
  }, []);

  return (
    <PollingProvider onRefresh={loadData}>
      <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
        <h2 className="text-xl sm:text-2xl font-bold text-white">Vue d&apos;ensemble</h2>

        {!data && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3 animate-pulse">
                <div className="h-3 w-16 bg-slate-700 rounded" />
                <div className="h-8 w-24 bg-slate-700 rounded" />
              </div>
            ))}
          </div>
        )}

        {data && (
          <>
            {/* Row 1: Financial KPIs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiCard
                label="Encaisse"
                value={fmt(data.financier.encaisse)}
                sub={data.financier.ce_mois > 0 ? `${fmt(data.financier.ce_mois)} ce mois` : 'Aucun paiement ce mois'}
                color="#22c55e"
                href="/dashboard/factures"
              />
              <KpiCard
                label="A recevoir"
                value={fmt(data.financier.a_recevoir)}
                sub={data.financier.a_recevoir > 0 ? 'Soldes en attente' : 'Tout est paye'}
                color={data.financier.a_recevoir > 0 ? '#f59e0b' : '#22c55e'}
                href="/dashboard/factures"
              />
              <KpiCard
                label="Pipeline"
                value={fmt(data.financier.pipeline_envoye.montant)}
                sub={`${data.financier.pipeline_envoye.count} devis envoyes`}
                color="#3b82f6"
                href="/dashboard/devis"
              />
              <KpiCard
                label="Profit net"
                value={fmt(data.financier.profit)}
                sub={`Depenses: ${fmt(data.financier.depenses)} | Salaires: ${fmt(data.financier.salaires)}`}
                color={data.financier.profit >= 0 ? '#22c55e' : '#ef4444'}
                href="/dashboard/comptabilite"
              />
            </div>

            {/* Row 2: Pipeline bar */}
            <PipelineBar data={data.financier} />

            {/* Row 3: Leads + Operations */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Leads */}
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-white font-semibold text-sm">Leads CRM</h3>
                  <Link href="/dashboard/crm" className="text-amber-400 text-xs hover:text-amber-300">Voir CRM</Link>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2 sm:p-3 text-center">
                    <p className="text-2xl font-bold text-red-400">{data.leads.chauds}</p>
                    <p className="text-[10px] text-slate-400 uppercase mt-1">Chauds</p>
                  </div>
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-amber-400">{data.leads.tiedes}</p>
                    <p className="text-[10px] text-slate-400 uppercase mt-1">Tiedes</p>
                  </div>
                  <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-blue-400">{data.leads.froids}</p>
                    <p className="text-[10px] text-slate-400 uppercase mt-1">Froids</p>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>{data.leads.total} leads au total</span>
                  <span className="text-green-400">+{data.leads.nouveaux_7j} cette semaine</span>
                </div>
              </div>

              {/* Prochains travaux */}
              <div className="bg-slate-800 border border-slate-700 rounded-xl">
                <div className="flex items-center justify-between p-5 pb-3">
                  <h3 className="text-white font-semibold text-sm">Prochains travaux</h3>
                  <Link href="/dashboard/calendrier" className="text-amber-400 text-xs hover:text-amber-300">Calendrier</Link>
                </div>
                {data.bookings.length === 0 ? (
                  <p className="text-slate-500 text-sm px-5 pb-5">Aucun chantier planifie</p>
                ) : (
                  <div className="divide-y divide-slate-700">
                    {data.bookings.map((b, i) => (
                      <div key={i} className="flex items-center justify-between px-5 py-3">
                        <div>
                          <p className="text-white text-sm font-medium">{b.client_nom}</p>
                          <p className="text-slate-400 text-xs">{b.type_service} — {fmt(b.total)}</p>
                        </div>
                        <div className="text-right">
                          {b.jour1_date && <p className="text-slate-300 text-xs">{new Date(b.jour1_date + 'T12:00:00').toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' })}</p>}
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${b.statut === 'complete' ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'}`}>
                            {b.statut === 'complete' ? 'Termine' : 'Planifie'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Row 4: Expenses + Workforce */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ExpensesList data={data.expenses_by_cat} />

              {/* Workforce summary */}
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-white font-semibold text-sm">Main d&apos;oeuvre</h3>
                  <Link href="/dashboard/equipe" className="text-amber-400 text-xs hover:text-amber-300">Equipe</Link>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-900/50 rounded-lg p-3">
                    <p className="text-xl font-bold text-white">{data.financier.heures}h</p>
                    <p className="text-slate-400 text-xs mt-1">Heures totales</p>
                  </div>
                  <div className="bg-slate-900/50 rounded-lg p-3">
                    <p className="text-xl font-bold text-amber-400">{fmtFull(data.financier.salaires)}</p>
                    <p className="text-slate-400 text-xs mt-1">Salaires verses</p>
                  </div>
                </div>
                {data.financier.encaisse > 0 && (
                  <div className="text-xs text-slate-400">
                    Cout main d&apos;oeuvre: <span className="text-white font-medium">{Math.round((data.financier.salaires / data.financier.encaisse) * 100)}%</span> du revenu
                  </div>
                )}
              </div>
            </div>

            {/* Row 5: Recent activity */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Recent quotes */}
              <div className="bg-slate-800 border border-slate-700 rounded-xl">
                <div className="flex items-center justify-between p-5 pb-3">
                  <h3 className="text-white font-semibold text-sm">Derniers devis</h3>
                  <Link href="/dashboard/devis" className="text-amber-400 text-xs hover:text-amber-300">Voir tout</Link>
                </div>
                <div className="divide-y divide-slate-700">
                  {data.recent.quotes.map(q => (
                    <Link key={q.id} href={`/dashboard/devis/${q.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-slate-700/30 transition">
                      <div>
                        <p className="text-white text-sm font-medium">{q.client_nom}</p>
                        <p className="text-slate-400 text-xs">{q.statut}</p>
                      </div>
                      <p className="text-amber-400 text-sm font-medium">{fmtFull(q.total)}</p>
                    </Link>
                  ))}
                </div>
              </div>

              {/* Recent leads */}
              <div className="bg-slate-800 border border-slate-700 rounded-xl">
                <div className="flex items-center justify-between p-5 pb-3">
                  <h3 className="text-white font-semibold text-sm">Derniers leads</h3>
                  <Link href="/dashboard/crm" className="text-amber-400 text-xs hover:text-amber-300">Voir CRM</Link>
                </div>
                <div className="divide-y divide-slate-700">
                  {data.recent.leads.map(l => (
                    <div key={l.id} className="flex items-center justify-between px-5 py-3">
                      <div>
                        <p className="text-white text-sm font-medium">{l.nom}</p>
                        <p className="text-slate-400 text-xs">{l.telephone} — {l.source}</p>
                      </div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        l.temperature === 'chaud' ? 'bg-red-500/20 text-red-400' :
                        l.temperature === 'tiede' ? 'bg-amber-500/20 text-amber-400' :
                        'bg-blue-500/20 text-blue-400'
                      }`}>
                        {l.temperature}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Sources & Canaux */}
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-white font-semibold text-sm">Sources des leads</h3>
                <span className="text-slate-400 text-xs">{data.leads.total} leads au total</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {(() => {
                  const labels: Record<string, { name: string; icon: string; color: string }> = {
                    jason: { name: 'Import Jason', icon: '👷', color: '#f59e0b' },
                    cloud: { name: 'Facebook Ads', icon: '📘', color: '#1877f2' },
                    homestars: { name: 'HomeStars', icon: '⭐', color: '#22c55e' },
                    'google-maps': { name: 'Google Maps', icon: '📍', color: '#ef4444' },
                    houzz: { name: 'Houzz', icon: '🏠', color: '#8b5cf6' },
                    cms: { name: 'Formulaire site web', icon: '🌐', color: '#06b6d4' },
                    'site-web': { name: 'Formulaire site web', icon: '🌐', color: '#06b6d4' },
                  };
                  // Merge cms + site-web into one
                  const merged: Record<string, { name: string; icon: string; color: string; count: number }> = {};
                  for (const s of data.lead_sources) {
                    const key = s.source === 'site-web' ? 'cms' : s.source;
                    const info = labels[key] || { name: s.source, icon: '📌', color: '#64748b' };
                    if (!merged[key]) merged[key] = { ...info, count: 0 };
                    merged[key].count += s.count;
                  }
                  return Object.entries(merged).map(([key, s]) => (
                    <Link key={key} href={`/dashboard/crm?source=${key}`} className="bg-slate-900/50 border border-slate-700 rounded-lg p-3 hover:border-slate-500 transition">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{s.icon}</span>
                        <div>
                          <p className="text-white text-lg font-bold">{s.count}</p>
                          <p className="text-slate-400 text-[10px]">{s.name}</p>
                        </div>
                      </div>
                      <div className="mt-2 w-full bg-slate-700 rounded-full h-1">
                        <div className="h-1 rounded-full" style={{ width: `${Math.min(100, (s.count / data.leads.total) * 100)}%`, backgroundColor: s.color }} />
                      </div>
                    </Link>
                  ));
                })()}
              </div>

              {/* Other channels */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-700">
                <Link href="/dashboard/conversations" className="flex items-center gap-2 text-sm hover:bg-slate-700/30 rounded-lg p-2 -m-2 transition">
                  <span className="text-lg">🤖</span>
                  <div>
                    <p className="text-white font-bold">{data.chatbot.conversations}</p>
                    <p className="text-slate-400 text-[10px]">Chatbot Nova</p>
                  </div>
                </Link>
                <Link href="/dashboard/soumissions" className="flex items-center gap-2 text-sm hover:bg-slate-700/30 rounded-lg p-2 -m-2 transition">
                  <span className="text-lg">📋</span>
                  <div>
                    <p className="text-white font-bold">{data.submissions.total}</p>
                    <p className="text-slate-400 text-[10px]">Soumissions web</p>
                  </div>
                </Link>
                <Link href="/dashboard/textos" className="flex items-center gap-2 text-sm hover:bg-slate-700/30 rounded-lg p-2 -m-2 transition">
                  <span className="text-lg">📱</span>
                  <div>
                    <p className="text-white font-bold">{data.sms.envoyes}</p>
                    <p className="text-slate-400 text-[10px]">SMS envoyes</p>
                  </div>
                </Link>
                <Link href="/dashboard/textos" className="flex items-center gap-2 text-sm hover:bg-slate-700/30 rounded-lg p-2 -m-2 transition">
                  <span className="text-lg">💬</span>
                  <div>
                    <p className="text-white font-bold">{data.sms.recus}</p>
                    <p className="text-slate-400 text-[10px]">SMS recus</p>
                  </div>
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </PollingProvider>
  );
}

export default function DashboardPage() {
  return <DashboardContent />;
}
