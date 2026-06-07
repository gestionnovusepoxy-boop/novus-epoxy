import { readFileSync } from 'fs';
const env = readFileSync('.env.local','utf8');
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.replace(/^["']|["']$/g,'');
process.env.DATABASE_URL = url;
const { neon } = await import('@neondatabase/serverless');
const sql = neon(url);
const out = {};
// READ-ONLY schema introspection only
out.crm_email_indexes = await sql`SELECT indexname, indexdef FROM pg_indexes WHERE tablename='crm_leads' AND indexdef ILIKE '%email%'`;
out.crm_tel_indexes = await sql`SELECT indexname, indexdef FROM pg_indexes WHERE tablename='crm_leads' AND indexdef ILIKE '%telephone%'`;
out.invoices_statut_check = await sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='invoices'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%statut%'`;
out.payments_checks = await sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='payments'::regclass AND contype='c'`;
out.payments_cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='payments' ORDER BY ordinal_position`;
out.email_logs_statut_check = await sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='email_logs'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%statut%'`;
out.sms_logs_cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='sms_logs' ORDER BY ordinal_position`;
out.quotes_service_cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='quotes' AND column_name ILIKE '%service%'`;
out.invoices_cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name='invoices' ORDER BY ordinal_position`;
console.log(JSON.stringify(out,null,2));
