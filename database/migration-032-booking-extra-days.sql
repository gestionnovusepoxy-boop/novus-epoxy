-- Migration 032: support N jours par booking (jour 3, 4, 5, ...)
-- jour1 et jour2 restent en colonnes (backward compat), les jours 3+ vont dans extra_days JSONB.
-- Format extra_days: [{"date":"2026-06-03","slot":"matin"}, {"date":"2026-06-04","slot":"journee"}, ...]

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS extra_days JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Index GIN pour conflict-check rapide sur les dates des extra_days
CREATE INDEX IF NOT EXISTS idx_bookings_extra_days_gin ON bookings USING GIN (extra_days);
