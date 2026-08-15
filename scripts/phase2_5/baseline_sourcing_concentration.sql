-- ============================================================================
-- Phase 2.5 — Sourcing concentration baseline. Run against the REAL target
-- Supabase project (SQL editor or psql) for the user(s) whose concentration
-- you want to measure. This sandbox has no network path to any live
-- Supabase project or production data, so these numbers could not be
-- computed here — see the Phase 2.5 report, §4, for why this is listed as a
-- blocked item rather than a fabricated result.
--
-- Replace :user_id with a real auth.users.id, or drop the `where user_id = :user_id`
-- clauses to compute across all users (only appropriate for an admin/aggregate view).
-- Read-only. Makes no changes.
-- ============================================================================

-- 1) Total active job_sources.
select count(*) as total_active_job_sources
from public.job_sources
where status = 'active'; -- and user_id = :user_id

-- 2) Unique companies currently sourced (by job_sources.name — job_sources
--    has no company_id FK, so name is the only linkage available pre-Phase-2).
select count(distinct lower(trim(name))) as unique_companies_in_job_sources
from public.job_sources
where status = 'active'; -- and user_id = :user_id

-- 3) Active job_sources by ATS.
select coalesce(ats, 'unknown') as ats, count(*) as source_count
from public.job_sources
where status = 'active' -- and user_id = :user_id
group by 1
order by 2 desc;

-- 4) Original DEFAULT_SOURCES still active, by exact name match.
--    (src/lib/ingest.functions.ts DEFAULT_SOURCES, as of Phase 0/1 audit:
--     Stripe, Airbnb, Dropbox, Plaid, Brex, Ramp, Linear, OpenAI, PostHog, Netflix)
select name, ats, status, created_at, last_imported_at
from public.job_sources
where lower(trim(name)) in (
  'stripe','airbnb','dropbox','plaid','brex','ramp','linear','openai','posthog','netflix'
) -- and user_id = :user_id
order by name;

select count(*) as default_sources_still_active
from public.job_sources
where status = 'active'
  and lower(trim(name)) in (
    'stripe','airbnb','dropbox','plaid','brex','ramp','linear','openai','posthog','netflix'
  ); -- and user_id = :user_id

-- 5) Jobs imported in the last 7 / 30 days (job_listings.created_at as the
--    ingestion timestamp — this is when CommandFlow wrote the row, which is
--    the closest available proxy to "imported at" since there is no separate
--    import_logs-per-job timestamp on job_listings itself).
select count(*) as jobs_imported_last_7d
from public.job_listings
where created_at >= now() - interval '7 days'; -- and user_id = :user_id

select count(*) as jobs_imported_last_30d
from public.job_listings
where created_at >= now() - interval '30 days'; -- and user_id = :user_id

-- 6) Eligible jobs by company (top 20) — "eligible" defined here as
--    remote = true and salary_gate_status != 'reject' and status != 'safety_blocked'
--    as a reasonable proxy; adjust to match your exact eligibility definition
--    if it differs.
select company_name, count(*) as eligible_job_count
from public.job_listings
where remote = true
  and salary_gate_status <> 'reject'
  -- and user_id = :user_id
group by company_name
order by eligible_job_count desc
limit 20;

-- 7) Auto Apply applications by company (top 20).
select jl.company_name, count(*) as auto_apply_count
from public.applications a
join public.job_listings jl on jl.id = a.job_id
where (a.auto_submitted_at is not null or a.status = 'submitted_automatically')
  -- and a.user_id = :user_id
group by jl.company_name
order by auto_apply_count desc
limit 20;

-- 8) Top-5 / top-10 company concentration of Auto Apply applications
--    (the core "no 5 companies > 25% of Auto Apply over rolling 30 days"
--    success metric from the original spec).
with auto_apps as (
  select jl.company_name, a.created_at
  from public.applications a
  join public.job_listings jl on jl.id = a.job_id
  where (a.auto_submitted_at is not null or a.status = 'submitted_automatically')
    and a.created_at >= now() - interval '30 days'
    -- and a.user_id = :user_id
),
by_company as (
  select company_name, count(*) as cnt
  from auto_apps
  group by company_name
),
total as (
  select sum(cnt) as total_cnt from by_company
)
select
  bc.company_name,
  bc.cnt,
  round(100.0 * bc.cnt / nullif(t.total_cnt, 0), 1) as pct_of_total_auto_apply_30d
from by_company bc, total t
order by bc.cnt desc
limit 10;

-- Then sum the top-5 and top-10 pct_of_total columns from the result above to
-- get the two headline concentration numbers this report needs.

-- 9) Total eligible jobs (denominator for the "eligible jobs by company" share).
select count(*) as total_eligible_jobs
from public.job_listings
where remote = true and salary_gate_status <> 'reject'; -- and user_id = :user_id

-- ============================================================================
-- Paste the output of queries 1-9 back for the actual "before" baseline
-- numbers required by Phase 2.5 §4. Without live database access, this
-- sandbox can only provide the exact queries, not the numbers themselves.
-- ============================================================================
