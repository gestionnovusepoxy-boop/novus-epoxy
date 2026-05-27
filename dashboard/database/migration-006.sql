-- Migration 006: Add 'handoff' status for conversations needing human intervention
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_status_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_status_check
  CHECK (status IN ('active','pending_approval','quote_sent','closed','handoff'));
