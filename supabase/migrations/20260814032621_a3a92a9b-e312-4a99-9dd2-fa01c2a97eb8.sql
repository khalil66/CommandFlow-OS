-- ============================================================================
-- CommandFlow OS — Company Discovery Intelligence Layer
-- Phase 1: Additive schema foundation ONLY.
--
-- Authorized scope: schema only. No application code in src/ reads or writes
-- any object created here yet (that begins in Phase 2). This migration is
-- 100% additive:
--   - every ALTER TABLE uses ADD COLUMN IF NOT EXISTS with a safe default
--   - every CREATE uses IF NOT EXISTS
--   - nothing is renamed, dropped, or has its type changed
--   - no existing table, enum, function, trigger, or RLS policy is touched
--   - AUTO_THRESHOLDS / evaluateAutoReview / scoring.ts / ingest.functions.ts
--     and every other existing scoring/safety code path are UNCHANGED —
--     this migration only adds columns/tables they don't reference.
--
-- Rollback: see the companion file
--   supabase/rollback_scripts/ROLLBACK_20260814032621_company_discovery_phase1.sql
-- (deliberately kept OUTSIDE supabase/migrations/ so the Supabase CLI never
-- auto-applies it as a forward migration — run it manually only if this
-- phase needs to be reverted). It is safe to run at any time after this
-- migration: it only drops objects created here.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. New enum: company discovery lifecycle status.
--    Deliberately separate from the EXISTING public.verification_status enum
--    (verified | manual_review | rejected), which continues to mean exactly
--    what it means today on companies.verification_status. This new enum
--    tracks a different concept (discovery pipeline stage), stored in a new
--    column (companies.discovery_status), so the two never collide.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'company_discovery_status') then
    create type public.company_discovery_status as enum (
      'NEW','DISCOVERED','VALIDATING','APPROVED','HIGH_PRIORITY',
      'WATCHLIST','LOW_YIELD','COOLDOWN','BLOCKED','INACTIVE'
    );
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Extend the REAL, existing public.companies table (audited — this table
--    already exists with trust_score/verification_status/category/etc.).
--    Do NOT create a second companies table. Every column below is new and
--    additive; none of the ~24 existing columns are touched.
-- ----------------------------------------------------------------------------
alter table public.companies
  -- ATS identification (new — companies has careers_url today but no ATS/tenant fields)
  add column if not exists ats_provider               text,                 -- 'greenhouse'|'lever'|'ashby'|'breezy'|null; matches values already used in job_listings.ats/job_sources.ats
  add column if not exists ats_company_slug            text,

  -- U.S. remote eligibility (new — distinct from the existing is_remote_first
  -- "remote-first culture" flag; these three describe *worker location eligibility*)
  add column if not exists headquarters_country         text,
  add column if not exists us_remote_allowed             boolean not null default false,
  add column if not exists global_remote_allowed         boolean not null default false,
  add column if not exists north_america_remote_allowed  boolean not null default false,

  -- Company intelligence (new fields; funding_stage already exists and is untouched)
  add column if not exists company_size_estimate         text,
  add column if not exists industry                      text,
  add column if not exists public_private                text,
  add column if not exists career_page_active             boolean not null default true,  -- assumed live until a future validation pass marks it inactive

  -- Company sourcing history (new — supports Company Scout freshness/recheck logic, Phase 2+)
  add column if not exists last_job_seen_at               timestamptz,
  add column if not exists first_discovered_at             timestamptz not null default now(),  -- for pre-existing rows this is a migration-time placeholder, not a real discovery date; harmless since nothing reads it until Phase 2
  add column if not exists last_checked_at                 timestamptz,
  add column if not exists eligible_job_count               integer not null default 0,
  add column if not exists historical_eligible_job_count    integer not null default 0,

  -- Application outcome learning at the company level (new — populated starting
  -- in the Phase 6 feedback-loop work; safe/inert zero defaults until then)
  add column if not exists application_count                integer not null default 0,
  add column if not exists interview_count                  integer not null default 0,
  add column if not exists rejection_count                  integer not null default 0,
  add column if not exists response_count                   integer not null default 0,
  add column if not exists avg_job_quality                  numeric(5,2),
  add column if not exists avg_salary_estimate               numeric(10,2),
  add column if not exists auto_apply_success_count           integer not null default 0,
  add column if not exists duplicate_job_rate                 numeric(5,2),
  add column if not exists source_reliability_score           numeric(5,2),

  -- Company opportunity scoring (new — NOT reusing the existing dead
  -- ranking_score/ranking_label columns; see migration notes at bottom)
  add column if not exists company_opportunity_score           numeric(5,2),

  -- Discovery provenance + lifecycle state (new)
  add column if not exists discovery_source                    text,        -- 'seed'|'ats_pattern'|'similarity'|'manual'|'random_exploration'
  add column if not exists discovery_reason                     text,
  add column if not exists similar_to_company_id                 uuid references public.companies(id),
  add column if not exists discovery_status                      public.company_discovery_status not null default 'NEW',

  -- Cooldown/diversity metadata (new — extends, does not replace, the existing
  -- user_settings.company_cooldown_days + companies.last_applied_at mechanism)
  add column if not exists cooldown_until                         timestamptz,
  add column if not exists blocked_reason                         text;

comment on column public.companies.discovery_status is
  'Company Discovery Intelligence Layer lifecycle state. Independent of verification_status (trust/legitimacy). Not yet read or written by any application code as of Phase 1.';
comment on column public.companies.company_opportunity_score is
  'New 0-100 discovery/opportunity score. Deliberately NOT reusing the pre-existing, unused ranking_score/ranking_label columns to avoid semantic ambiguity with their original (never-shipped) intent.';

-- Non-unique indexes only in this phase (supports future lookups/sorts).
-- NOTE: a UNIQUE (user_id, lower(domain)) constraint was considered (needed
-- for Company Scout's dedup guarantee later) but is deliberately NOT added
-- here — the audit found companies has no existing uniqueness guarantee, so
-- duplicate rows may already exist, and adding a unique constraint without an
-- authorized dedup pass first would be a "destructive/risky" step outside
-- this phase's approved scope. See ROLLBACK/notes file for the recommended
-- follow-up. This index just makes future dedup lookups cheap in the meantime.
create index if not exists idx_companies_user_domain_lookup
  on public.companies (user_id, lower(domain)) where domain is not null;

create index if not exists idx_companies_discovery_status
  on public.companies (discovery_status);
create index if not exists idx_companies_opportunity_score
  on public.companies (company_opportunity_score desc nulls last);
create index if not exists idx_companies_last_checked
  on public.companies (last_checked_at);
create index if not exists idx_companies_ats_provider
  on public.companies (ats_provider);

-- ----------------------------------------------------------------------------
-- 3. New table: company_similarity — the discovery graph edges. No existing
--    table represents this relationship; genuinely new (per consolidated
--    audit report, §7: "company_similarity — create").
-- ----------------------------------------------------------------------------
create table if not exists public.company_similarity (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null,                                 -- RLS scope, matches every other table's pattern
  company_id_a       uuid not null references public.companies(id) on delete cascade,
  company_id_b       uuid not null references public.companies(id) on delete cascade,
  similarity_score   numeric(5,2) not null,
  shared_attributes  jsonb not null default '{}'::jsonb,
  computed_at        timestamptz not null default now(),
  constraint company_similarity_no_self_reference check (company_id_a <> company_id_b),
  constraint company_similarity_pair_unique unique (company_id_a, company_id_b)
);

comment on table public.company_similarity is
  'Company Discovery Intelligence Layer. Edges in the discovery graph — populated starting in Phase 6 (feedback loop / similarity engine). Empty and unread by application code as of Phase 1.';

alter table public.company_similarity enable row level security;
-- CREATE POLICY has no IF NOT EXISTS in Postgres; guard manually so this
-- migration file is safe to re-run (Supabase's migration runner tracks
-- applied migrations and would never normally re-run this file, but the
-- guard costs nothing and avoids a hard failure if it's ever replayed by hand).
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='company_similarity' and policyname='own select company_similarity') then
    create policy "own select company_similarity" on public.company_similarity for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='company_similarity' and policyname='own insert company_similarity') then
    create policy "own insert company_similarity" on public.company_similarity for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='company_similarity' and policyname='own update company_similarity') then
    create policy "own update company_similarity" on public.company_similarity for update using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='company_similarity' and policyname='own delete company_similarity') then
    create policy "own delete company_similarity" on public.company_similarity for delete using (auth.uid() = user_id);
  end if;
end $$;

create index if not exists idx_company_similarity_a on public.company_similarity (company_id_a, similarity_score desc);
create index if not exists idx_company_similarity_b on public.company_similarity (company_id_b);

-- ----------------------------------------------------------------------------
-- 4. New table: discovery_runs — Company Scout audit log. No existing table
--    represents this (import_logs is the ANALOGOUS pattern for job-ingestion
--    runs, but scoped to job_sources import, not company discovery runs).
-- ----------------------------------------------------------------------------
create table if not exists public.discovery_runs (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null,
  run_started_at      timestamptz not null default now(),
  run_finished_at     timestamptz,
  expansion_level     integer,                                     -- 1-6, see design doc; nullable until Company Scout ships
  triggered_by        text not null default 'manual',               -- 'manual' | 'scheduled' | 'expansion_mode' — 'scheduled' unused until a scheduler exists (none does today; every automation in this app is button-triggered)
  ats_provider        text,
  companies_found      integer not null default 0,
  companies_approved   integer not null default 0,
  companies_rejected   integer not null default 0,
  notes               text
);

comment on table public.discovery_runs is
  'Company Discovery Intelligence Layer. Audit log for Company Scout runs, mirroring the role import_logs plays for job ingestion runs. Empty and unwritten by application code as of Phase 1.';

alter table public.discovery_runs enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='discovery_runs' and policyname='own select discovery_runs') then
    create policy "own select discovery_runs" on public.discovery_runs for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='discovery_runs' and policyname='own insert discovery_runs') then
    create policy "own insert discovery_runs" on public.discovery_runs for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='discovery_runs' and policyname='own update discovery_runs') then
    create policy "own update discovery_runs" on public.discovery_runs for update using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='discovery_runs' and policyname='own delete discovery_runs') then
    create policy "own delete discovery_runs" on public.discovery_runs for delete using (auth.uid() = user_id);
  end if;
end $$;

create index if not exists idx_discovery_runs_user_started
  on public.discovery_runs (user_id, run_started_at desc);

-- ----------------------------------------------------------------------------
-- 5. Extend the REAL, existing public.user_settings table with diversity/
--    cooldown/expansion configuration, alongside (not replacing) the existing
--    company_cooldown_days / per_ats_caps / daily_cap fields.
-- ----------------------------------------------------------------------------
alter table public.user_settings
  add column if not exists max_apps_per_company_7d      integer not null default 2,
  add column if not exists max_apps_per_company_30d      integer not null default 5,
  add column if not exists max_daily_share_per_company    numeric(4,2) not null default 0.10,
  add column if not exists diversity_gate_enabled          boolean not null default false,  -- OFF by default; this is the Phase 4 kill switch, defaulted off since Phase 4 code doesn't exist yet
  add column if not exists expansion_mode_active            boolean not null default false,
  add column if not exists expansion_mode_triggered_at       timestamptz;

comment on column public.user_settings.diversity_gate_enabled is
  'Feature flag for the Phase 4 diversity/cooldown gate in runSmartApply(). Defaults to false because no code reads it yet (Phase 1 is schema-only). Do not flip to true until Phase 4 ships.';

-- ----------------------------------------------------------------------------
-- 6. New function: rolling per-company application counts. Reuses the
--    EXISTING applications + job_listings tables/relationship — no new join
--    table (consolidated audit report §7: "company_applications — unnecessary").
--    SECURITY INVOKER (the default) is intentional: it runs with the calling
--    user's own permissions, so the existing RLS policies on applications/
--    job_listings apply exactly as they would to a direct query — this
--    function cannot be used to read another user's data.
-- ----------------------------------------------------------------------------
create or replace function public.company_application_count_since(
  p_user_id uuid, p_company_id uuid, p_since timestamptz
) returns integer
language sql
stable
as $$
  select count(*)::integer
  from public.applications a
  join public.job_listings j on j.id = a.job_id
  where a.user_id = p_user_id
    and j.company_id = p_company_id
    and a.created_at >= p_since;
$$;

comment on function public.company_application_count_since is
  'Company Discovery Intelligence Layer. Rolling-window application count per company, for the Phase 4 diversity/cooldown gate. Not called by any application code yet.';

grant execute on function public.company_application_count_since(uuid, uuid, timestamptz) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7. New view: ATS source performance. Computed over the EXISTING import_logs
--    table (which already has found/imported/duplicate/rejected/manual_review
--    counts and an ats field) rather than a new maintained rollup table
--    (consolidated audit report §7: "ats_source_stats — unnecessary").
--
--    security_invoker = true is REQUIRED here: without it, a Postgres view
--    executes with the privileges/RLS context of the view's OWNER (not the
--    querying user), which would silently bypass import_logs' per-user RLS
--    and leak every user's import history to any authenticated caller. With
--    security_invoker, the view enforces RLS exactly as a direct query would.
-- ----------------------------------------------------------------------------
create or replace view public.ats_source_performance
with (security_invoker = true) as
select
  user_id,
  ats,
  count(distinct source_id)                       as sources_used,
  sum(found)                                       as jobs_found,
  sum(imported)                                    as jobs_imported,
  sum(duplicate)                                   as duplicates,
  sum(rejected)                                    as rejected,
  sum(manual_review)                               as manual_review,
  count(*) filter (where success)                  as successful_runs,
  count(*)                                         as total_runs
from public.import_logs
group by user_id, ats;

comment on view public.ats_source_performance is
  'Company Discovery Intelligence Layer. Read-only rollup over the existing import_logs table. security_invoker=true so per-user RLS on import_logs is preserved. Not yet surfaced in any UI (planned for Phase 6 / Analytics extension).';

grant select on public.ats_source_performance to authenticated, service_role;

-- ============================================================================
-- End of Phase 1. Summary of everything this migration creates:
--   1 new enum:      company_discovery_status
--   1 table extended: public.companies            (+31 nullable/defaulted columns)
--   1 table extended: public.user_settings         (+6 nullable/defaulted columns)
--   2 new tables:     public.company_similarity, public.discovery_runs
--   1 new function:   public.company_application_count_since(uuid, uuid, timestamptz)
--   1 new view:       public.ats_source_performance
--   8 new indexes:    idx_companies_user_domain_lookup, idx_companies_discovery_status,
--                      idx_companies_opportunity_score, idx_companies_last_checked,
--                      idx_companies_ats_provider, idx_company_similarity_a,
--                      idx_company_similarity_b, idx_discovery_runs_user_started
--   8 new RLS policies: 4 on company_similarity, 4 on discovery_runs (identical
--                      auth.uid() = user_id pattern used by every existing table)
--
-- Nothing above is referenced by any file under src/ as of this commit —
-- verified by `git diff` touching only supabase/migrations/. Existing scoring
-- (scoring.ts, auto-review-scoring.ts), ingestion (ingest.functions.ts), and
-- every existing route are byte-for-byte unchanged.
-- ============================================================================
