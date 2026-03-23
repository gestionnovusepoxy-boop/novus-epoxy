-- Add videos column to portfolio table
ALTER TABLE portfolio ADD COLUMN IF NOT EXISTS videos TEXT[] DEFAULT '{}';
