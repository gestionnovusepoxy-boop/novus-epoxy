-- Allow 'en_attente' status for provisional bookings
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_statut_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_statut_check
  CHECK (statut IN ('en_attente','confirme','annule','complete'));
