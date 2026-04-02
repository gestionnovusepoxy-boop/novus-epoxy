import { neon } from '@neondatabase/serverless';

let cachedFn: ReturnType<typeof neon> | null = null;

function getDb() {
  if (!cachedFn) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL manquant');
    cachedFn = neon(url);
  }
  return cachedFn;
}

export function query(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const fn = getDb();
  return fn.query(sql, params) as Promise<Record<string, unknown>[]>;
}

export { query as db };
