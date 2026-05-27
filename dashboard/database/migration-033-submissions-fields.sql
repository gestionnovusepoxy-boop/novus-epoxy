-- Migration 015: Add fields to submissions for custom contact form
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS type_projet VARCHAR(80);
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS adresse TEXT;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS surface_estimee VARCHAR(50);
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS ville VARCHAR(120);
