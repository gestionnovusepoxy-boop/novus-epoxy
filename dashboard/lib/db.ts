import { neon } from '@neondatabase/serverless';

// Wrapper qui accepte une string SQL + tableau de paramètres
// Utilise sql.query() au lieu du tagged template (requis depuis @neondatabase/serverless récent)
export function query(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL manquant');

  const fn = neon(url);
  return fn.query(sql, params) as Promise<Record<string, unknown>[]>;
}
