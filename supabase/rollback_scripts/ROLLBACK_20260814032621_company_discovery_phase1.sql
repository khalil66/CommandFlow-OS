-- ============================================================================
-- ROLLBACK for supabase/migrations/20260814032621_a3a92a9b-e312-4a99-9dd2-fa01c2a97eb8.sql
-- (Company Discovery Intelligence Layer — Phase 1: additive schema foundation)
--
-- NOT auto-applied. Deliberately stored outside supabase/migrations/ so the
-- Supabase CLI / migration runner never picks it up automatically. Run this
-- manually, only if Phase 1 needs to be fully reverted.
--
-- Safe to run at any time after the Phase 1 migration, PROVIDED no later
-- phase's application code has started reading/writing the objects below —
-- as of Phase 1 shipping, nothing in src/ does, so this is currently a
-- no-behavioral-impact rollback. If Phase 2+ has shipped and is actively
-- using these objects, do not run this without first reverting that code.
--
-- This script only drops what Phase 1 created. It does not touch any
-- pre-existing table, column, enum, function, view, or RLS policy.
-- ============================================================================

-- 1. New tables (DROP TABLE also removes their RLS policies and indexes)
drop table if exists public.company_similarity;
drop table if exists public.discovery_runs;

-- 2. New view
drop view if exists public.ats_source_performance;

-- 3. New function
drop function if exists public.company_application_count_since(uuid, uuid, timestamptz);

-- 4. Indexes added directly on the pre-existing companies table
--    (indexes on now-dropped columns below would be removed automatically
--    by the column drop, but these are dropped explicitly for clarity)
drop index if exists public.idx_companies_user_domain_lookup;
drop index if exists public.idx_companies_discovery_status;
drop index if exists public.idx_companies_opportunity_score;
drop index if exists public.idx_companies_last_checked;
drop index if exists public.idx_companies_ats_provider;

-- 5. Columns added to the pre-existing public.user_settings table
alter table public.user_settings
  drop column if exists max_apps_per_company_7d,
  drop column if exists max_apps_per_company_30d,
  drop column if exists max_daily_share_per_company,
  drop column if exists diversity_gate_enabled,
  drop column if exists expansion_mode_active,
  drop column if exists expansion_mode_triggered_at;

-- 6. Columns added to the pre-existing public.companies table
alter table public.companies
  drop column if exists ats_provider,
  drop column if exists ats_company_slug,
  drop column if exists headquarters_country,
  drop column if exists us_remote_allowed,
  drop column if exists global_remote_allowed,
  drop column if exists north_america_remote_allowed,
  drop column if exists company_size_estimate,
  drop column if exists industry,
  drop column if exists public_private,
  drop column if exists career_page_active,
  drop column if exists last_job_seen_at,
  drop column if exists first_discovered_at,
  drop column if exists last_checked_at,
  drop column if exists eligible_job_count,
  drop column if exists historical_eligible_job_count,
  drop column if exists application_count,
  drop column if exists interview_count,
  drop column if exists rejection_count,
  drop column if exists response_count,
  drop column if exists avg_job_quality,
  drop column if exists avg_salary_estimate,
  drop column if exists auto_apply_success_count,
  drop column if exists duplicate_job_rate,
  drop column if exists source_reliability_score,
  drop column if exists company_opportunity_score,
  drop column if exists discovery_source,
  drop column if exists discovery_reason,
  drop column if exists similar_to_company_id,
  drop column if exists discovery_status,     -- must drop before the enum type below
  drop column if exists cooldown_until,
  drop column if exists blocked_reason;

-- 7. New enum (only succeeds once nothing references it — the column drop
--    above removes the only reference)
drop type if exists public.company_discovery_status;

-- ============================================================================
-- After running this, the schema is byte-for-byte identical to before Phase 1.
-- Re-verify with: \d public.companies  and  \d public.user_settings
-- to confirm the extra columns are gone and nothing else changed.
-- ============================================================================
