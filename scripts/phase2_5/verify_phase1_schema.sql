-- ============================================================================
-- Phase 2.5 — Run this against the REAL target Supabase project (SQL editor
-- or `psql`) to confirm the Phase 1 migration has been applied and its
-- objects exist as expected. This sandbox has no network path to any live
-- Supabase project, so this script could only be validated against a local
-- from-scratch replay of all 26 migrations (see the Phase 2.5 report, §2) —
-- run this yourself and compare against the expected column list below.
-- Read-only. Makes no changes.
-- ============================================================================

-- 1) Confirm the new companies columns exist (expect 31 rows).
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'companies'
  and column_name in (
    'ats_provider','ats_company_slug','headquarters_country','us_remote_allowed',
    'global_remote_allowed','north_america_remote_allowed','company_size_estimate',
    'industry','public_private','career_page_active','last_job_seen_at',
    'first_discovered_at','last_checked_at','eligible_job_count',
    'historical_eligible_job_count','application_count','interview_count',
    'rejection_count','response_count','avg_job_quality','avg_salary_estimate',
    'auto_apply_success_count','duplicate_job_rate','source_reliability_score',
    'company_opportunity_score','discovery_source','discovery_reason',
    'similar_to_company_id','discovery_status','cooldown_until','blocked_reason'
  )
order by column_name;

-- 2) Confirm total companies column count (expect 55 = 24 original + 31 new).
select count(*) as companies_column_count
from information_schema.columns
where table_schema = 'public' and table_name = 'companies';

-- 3) Confirm the discovery status enum exists with all 10 values.
select enumlabel
from pg_enum e
join pg_type t on e.enumtypid = t.oid
where t.typname = 'company_discovery_status'
order by e.enumsortorder;
-- expected: NEW, DISCOVERED, VALIDATING, APPROVED, HIGH_PRIORITY, WATCHLIST,
--           LOW_YIELD, COOLDOWN, BLOCKED, INACTIVE

-- 4) Confirm new tables exist.
select table_name
from information_schema.tables
where table_schema = 'public' and table_name in ('company_similarity', 'discovery_runs')
order by table_name;

-- 5) Confirm RLS is enabled and all 4 policies exist on both new tables.
select tablename, rowsecurity
from pg_tables
where schemaname = 'public' and tablename in ('company_similarity', 'discovery_runs');

select tablename, policyname, cmd
from pg_policies
where schemaname = 'public' and tablename in ('company_similarity', 'discovery_runs')
order by tablename, cmd;
-- expected: 4 policies per table (select/insert/update/delete), all
-- `auth.uid() = user_id`, matching every other domain table's pattern.

-- 6) Confirm user_settings diversity/expansion columns exist.
select column_name, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'user_settings'
  and column_name in (
    'max_apps_per_company_7d','max_apps_per_company_30d',
    'max_daily_share_per_company','diversity_gate_enabled',
    'expansion_mode_active','expansion_mode_triggered_at'
  )
order by column_name;

-- 7) Confirm the function and view exist.
select routine_name, routine_type
from information_schema.routines
where routine_schema = 'public' and routine_name = 'company_application_count_since';

select table_name
from information_schema.views
where table_schema = 'public' and table_name = 'ats_source_performance';

-- Confirm the view is security_invoker (required so it doesn't bypass RLS).
select relname, reloptions
from pg_class
where relname = 'ats_source_performance';
-- expected reloptions to include: {security_invoker=true}

-- 8) Confirm the non-unique domain lookup index exists (NOT a unique
--    constraint — Phase 1 deliberately did not add one; dedup is
--    application-level in Phase 2, per the explicit instruction).
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'companies'
  and indexname = 'idx_companies_user_domain_lookup';

-- ============================================================================
-- If ALL of the above return the expected rows/values, the Phase 1 schema is
-- correctly applied to this environment and Company Scout's live-run writes
-- (still gated behind explicit authorization) would have somewhere valid to
-- write. If the migration has NOT yet been applied here, run:
--   supabase db push
-- (or apply supabase/migrations/20260814032621_a3a92a9b-e312-4a99-9dd2-fa01c2a97eb8.sql
-- directly) before any live (non-dry-run) Company Scout invocation.
-- ============================================================================
