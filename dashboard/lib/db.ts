import { neon } from '@neondatabase/serverless';

// Wrapper qui accepte une string SQL + tableau de paramètres
// (contourne la contrainte TemplateStringsArray du client Neon)
export function query(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL manquant');

  const fn = neon(url);
  // Le client Neon accepte les appels directs (string, params[]) à l'exécution
  // même si TypeScript exige TemplateStringsArray — on cast explicitement
  return (fn as unknown as (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>)(sql, params);
}
