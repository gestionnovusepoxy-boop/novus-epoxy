CREATE TABLE IF NOT EXISTS lead_campaigns (
  id SERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  details TEXT,
  result TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
