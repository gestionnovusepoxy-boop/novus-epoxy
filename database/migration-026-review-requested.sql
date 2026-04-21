-- Migration 026: Add review_requested_at to quotes
-- Tracks when a Google review request was sent to the client after job completion

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS review_requested_at TIMESTAMPTZ;
