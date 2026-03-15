-- Migration 003: Add telegram channel support
-- Run against Neon PostgreSQL production database

-- Update conversations channel constraint to include 'telegram'
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_channel_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_channel_check
  CHECK (channel IN ('web', 'messenger', 'email', 'telegram'));
