-- Migration 005: Add bookings table for scheduling work appointments
-- Run against Neon PostgreSQL production database

CREATE TABLE IF NOT EXISTS bookings (
  id            SERIAL PRIMARY KEY,
  quote_id      INTEGER NOT NULL REFERENCES quotes(id),
  -- Day 1: prep/first coat (morning)
  jour1_date    DATE NOT NULL,
  jour1_slot    VARCHAR(10) NOT NULL DEFAULT 'matin',  -- 'matin'
  -- Day 2: finishing/second coat (afternoon or morning if saturday)
  jour2_date    DATE NOT NULL,
  jour2_slot    VARCHAR(10) NOT NULL DEFAULT 'apres-midi', -- 'matin' or 'apres-midi'
  -- Status
  statut        VARCHAR(20) NOT NULL DEFAULT 'confirme',
  -- Reminders
  rappel_jour1_sent BOOLEAN NOT NULL DEFAULT FALSE,
  rappel_jour2_sent BOOLEAN NOT NULL DEFAULT FALSE,
  -- Timestamps
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent double-booking: only one booking per date+slot
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_jour1 ON bookings (jour1_date, jour1_slot) WHERE statut != 'annule';
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_jour2 ON bookings (jour2_date, jour2_slot) WHERE statut != 'annule';

-- Fast lookup by quote
CREATE INDEX IF NOT EXISTS idx_bookings_quote ON bookings (quote_id);

-- For reminder cron
CREATE INDEX IF NOT EXISTS idx_bookings_rappel ON bookings (statut, jour1_date, jour2_date) WHERE statut = 'confirme';

-- Add scheduling columns to quotes
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS booking_id INTEGER REFERENCES bookings(id);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_bookings_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bookings_updated_at ON bookings;
CREATE TRIGGER bookings_updated_at BEFORE UPDATE ON bookings
FOR EACH ROW EXECUTE FUNCTION update_bookings_updated_at();
