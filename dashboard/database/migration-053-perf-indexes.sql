-- Migration 053 — Index de performance pour les requêtes chaudes du dashboard.
-- Cible: /api/dashboard/overview (polled 30s), /api/stats/funnel, crons de relance.
-- IF NOT EXISTS = idempotent, sûr à rejouer. Tables Novus modestes → lock bref acceptable.

-- crm_leads : leads chauds non contactés, filtres statut/source/date (overview + lead-followup)
CREATE INDEX IF NOT EXISTS idx_crm_leads_temp_prospect ON crm_leads (temperature, prospect_sent_at);
CREATE INDEX IF NOT EXISTS idx_crm_leads_statut        ON crm_leads (statut);
CREATE INDEX IF NOT EXISTS idx_crm_leads_created_at    ON crm_leads (created_at);

-- quotes : funnel + devis sans réponse 48h (statut + sent_at)
CREATE INDEX IF NOT EXISTS idx_quotes_statut          ON quotes (statut);
CREATE INDEX IF NOT EXISTS idx_quotes_statut_sent     ON quotes (statut, sent_at);

-- invoices : agrégats financiers overview (statut + flags de paiement)
CREATE INDEX IF NOT EXISTS idx_invoices_statut        ON invoices (statut);
CREATE INDEX IF NOT EXISTS idx_invoices_paye_flags    ON invoices (depot_paye, final_paye);

-- sms_logs : compteurs entrants/sortants + limite quotidienne
CREATE INDEX IF NOT EXISTS idx_sms_logs_direction_created ON sms_logs (direction, created_at);
