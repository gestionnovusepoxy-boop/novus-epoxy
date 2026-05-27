import { neon, Pool, type PoolClient } from '@neondatabase/serverless';

let cachedFn: ReturnType<typeof neon> | null = null;
let cachedPool: Pool | null = null;

function getDb() {
  if (!cachedFn) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL manquant');
    cachedFn = neon(url);
  }
  return cachedFn;
}

function getPool(): Pool {
  if (!cachedPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL manquant');
    cachedPool = new Pool({ connectionString: url });
  }
  return cachedPool;
}

export function query(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const fn = getDb();
  return fn.query(sql, params) as Promise<Record<string, unknown>[]>;
}

export { query as db };

/**
 * Run a sequence of queries inside a PostgreSQL transaction (BEGIN/COMMIT/ROLLBACK).
 *
 * Uses @neondatabase/serverless Pool over WebSocket — the HTTP `neon()` driver
 * cannot hold a session. The callback receives a `q` function with the same
 * signature as the module-level `query()`, but bound to the transaction.
 *
 * Throws are re-thrown after rollback so callers can handle them.
 */
export async function transaction<T>(
  fn: (q: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>) => Promise<T>,
): Promise<T> {
  const client: PoolClient = await getPool().connect();
  try {
    await client.query('BEGIN');
    const q = async (sql: string, params: unknown[] = []) => {
      const res = await client.query(sql, params as unknown[]);
      return (res.rows ?? []) as Record<string, unknown>[];
    };
    const result = await fn(q);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* already rolled back */ }
    throw e;
  } finally {
    client.release();
  }
}
