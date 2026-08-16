-- ============================================================================
-- ROLLBACK for supabase/migrations/20260816140000_96c86220-e893-4bda-a072-9ecc1cb669bd.sql
-- (Company Discovery Intelligence Layer — Phase 3.1: job_sources.company_id)
--
-- NOT auto-applied. Deliberately stored outside supabase/migrations/ so the
-- Supabase CLI / migration runner never picks it up automatically. Run this
-- manually, only if Phase 3.1's schema change needs to be fully reverted.
--
-- Safe to run at any time after the Phase 3.1 migration, PROVIDED no later
-- phase's application code has started depending on job_sources.company_id
-- being present. As of Phase 3.1 shipping, company_id is read/written
-- opportunistically (Company Scout writes it, ingest.functions.ts prefers it
-- but always falls back to name-based lookup when absent) — dropping the
-- column returns every row to that same fallback path, not a broken state.
--
-- This script only drops what this migration created. It does not touch any
-- pre-existing table, column, index, or RLS policy.
-- ============================================================================

drop index if exists public.idx_job_sources_company_id;

alter table public.job_sources
  drop column if exists company_id;
