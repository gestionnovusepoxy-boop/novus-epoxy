-- Migration 008: Add audit_logs table for security event tracking
CREATE TABLE IF NOT EXISTS audit_logs (
  id          SERIAL PRIMARY KEY,
  action      VARCHAR(50) NOT NULL,
  email       VARCHAR(255),
  success     BOOLEAN NOT NULL DEFAULT FALSE,
  ip_address  VARCHAR(45),
  details     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_email ON audit_logs (email, created_at DESC);
