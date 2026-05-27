-- Migration 050: schema_migrations tracking table
-- Records every migration filename applied by scripts/run-migrations.mjs so the
-- runner can skip what's already done and stay idempotent across environments.

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT NOW()
);
