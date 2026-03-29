'use client';

import { DonutChart, BarList } from '@tremor/react';
import type { PipelineItem } from '@/lib/api';

// --- Pipeline DonutChart ---

const STATUT_LABEL: Record<string, string> = {
  brouillon: 'Brouillon',
  en_attente: 'En attente',
  approuve: 'Approuvé',
  envoye: 'Envoyé',
  depot_paye: 'Dépôt payé',
  planifie: 'Planifié',
  complete: 'Complété',
  refuse: 'Refusé',
};

const STATUT_TREMOR_COLOR: Record<string, string> = {
  brouillon: 'slate',
  en_attente: 'amber',
  approuve: 'blue',
  envoye: 'cyan',
  depot_paye: 'emerald',
  planifie: 'violet',
  complete: 'green',
  refuse: 'red',
};

interface PipelineDonutProps {
  pipeline: PipelineItem[];
}

export function PipelineDonut({ pipeline }: PipelineDonutProps) {
  const data = pipeline.map(p => ({
    name: STATUT_LABEL[p.statut] ?? p.statut,
    value: p.count,
    color: STATUT_TREMOR_COLOR[p.statut] ?? 'slate',
  }));

  const total = pipeline.reduce((sum, p) => sum + p.count, 0);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
      <h3 className="text-white font-semibold mb-4">Pipeline devis</h3>
      {total === 0 ? (
        <p className="text-slate-500 text-sm">Aucun devis</p>
      ) : (
        <div className="flex items-center gap-6">
          <div className="w-48 h-48 flex-shrink-0">
            <DonutChart
              data={data}
              category="value"
              index="name"
              colors={pipeline.map(p => STATUT_TREMOR_COLOR[p.statut] ?? 'slate')}
              showLabel={true}
              label={`${total} devis`}
              variant="donut"
              className="h-48"
            />
          </div>
          <div className="space-y-2 flex-1 min-w-0">
            {data.map(d => (
              <div key={d.name} className="flex items-center justify-between text-sm">
                <span className="text-slate-300 truncate">{d.name}</span>
                <span className="text-white font-medium ml-2">{d.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Top Pages BarList ---

interface TopPagesProps {
  pages: { url_path: string; vues: number }[];
}

export function TopPagesBar({ pages }: TopPagesProps) {
  if (!pages || pages.length === 0) return null;

  const data = pages.slice(0, 8).map(p => ({
    name: p.url_path === '/' ? 'Accueil' : p.url_path,
    value: p.vues,
  }));

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
      <h3 className="text-white font-semibold mb-4">Pages les plus visitees</h3>
      <BarList
        data={data}
        color="amber"
        className="text-slate-300"
      />
    </div>
  );
}
