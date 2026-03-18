'use client';

import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { StatsResponse } from '@/lib/api';

interface Props {
  data: StatsResponse['serie_revenus'];
}

export function RevenusChart({ data }: Props) {
  const formatted = data.map(d => ({
    ...d,
    revenus: Number(d.revenus),
    date: new Intl.DateTimeFormat('fr-CA', { month: 'short', day: 'numeric' }).format(new Date(d.date)),
  }));

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
      <h3 className="text-white font-semibold mb-4">Revenus</h3>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={formatted} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
          <defs>
            <linearGradient id="revenusGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 12 }} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} tickFormatter={v => `${v}$`} />
          <Tooltip
            contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: 8 }}
            labelStyle={{ color: '#f8fafc' }}
            formatter={(value) => [`${Number(value).toLocaleString('fr-CA')} $`, 'Revenus']}
          />
          <Area type="monotone" dataKey="revenus" stroke="#10b981" strokeWidth={2} fill="url(#revenusGradient)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
