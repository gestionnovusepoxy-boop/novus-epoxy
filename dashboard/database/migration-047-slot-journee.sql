-- Migration 031: Support 'journee' slot (full day = AM + PM) for bookings
-- Drops old unique indexes that don't account for journee blocking both halves,
-- replaces with application-level conflict checks (in /api/bookings/route.ts).

-- Drop the strict per-slot unique indexes — they can't express
-- "journee on date D blocks any matin or apres-midi on D" correctly.
DROP INDEX IF EXISTS idx_bookings_jour1;
DROP INDEX IF EXISTS idx_bookings_jour2;

-- Add a CHECK constraint to enforce valid slot values
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_jour1_slot_check;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_jour2_slot_check;
ALTER TABLE bookings
  ADD CONSTRAINT bookings_jour1_slot_check CHECK (jour1_slot IN ('matin', 'apres-midi', 'journee'));
ALTER TABLE bookings
  ADD CONSTRAINT bookings_jour2_slot_check CHECK (jour2_slot IN ('matin', 'apres-midi', 'journee'));

-- Re-add fast lookup indexes (non-unique now)
CREATE INDEX IF NOT EXISTS idx_bookings_jour1_date ON bookings (jour1_date) WHERE statut != 'annule';
CREATE INDEX IF NOT EXISTS idx_bookings_jour2_date ON bookings (jour2_date) WHERE statut != 'annule';
