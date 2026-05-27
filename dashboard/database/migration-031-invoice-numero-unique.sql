-- migration-031-invoice-numero-unique.sql
--
-- Adds a UNIQUE constraint on invoices.numero to eliminate the race condition
-- between concurrent INSERTs that previously computed the next number via
--   SELECT MAX(numero) -> +1 -> INSERT
-- with no DB-level guarantee. Two concurrent callers could mint the same
-- NE-YYYY-NNN and the duplicate would be silently committed.
--
-- ============================================================================
-- IMPORTANT — RUN THIS PROBE FIRST BEFORE APPLYING THE ALTER TABLE
-- ============================================================================
-- If duplicates already exist, the ALTER below will fail. Investigate and
-- de-duplicate manually before running the migration.
--
--   SELECT numero, COUNT(*) AS n
--     FROM invoices
--    GROUP BY numero
--   HAVING COUNT(*) > 1
--    ORDER BY n DESC;
--
-- Expected result: 0 rows. If you see rows, fix the duplicates first
-- (rename the newer one with a suffix, e.g. NE-2026-007 -> NE-2026-007-dup,
-- or merge their payment records into the older invoice).
-- ============================================================================

ALTER TABLE invoices
  ADD CONSTRAINT invoices_numero_unique UNIQUE (numero);
