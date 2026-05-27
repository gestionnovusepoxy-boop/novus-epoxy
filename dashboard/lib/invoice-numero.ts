/**
 * lib/invoice-numero.ts — Shared invoice-number generation + race-safe INSERT.
 *
 * Why this exists:
 *   Multiple call sites (POST /api/invoices, POST /api/quotes/[id]/confirm-deposit,
 *   GET /api/cron/deposit-watch, lib/ensure-invoice.ts) all minted invoice numbers
 *   via `SELECT MAX(numero) -> +1 -> INSERT` with no UNIQUE constraint. Concurrent
 *   calls could silently produce duplicate NE-YYYY-NNN.
 *
 * Fix:
 *   1. Migration 031 adds UNIQUE (numero).
 *   2. `nextInvoiceNumero()` centralizes the prefix/sequence logic.
 *   3. `insertInvoiceWithRetry()` retries on 23505 (UNIQUE_VIOLATION) so that the
 *      loser of a race re-computes and inserts again instead of crashing.
 *
 * Padding: kept configurable (`digits`) — historical call sites used 3 OR 4
 * digits and we preserve each caller's behavior to avoid changing how new
 * numbers look downstream.
 */
import { query } from '@/lib/db';

export interface NextInvoiceNumeroOptions {
  /** Year for the prefix. Defaults to the current year. */
  year?: number;
  /** Zero-padding width for the sequence. Defaults to 4 (e.g. NE-2026-0007). */
  digits?: number;
}

/**
 * Compute the next invoice numero of the form `NE-YYYY-NNNN` (or NNN if
 * `digits=3`) by reading the current max for the prefix and adding 1.
 *
 * NOTE: This value can collide if two callers run simultaneously. Always pair
 * with `insertInvoiceWithRetry` (or your own 23505-retry loop) so the loser of
 * the race re-mints and retries.
 */
export async function nextInvoiceNumero(options: NextInvoiceNumeroOptions = {}): Promise<string> {
  const year = options.year ?? new Date().getFullYear();
  const digits = options.digits ?? 4;
  const prefix = `NE-${year}-`;

  const lastRows = await query(
    `SELECT numero FROM invoices WHERE numero LIKE $1 ORDER BY numero DESC LIMIT 1`,
    [`${prefix}%`],
  );

  let nextNum = 1;
  if (lastRows[0]) {
    const parts = String(lastRows[0].numero).split('-');
    const parsed = parseInt(parts[parts.length - 1] ?? '0', 10);
    if (!Number.isNaN(parsed)) nextNum = parsed + 1;
  }
  return `${prefix}${String(nextNum).padStart(digits, '0')}`;
}

/**
 * Run an INSERT that uses a freshly-minted invoice numero, retrying up to
 * `maxAttempts` times if the UNIQUE constraint fires (Postgres SQLSTATE 23505).
 *
 * Usage:
 *   const inv = await insertInvoiceWithRetry({ digits: 4 }, async (numero) => {
 *     const rows = await query(
 *       `INSERT INTO invoices (numero, ...) VALUES ($1, ...) RETURNING id`,
 *       [numero, ...]
 *     );
 *     return rows[0];
 *   });
 *
 * The callback receives the candidate numero. It MUST run an INSERT that
 * actually uses that numero so the UNIQUE check happens on the real row.
 */
export async function insertInvoiceWithRetry<T>(
  options: NextInvoiceNumeroOptions & { maxAttempts?: number },
  insert: (numero: string) => Promise<T>,
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 5;

  let lastError: unknown = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const numero = await nextInvoiceNumero(options);
    try {
      return await insert(numero);
    } catch (e: unknown) {
      lastError = e;
      const code = (e as { code?: string })?.code;
      // 23505 = unique_violation. Anything else: rethrow immediately.
      if (code !== '23505') throw e;
      // Otherwise loop and re-mint a new candidate number.
    }
  }
  throw lastError ?? new Error('insertInvoiceWithRetry: exhausted attempts');
}
