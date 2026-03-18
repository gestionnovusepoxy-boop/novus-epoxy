-- Migration 007: Add review request tracking to bookings
-- Adds 'complete' status and review SMS tracking

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_statut_check;

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS avis_sms_sent BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Index for review cron
CREATE INDEX IF NOT EXISTS idx_bookings_avis ON bookings (statut, completed_at) WHERE avis_sms_sent = FALSE;
