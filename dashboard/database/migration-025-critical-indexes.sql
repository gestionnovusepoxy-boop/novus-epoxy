-- Critical indexes for deduplication and performance
-- 2026-04-02

-- Prevent duplicate leads by email (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_leads_email_unique
  ON crm_leads(LOWER(email)) WHERE email IS NOT NULL AND email != '';

-- Fast phone lookups for SMS dedup
CREATE INDEX IF NOT EXISTS idx_crm_leads_phone
  ON crm_leads(telephone) WHERE telephone IS NOT NULL AND telephone != '';

-- Fast email lookups in submissions
CREATE INDEX IF NOT EXISTS idx_submissions_email_lower
  ON submissions(LOWER(email)) WHERE email IS NOT NULL;

-- Email logs reverse lookup (dedup before sending)
CREATE INDEX IF NOT EXISTS idx_email_logs_destinataire_lower
  ON email_logs(LOWER(destinataire));

-- Temperature + status combo for CRM filters
CREATE INDEX IF NOT EXISTS idx_crm_leads_statut_temp
  ON crm_leads(statut, temperature);

-- Conversations lead temp for filtering
CREATE INDEX IF NOT EXISTS idx_conversations_lead_temp
  ON conversations(lead_temp) WHERE lead_temp IS NOT NULL;

-- Add CHECK constraints for data integrity
ALTER TABLE crm_leads DROP CONSTRAINT IF EXISTS crm_leads_temperature_check;
ALTER TABLE crm_leads ADD CONSTRAINT crm_leads_temperature_check
  CHECK (temperature IN ('chaud', 'tiede', 'froid'));
