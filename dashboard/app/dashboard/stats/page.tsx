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

function pct(a: number, b: number): string {
  if (b === 0) return '0%';
  return Math.round((a / b) * 100) + '%';
}

const SOURCE_LABELS: Record<string, string> = {
  jason: 'Import Jason', cloud: 'Facebook Ads', homestars: 'HomeStars',
  'google-maps': 'Google Maps', houzz: 'Houzz', cms: 'Site web', 'site-web': 'Site web',
};

interface StatsData {
  revenue_by_month: { mois: string; depots: number; soldes: number; total: number }[];
  quotes_by_month: { mois: string; count: number; total: number }[];
  leads_by_week: { semaine: string; count: number }[];
  source_performance: { source: string; leads: number; devis: number; revenu_potentiel: number; signes: number }[];
  funnel: { total_leads: number; contactes: number; devis_envoyes: number; signes: number; completes: number; payes: number };
  site: { visites: number; visiteurs_uniques: number; sessions: number; top_pages: { page: string; vues: number }[]; referrers: { source: string; vues: number }[] };
  emails: { total: number; envoyes: number; erreurs: number; ignores: number; by_day: { jour: string; envoyes: number; erreurs: number }[] };
  sms: { envoyes: number; recus: number };
  productivity: { nom: string; taux: number; heures: number; cout: number; projets: number; jours: number }[];
  deals: { moyen: number; min: number; max: number; total: number };
  expenses_by_month: { mois: string; total: number }[];
}

/* ─── Simple Bar ─── */
function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const w = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="w-full bg-slate-700 rounded-full h-2">
      <div className="h-2 rounded-full transition-all" style={{ width: `${w}%`, backgroundColor: color }} />
    </div>
  );
}

/* ─── Funnel Step ─── */
function FunnelStep({ label, count, total, color, isLast }: { label: string; count: number; total: number; color: string; isLast?: boolean }) {
  const w = total > 0 ? Math.max(8, (count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 text-right">
        <span className="text-slate-400 text-xs">{label}</span>
      </div>
      <div className="flex-1 flex items-center gap-2">
        <div className="h-8 rounded-lg flex items-center px-3 text-xs font-bold text-white" style={{ width: `${w}%`, backgroundColor: color, minWidth: '60px' }}>
          {count}
        </div>
        {!isLast && total > 0 && (
          <span className="text-slate-500 text-[10px]">{pct(count, total)}</span>
        )}
      </div>
    </div>
  );
}

/* ─── Mini Chart (ASCII sparkline) ─── */
function MiniChart({ data, color }: { data: number[]; color: string }) {
  if (data.length === 0) return null;
  const max = Math.max(...data, 1);
  return (
    <div className="flex items-end gap-0.5 h-8">
      {data.map((v, i) => (
        <div key={i} className="flex-1 rounded-sm min-w-[3px]" style={{ height: `${Math.max(2, (v / max) * 100)}%`, backgroundColor: color, opacity: 0.7 + (i / data.length) * 0.3 }} />
      ))}
    </div>
  );
}

/* ─── Main Page ─── */
function PageContent() {
  const [data, setData] = useState<StatsData | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/dashboard/stats');
    if (res.ok) setData(await res.json());
  }, []);

  return (
    <PollingProvider onRefresh={load}>
      <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
        <h2 className="text-xl sm:text-2xl font-bold text-white">Statistiques</h2>

        {!data && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-slate-800 border border-slate-700 rounded-xl p-5 animate-pulse">
                <div className="h-3 w-16 bg-slate-700 rounded mb-3" />
                <div className="h-8 w-24 bg-slate-700 rounded" />
              </div>
            ))}
          </div>
        )}

        {data && (
          <>
            {/* Row 1: KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                <p className="text-slate-400 text-[10px] uppercase tracking-wider">Devis crees</p>
                <p className="text-2xl font-bold text-white mt-1">{data.deals.total}</p>
                <p className="text-slate-500 text-xs mt-1">Moy: {fmtFull(data.deals.moyen)}</p>
                <MiniChart data={data.quotes_by_month.map(q => q.count)} color="#f59e0b" />
              </div>
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                <p className="text-slate-400 text-[10px] uppercase tracking-wider">Pipeline total</p>
                <p className="text-2xl font-bold text-blue-400 mt-1">{fmt(data.quotes_by_month.reduce((s, q) => s + q.total, 0))}</p>
                <p className="text-slate-500 text-xs mt-1">Max: {fmtFull(data.deals.max)}</p>
                <MiniChart data={data.quotes_by_month.map(q => q.total)} color="#3b82f6" />
              </div>
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                <p className="text-slate-400 text-[10px] uppercase tracking-wider">Taux conversion</p>
                <p className="text-2xl font-bold text-green-400 mt-1">{pct(data.funnel.signes, data.funnel.total_leads)}</p>
                <p className="text-slate-500 text-xs mt-1">{data.funnel.signes} signes / {data.funnel.total_leads} leads</p>
              </div>
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                <p className="text-slate-400 text-[10px] uppercase tracking-wider">Emails envoyes</p>
                <p className="text-2xl font-bold text-white mt-1">{data.emails.envoyes}</p>
                <p className="text-slate-500 text-xs mt-1">{data.emails.erreurs} erreurs ({pct(data.emails.erreurs, data.emails.total)})</p>
                <MiniChart data={data.emails.by_day.map(d => d.envoyes)} color="#8b5cf6" />
              </div>
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
                <p className="text-slate-400 text-[10px] uppercase tracking-wider">Site web (30j)</p>
                <p className="text-2xl font-bold text-white mt-1">{data.site.visites}</p>
                <p className="text-slate-500 text-xs mt-1">{data.site.visiteurs_uniques} visiteurs uniques</p>
              </div>
            </div>

            {/* Row 2: Revenue + Expenses by month */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">
                <h3 className="text-white font-semibold text-sm">Revenus par mois</h3>
                {data.revenue_by_month.length === 0 ? (
                  <p className="text-slate-500 text-sm">Pas assez de donnees</p>
                ) : (
                  <div className="space-y-2">
                    {data.revenue_by_month.map(r => (
                      <div key={r.mois} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-400">{r.mois}</span>
                          <span className="text-green-400 font-medium">{fmtFull(r.total)}</span>
                        </div>
                        <Bar value={r.total} max={Math.max(...data.revenue_by_month.map(x => x.total))} color="#22c55e" />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">
                <h3 className="text-white font-semibold text-sm">Devis crees par mois</h3>
                <div className="space-y-2">
                  {data.quotes_by_month.map(q => (
                    <div key={q.mois} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">{q.mois} — {q.count} devis</span>
                        <span className="text-amber-400 font-medium">{fmtFull(q.total)}</span>
                      </div>
                      <Bar value={q.total} max={Math.max(...data.quotes_by_month.map(x => x.total))} color="#f59e0b" />
                    </div>
                  ))}
                </div>
                {data.expenses_by_month.length > 0 && (
                  <>
                    <h4 className="text-slate-400 text-xs font-semibold uppercase tracking-wider pt-2 border-t border-slate-700">Depenses par mois</h4>
                    {data.expenses_by_month.map(e => (
                      <div key={e.mois} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-400">{e.mois}</span>
                          <span className="text-red-400 font-medium">{fmtFull(e.total)}</span>
                        </div>
                        <Bar value={e.total} max={Math.max(...data.expenses_by_month.map(x => x.total))} color="#ef4444" />
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>

            {/* Row 3: Conversion Funnel */}
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">
              <h3 className="text-white font-semibold text-sm">Entonnoir de conversion</h3>
              <div className="space-y-2">
                <FunnelStep label="Leads" count={data.funnel.total_leads} total={data.funnel.total_leads} color="#3b82f6" />
                <FunnelStep label="Contactes" count={data.funnel.contactes} total={data.funnel.total_leads} color="#06b6d4" />
                <FunnelStep label="Devis envoye" count={data.funnel.devis_envoyes} total={data.funnel.total_leads} color="#f59e0b" />
                <FunnelStep label="Signes" count={data.funnel.signes} total={data.funnel.total_leads} color="#22c55e" />
                <FunnelStep label="Completes" count={data.funnel.completes} total={data.funnel.total_leads} color="#10b981" />
                <FunnelStep label="Payes" count={data.funnel.payes} total={data.funnel.total_leads} color="#059669" isLast />
              </div>
              <div className="flex flex-wrap gap-4 text-xs text-slate-400 pt-2 border-t border-slate-700">
                <span>Lead → Contact: <span className="text-white font-medium">{pct(data.funnel.contactes, data.funnel.total_leads)}</span></span>
                <span>Contact → Devis: <span className="text-white font-medium">{pct(data.funnel.devis_envoyes, data.funnel.contactes || 1)}</span></span>
                <span>Devis → Signe: <span className="text-white font-medium">{pct(data.funnel.signes, data.funnel.devis_envoyes || 1)}</span></span>
                <span>Signe → Paye: <span className="text-white font-medium">{pct(data.funnel.payes, data.funnel.signes || 1)}</span></span>
              </div>
            </div>

            {/* Row 4: Source Performance + Leads by Week */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-white font-semibold text-sm">Performance par source</h3>
                  <Link href="/dashboard/crm" className="text-amber-400 text-xs">CRM</Link>
                </div>
                <div className="space-y-3">
                  {data.source_performance.map(s => {
                    const maxLeads = Math.max(...data.source_performance.map(x => x.leads));
                    return (
                      <div key={s.source} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-white font-medium">{SOURCE_LABELS[s.source] || s.source}</span>
                          <div className="flex gap-3 text-slate-400">
                            <span>{s.leads} leads</span>
                            <span>{s.devis} devis</span>
                            <span className="text-amber-400">{s.signes} signes</span>
                          </div>
                        </div>
                        <Bar value={s.leads} max={maxLeads} color="#3b82f6" />
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">
                <h3 className="text-white font-semibold text-sm">Leads par semaine</h3>
                {data.leads_by_week.length === 0 ? (
                  <p className="text-slate-500 text-sm">Pas de donnees</p>
                ) : (
                  <div className="space-y-2">
                    {data.leads_by_week.map(l => (
                      <div key={l.semaine} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-400">Sem. {l.semaine.slice(5)}</span>
                          <span className="text-white font-medium">{l.count}</span>
                        </div>
                        <Bar value={l.count} max={Math.max(...data.leads_by_week.map(x => x.count))} color="#06b6d4" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Row 5: Website + Referrers */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">
                <h3 className="text-white font-semibold text-sm">Pages populaires (30 jours)</h3>
                <div className="space-y-2">
                  {data.site.top_pages.map((p, i) => (
                    <div key={p.page} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-600 w-4">{i + 1}.</span>
                        <span className="text-slate-300 truncate max-w-[200px]">{p.page || '/'}</span>
                      </div>
                      <span className="text-white font-medium">{p.vues}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">
                <h3 className="text-white font-semibold text-sm">Sources de trafic (30 jours)</h3>
                <div className="space-y-2">
                  {data.site.referrers.map(r => (
                    <div key={r.source} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-300">{r.source}</span>
                        <span className="text-white font-medium">{r.vues} visites</span>
                      </div>
                      <Bar value={r.vues} max={Math.max(...data.site.referrers.map(x => x.vues))} color="#8b5cf6" />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Row 6: Emails + SMS */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-white font-semibold text-sm">Emails (14 derniers jours)</h3>
                  <Link href="/dashboard/emails" className="text-amber-400 text-xs">Voir tout</Link>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-green-400">{data.emails.envoyes}</p>
                    <p className="text-[10px] text-slate-400">Envoyes</p>
                  </div>
                  <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-red-400">{data.emails.erreurs}</p>
                    <p className="text-[10px] text-slate-400">Erreurs</p>
                  </div>
                  <div className="bg-slate-500/10 border border-slate-500/20 rounded-lg p-3 text-center">
                    <p className="text-xl font-bold text-slate-400">{data.emails.ignores}</p>
                    <p className="text-[10px] text-slate-400">Ignores</p>
                  </div>
                </div>
                <div className="space-y-1">
                  {data.emails.by_day.slice(-7).map(d => (
                    <div key={d.jour} className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">{d.jour.slice(5)}</span>
                      <div className="flex gap-2">
                        <span className="text-green-400">{d.envoyes} ok</span>
                        {d.erreurs > 0 && <span className="text-red-400">{d.erreurs} err</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-white font-semibold text-sm">SMS</h3>
                  <Link href="/dashboard/textos" className="text-amber-400 text-xs">Voir tout</Link>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-blue-400">{data.sms.envoyes}</p>
                    <p className="text-[10px] text-slate-400">Envoyes</p>
                  </div>
                  <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-green-400">{data.sms.recus}</p>
                    <p className="text-[10px] text-slate-400">Recus</p>
                  </div>
                </div>

                {/* Productivity */}
                <h3 className="text-white font-semibold text-sm pt-3 border-t border-slate-700">Productivite equipe</h3>
                <div className="space-y-2">
                  {data.productivity.map(p => (
                    <div key={p.nom} className="flex items-center justify-between text-xs">
                      <div>
                        <span className="text-white font-medium">{p.nom}</span>
                        <span className="text-slate-500 ml-2">{p.taux}$/h</span>
                      </div>
                      <div className="flex gap-3 text-slate-400">
                        <span className="text-white">{p.heures}h</span>
                        <span>{p.projets} projet{p.projets !== 1 ? 's' : ''}</span>
                        <span className="text-amber-400">{fmtFull(p.cout)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </PollingProvider>
  );
}

export default function StatsPage() {
  return <PageContent />;
}
