-- Track prospect email sends on CRM leads
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS prospect_sent_at TIMESTAMPTZ;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS prospect_relance_1_at TIMESTAMPTZ;
ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS prospect_relance_2_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_crm_leads_prospect ON crm_leads(prospect_sent_at) WHERE prospect_sent_at IS NOT NULL;
