-- Migration 018: Expand email_logs statut constraint for email-scan auto-processing
ALTER TABLE email_logs DROP CONSTRAINT IF EXISTS email_logs_statut_check;
ALTER TABLE email_logs ADD CONSTRAINT email_logs_statut_check
  CHECK (statut IN ('sent','delivered','opened','clicked','bounced','complained','processing','skipped','error'));
