-- Migration 055: Meta Conversions API (CAPI) tracking flag.
-- On envoie la VRAIE valeur des leads (devis passés à depot_paye) à Meta
-- via la Conversions API pour mieux optimiser les pubs (event "Purchase").
-- Cette colonne marque les devis dont l'event a déjà été envoyé pour ne pas
-- le ré-envoyer (dédup). Nullable/défaut FALSE → le code existant l'ignore.

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS capi_sent BOOLEAN DEFAULT FALSE;

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS capi_sent_at TIMESTAMPTZ;

-- Index partiel pour retrouver rapidement les devis depot_paye pas encore envoyés.
CREATE INDEX IF NOT EXISTS idx_quotes_capi_pending
  ON quotes (deposit_paid_at)
  WHERE capi_sent = FALSE;
