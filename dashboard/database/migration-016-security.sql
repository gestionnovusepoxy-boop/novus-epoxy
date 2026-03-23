-- Migration 016: Add secret_token to quotes for secure public URLs
-- Applied: 2026-03-22

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS secret_token TEXT;
UPDATE quotes SET secret_token = gen_random_uuid() WHERE secret_token IS NULL;
ALTER TABLE quotes ALTER COLUMN secret_token SET DEFAULT gen_random_uuid();
