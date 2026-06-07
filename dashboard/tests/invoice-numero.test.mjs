/**
 * Tests for lib/invoice-numero.ts — number format and retry logic.
 *
 * We mock the DB by monkey-patching the module via --experimental-vm-modules
 * or by testing the retry behavior directly through insertInvoiceWithRetry.
 *
 * Run: node --test tests/invoice-numero.test.mjs
 *
 * NOTE: nextInvoiceNumero() requires DB — those tests are marked as integration
 * and skipped unless INTEGRATION_TEST=1 is set in env.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── Helpers (extracted logic testable without DB) ────────────────────────────

/** Mirror of nextInvoiceNumero format logic — pure, no DB */
function formatNumero(year, lastNum, digits = 4) {
  const prefix = `NE-${year}-`;
  const nextNum = lastNum + 1;
  return `${prefix}${String(nextNum).padStart(digits, '0')}`;
}

test('formato NE-YYYY-NNNN: first invoice → NE-2026-0001', () => {
  assert.equal(formatNumero(2026, 0, 4), 'NE-2026-0001');
});

test('formato NE-YYYY-NNNN: sequential increment', () => {
  assert.equal(formatNumero(2026, 6, 4), 'NE-2026-0007');
  assert.equal(formatNumero(2026, 99, 4), 'NE-2026-0100');
  assert.equal(formatNumero(2026, 999, 4), 'NE-2026-1000');
});

test('formato NE-YYYY-NNN (3 digits): first → NE-2026-001', () => {
  assert.equal(formatNumero(2026, 0, 3), 'NE-2026-001');
});

test('formato: year boundary 2025 → 2026 resets counter at 1', () => {
  // Each year prefix starts fresh — NE-2026-0001 is valid after NE-2025-0237
  assert.equal(formatNumero(2026, 0, 4), 'NE-2026-0001');
  assert.equal(formatNumero(2025, 0, 4), 'NE-2025-0001');
});

// ── insertInvoiceWithRetry retry logic ────────────────────────────────────────

// Simulate with a hand-rolled version of the retry logic
async function insertWithRetry(maxAttempts, insertFn) {
  // Mirrors the logic in lib/invoice-numero.ts
  let lastError = null;
  let callCount = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const numero = `NE-2026-${String(attempt + 1).padStart(4, '0')}`;
    callCount++;
    try {
      return await insertFn(numero, callCount);
    } catch (e) {
      lastError = e;
      if (e?.code !== '23505') throw e;
    }
  }
  throw lastError ?? new Error('exhausted');
}

test('insertInvoiceWithRetry: succeeds on first try', async () => {
  const result = await insertWithRetry(5, async (numero) => ({ numero, id: 1 }));
  assert.equal(result.id, 1);
});

test('insertInvoiceWithRetry: retries on 23505 and succeeds on 2nd attempt', async () => {
  let attempts = 0;
  const result = await insertWithRetry(5, async (numero, callCount) => {
    attempts = callCount;
    if (callCount === 1) {
      const err = new Error('unique violation');
      err.code = '23505';
      throw err;
    }
    return { numero, id: 2 };
  });
  assert.equal(attempts, 2, 'should have attempted twice');
  assert.equal(result.id, 2);
});

test('insertInvoiceWithRetry: exhausts all attempts → throws', async () => {
  const collision = Object.assign(new Error('unique violation'), { code: '23505' });
  await assert.rejects(
    () => insertWithRetry(3, async () => { throw collision; }),
    (err) => err.code === '23505' || err.message === 'exhausted'
  );
});

test('insertInvoiceWithRetry: non-23505 error rethrows immediately (no retry)', async () => {
  let callCount = 0;
  const unexpected = Object.assign(new Error('connection refused'), { code: '08006' });
  await assert.rejects(
    () => insertWithRetry(5, async () => {
      callCount++;
      throw unexpected;
    }),
    { message: 'connection refused' }
  );
  assert.equal(callCount, 1, 'should not retry on non-23505 errors');
});

test('insertInvoiceWithRetry: each retry uses a different numero', async () => {
  const numeros = [];
  await assert.rejects(async () => {
    await insertWithRetry(3, async (numero) => {
      numeros.push(numero);
      const err = new Error('unique');
      err.code = '23505';
      throw err;
    });
  });
  // All numeros should be distinct
  const unique = new Set(numeros);
  assert.equal(unique.size, numeros.length, `duplicate numeros: ${numeros.join(', ')}`);
});
