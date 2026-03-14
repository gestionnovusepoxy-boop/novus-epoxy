import { formatNumber, formatVariation } from '@/lib/utils';

interface Props {
  titre:      string;
  valeur:     number;
  variation?: number;
  suffixe?:   string;
  icon?:      string;
}

export function StatsCard({ titre, valeur, variation, suffixe, icon }: Props) {
  const hausse = variation !== undefined && variation > 0;
  const baisse = variation !== undefined && variation < 0;

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-slate-400 text-sm font-medium">{titre}</span>
        {icon && <span className="text-xl">{icon}</span>}
      </div>
      <div className="flex items-end gap-3">
        <span className="text-3xl font-bold text-white">
          {formatNumber(valeur)}{suffixe}
        </span>
        {variation !== undefined && (
          <span className={`text-sm font-medium mb-1 ${hausse ? 'text-emerald-400' : baisse ? 'text-red-400' : 'text-slate-400'}`}>
            {hausse ? '↑' : baisse ? '↓' : '→'} {formatVariation(variation)}
          </span>
        )}
      </div>
    </div>
  );
}
