CREATE TABLE IF NOT EXISTS portfolio (
  id SERIAL PRIMARY KEY,
  titre TEXT NOT NULL,
  description TEXT,
  type_service TEXT NOT NULL DEFAULT 'flake',
  superficie INTEGER,
  couleur TEXT,
  ville TEXT,
  photos TEXT[] DEFAULT '{}',
  featured BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
