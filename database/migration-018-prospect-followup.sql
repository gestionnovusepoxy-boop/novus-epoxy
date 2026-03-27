-- Track prospect follow-up timestamps for Aria auto follow-ups
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS prospect_followup1_at TIMESTAMPTZ;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS prospect_followup2_at TIMESTAMPTZ;
