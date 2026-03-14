'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { StatsResponse } from '@/lib/api';

interface Props {
  data: StatsResponse['serie_leads'];
}

export function ConversionsChart({ data }: Props) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
      <h3 className="text-white font-semibold mb-4">Soumissions par semaine</h3>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="semaine" tick={{ fill: '#94a3b8', fontSize: 12 }} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} allowDecimals={false} />
          <Tooltip
            contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: 8 }}
            labelStyle={{ color: '#f8fafc' }}
          />
          <Bar dataKey="leads" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Soumissions" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
