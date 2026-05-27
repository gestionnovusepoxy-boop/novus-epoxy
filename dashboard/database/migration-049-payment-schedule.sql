-- Migration 033: support multi-paiement custom (au-delà du 30/70 hardcodé)
-- payment_schedule: array d'étapes de paiement avec montant fixe OU pourcentage
-- Format: [{"label":"Dépôt","amount_cents":null,"pct":30,"due":"on_signature","status":"pending"}, ...]
-- Si null/vide, le système utilise le 30/70 par défaut

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS payment_schedule JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Index GIN pour query rapide
CREATE INDEX IF NOT EXISTS idx_quotes_payment_schedule_gin ON quotes USING GIN (payment_schedule);
