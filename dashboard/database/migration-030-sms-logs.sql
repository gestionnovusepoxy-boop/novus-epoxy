-- Migration 030: SMS logs table
-- Table may already exist with additional columns (quote_id, lead_id, client_nom)

CREATE TABLE IF NOT EXISTS sms_logs (
  id SERIAL PRIMARY KEY,
  direction VARCHAR(10) NOT NULL DEFAULT 'outbound',
  from_number VARCHAR(20),
  to_number VARCHAR(20) NOT NULL,
  message TEXT,
  statut VARCHAR(20) DEFAULT 'sent',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_logs_to_number ON sms_logs(to_number);
CREATE INDEX IF NOT EXISTS idx_sms_logs_created_at ON sms_logs(created_at);
