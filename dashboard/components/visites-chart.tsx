'use client';

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import type { StatsResponse } from '@/lib/api';

interface Props {
  data: StatsResponse['serie_visites'];
}

export function VisitesChart({ data }: Props) {
  const formatted = data.map(d => ({
    ...d,
    date: new Intl.DateTimeFormat('fr-CA', { month: 'short', day: 'numeric' }).format(new Date(d.date)),
  }));

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
      <h3 className="text-white font-semibold mb-4">Visites quotidiennes</h3>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={formatted} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 12 }} />
          <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} />
          <Tooltip
            contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569', borderRadius: 8 }}
            labelStyle={{ color: '#f8fafc' }}
          />
          <Legend wrapperStyle={{ color: '#94a3b8', fontSize: 12 }} />
          <Line type="monotone" dataKey="visites"   stroke="#f59e0b" strokeWidth={2} dot={false} name="Visites" />
          <Line type="monotone" dataKey="visiteurs" stroke="#38bdf8" strokeWidth={2} dot={false} name="Visiteurs uniques" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
