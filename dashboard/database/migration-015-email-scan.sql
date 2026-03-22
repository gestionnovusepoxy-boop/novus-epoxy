-- kv_store for cron state tracking
CREATE TABLE IF NOT EXISTS kv_store (
  key VARCHAR(255) PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add source column to expenses (to track where expense came from)
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'manual';
