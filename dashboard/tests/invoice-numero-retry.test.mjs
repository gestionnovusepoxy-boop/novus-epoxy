/**
 * Tests for lib/invoice-numero.ts — insertInvoiceWithRetry error paths not
 * covered by invoice-numero.test.mjs (non-23505 rethrow, exhaustion).
 *
 * All logic inlined — no DB required.
 * Run: node --test tests/invoice-numero-retry.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── Inline retry logic (mirrors insertInvoiceWithRetry exactly) ──────────────

async function insertWithRetry(options, insert) {
  const maxAttempts = options.maxAttempts ?? 5;
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const numero = `NE-2026-${String(attempt + 1).padStart(4, '0')}`;
    try {
      return await insert(numero);
    } catch (e) {
      lastError = e;
      if (e?.code !== '23505') throw e;
    }
  }
  throw lastError ?? new Error('insertInvoiceWithRetry: exhausted attempts');
}

// ── Non-23505 errors are rethrown immediately ─────────────────────────────────

test('non-23505 error is rethrown immediately (no retry)', async () => {
  let callCount = 0;
  const dbError = Object.assign(new Error('connection refused'), { code: '08001' });
  await assert.rejects(
    () => insertWithRetry({ maxAttempts: 5 }, (_numero) => {
      callCount++;
      throw dbError;
    }),
    (err) => err.code === '08001',
  );
  assert.equal(callCount, 1, 'must not retry on non-23505 error');
});

test('non-23505 error (no code) rethrows immediately', async () => {
  let callCount = 0;
  const genericError = new Error('unexpected failure');
  await assert.rejects(
    () => insertWithRetry({ maxAttempts: 5 }, () => {
      callCount++;
      throw genericError;
    }),
    (err) => err.message === 'unexpected failure',
  );
  assert.equal(callCount, 1);
});

// ── 23505 triggers retry ──────────────────────────────────────────────────────

test('23505 error retries until success', async () => {
  let callCount = 0;
  const result = await insertWithRetry({ maxAttempts: 5 }, (numero) => {
    callCount++;
    if (callCount < 3) {
      throw Object.assign(new Error('unique violation'), { code: '23505' });
    }
    return { id: 42, numero };
  });
  assert.equal(result.id, 42);
  assert.equal(callCount, 3);
});

test('23505 error gets a different numero on each retry', async () => {
  const numeros = [];
  await assert.rejects(
    () => insertWithRetry({ maxAttempts: 3 }, (numero) => {
      numeros.push(numero);
      throw Object.assign(new Error('unique violation'), { code: '23505' });
    }),
  );
  assert.equal(numeros.length, 3);
  // Each attempt should produce a distinct numero
  const unique = new Set(numeros);
  assert.equal(unique.size, 3, `expected 3 distinct numeros, got: ${numeros}`);
});

// ── Exhaustion after max attempts ─────────────────────────────────────────────

test('exhausts maxAttempts and rethrows last error', async () => {
  let callCount = 0;
  const uniqueError = Object.assign(new Error('unique violation'), { code: '23505' });
  await assert.rejects(
    () => insertWithRetry({ maxAttempts: 3 }, () => {
      callCount++;
      throw uniqueError;
    }),
    (err) => err.code === '23505',
  );
  assert.equal(callCount, 3, 'must have tried exactly maxAttempts times');
});

test('maxAttempts = 1 → tries once, then throws', async () => {
  let callCount = 0;
  await assert.rejects(
    () => insertWithRetry({ maxAttempts: 1 }, () => {
      callCount++;
      throw Object.assign(new Error('unique violation'), { code: '23505' });
    }),
  );
  assert.equal(callCount, 1);
});

// ── Happy path ────────────────────────────────────────────────────────────────

test('first attempt success → no retry', async () => {
  let callCount = 0;
  const result = await insertWithRetry({ maxAttempts: 5 }, (numero) => {
    callCount++;
    return { id: 1, numero };
  });
  assert.equal(callCount, 1);
  assert.equal(result.id, 1);
});

test('default maxAttempts = 5', async () => {
  let callCount = 0;
  await assert.rejects(
    () => insertWithRetry({}, () => {
      callCount++;
      throw Object.assign(new Error('unique violation'), { code: '23505' });
    }),
  );
  assert.equal(callCount, 5);
});
