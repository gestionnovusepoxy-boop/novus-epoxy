-- Migration 052 — Autorise les statuts entrants dans email_logs.
-- Le scan email (app/api/cron/email-scan) logge les réponses clients avec statut='received',
-- mais la contrainte CHECK ne permettait que les statuts sortants → l'INSERT plantait (avalé en silence).
-- On ajoute 'received' et 'inbound'.

ALTER TABLE email_logs DROP CONSTRAINT IF EXISTS email_logs_statut_check;
ALTER TABLE email_logs ADD CONSTRAINT email_logs_statut_check
  CHECK (statut IN (
    'sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained',
    'processing', 'skipped', 'error', 'received', 'inbound'
  ));
