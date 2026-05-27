CREATE TABLE IF NOT EXISTS job_photos (
  id SERIAL PRIMARY KEY,
  quote_id INT NOT NULL REFERENCES quotes(id),
  type VARCHAR(10) NOT NULL CHECK (type IN ('avant', 'apres')),
  url TEXT NOT NULL,
  filename VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_job_photos_quote ON job_photos(quote_id);
