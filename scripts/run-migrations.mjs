#!/usr/bin/env node
/**
 * scripts/run-migrations.mjs
 *
 * Idempotent runner for dashboard/database/migration-*.sql.
 *
 * Reads every migration-*.sql in lexicographic order, checks the
 * schema_migrations table for what was already applied (by filename), then
 * applies whatever's missing in a single transaction per file. Each applied
 * filename gets recorded in schema_migrations so re-running this script after
 * a partial deploy is safe.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/run-migrations.mjs
 *   DATABASE_URL=postgres://... node scripts/run-migrations.mjs --dry-run
 *
 * Bootstrapping:
 *   The schema_migrations table itself is created by
 *   migration-050-schema-migrations.sql. To break the chicken-and-egg, we
 *   create it inline here BEFORE checking what's applied. That makes the
 *   table-creation idempotent and the runner safe on a fresh DB or an
 *   already-migrated prod DB.
 *
 * Safety:
 *   - Read-only of file contents — never modifies files on disk.
 *   - DATABASE_URL is required; we refuse to run without it.
 *   - --dry-run prints the plan without executing.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'dashboard', 'database');

const DRY_RUN = process.argv.includes('--dry-run');

function listMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^migration-.*\.sql$/.test(f))
    .sort();
}

async function ensureTrackerTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT NOW()
    )
  `;
}

async function getApplied(sql) {
  const rows = await sql`SELECT filename FROM schema_migrations`;
  return new Set(rows.map((r) => r.filename));
}

async function applyMigration(sql, filename) {
  const path = join(MIGRATIONS_DIR, filename);
  const content = readFileSync(path, 'utf8');
  // Neon's serverless driver auto-wraps each .query() in a transaction when
  // we pass a single multi-statement string via the tagged template. We use
  // the lower-level .query() method here because the file may contain
  // multiple statements separated by semicolons.
  await sql.query(content);
  await sql`
    INSERT INTO schema_migrations (filename)
    VALUES (${filename})
    ON CONFLICT (filename) DO NOTHING
  `;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('FATAL: DATABASE_URL is required');
    process.exit(1);
  }

  const sql = neon(url);
  const files = listMigrations();
  console.log(`[migrations] found ${files.length} files in ${MIGRATIONS_DIR}`);

  await ensureTrackerTable(sql);
  const applied = await getApplied(sql);
  const pending = files.filter((f) => !applied.has(f));

  console.log(`[migrations] applied: ${applied.size} / pending: ${pending.length}`);
  if (!pending.length) {
    console.log('[migrations] up to date.');
    return;
  }

  if (DRY_RUN) {
    console.log('[migrations] --dry-run, plan:');
    for (const f of pending) console.log(`  - ${f}`);
    return;
  }

  for (const filename of pending) {
    process.stdout.write(`[migrations] applying ${filename} ... `);
    try {
      await applyMigration(sql, filename);
      console.log('OK');
    } catch (err) {
      console.log('FAILED');
      console.error(err);
      console.error(`[migrations] stopped at ${filename}. Fix and re-run.`);
      process.exit(1);
    }
  }

  console.log('[migrations] done.');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
