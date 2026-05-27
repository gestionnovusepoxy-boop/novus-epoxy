-- Migration 004: Add follow-up tracking and flake color to quotes
-- Run against Neon PostgreSQL production database

-- Follow-up timestamps
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS relance_1_at TIMESTAMPTZ;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS relance_2_at TIMESTAMPTZ;

-- Flake color preference (Torginol catalog)
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS couleur_flake VARCHAR(60);

-- Index for cron relance query
CREATE INDEX IF NOT EXISTS idx_quotes_relance ON quotes (statut, sent_at) WHERE statut = 'envoye';
