-- Phase 3.2 hardening — heartbeat-backed lease: tracked, transaction-safe
-- portion. Every statement in this file is ordinary, fully transactional
-- DDL/DML (no CONCURRENTLY, no ALTER SYSTEM) and is safe to run through the
-- normal Supabase CLI migration flow (`supabase migration up` / `db push`)
-- regardless of CLI version. STATUS: PREPARED, NOT YET APPLIED.
--
-- This file does NOT create the atomic uniqueness guarantee for the
-- scheduler lock. That is a SEPARATE, hand-run-only statement — see
-- supabase/manual_migrations/discovery_runs_scheduled_lock_unique_index.sql
-- and the important ordering note at the bottom of this file.
--
-- ============================================================================
-- 1. heartbeat_at column
-- ============================================================================
-- Nullable, no default: a plain ADD COLUMN on a nullable column with no
-- default is a fast, metadata-only operation in modern Postgres (no table
-- rewrite, no long lock). Only ever populated for triggered_by='scheduled'
-- rows (see the trigger below) — every pre-existing and future
-- triggered_by='manual' row (Company Scout's own audit-log insert) is
-- completely unaffected and keeps heartbeat_at = NULL forever.
ALTER TABLE public.discovery_runs
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz;

-- ============================================================================
-- 2. DB-time heartbeat stamping trigger
-- ============================================================================
-- WHY: the application must "use database time where practical to avoid
-- clock-skew issues" for the heartbeat lease. Postgres function.
-- `now()`/triggers always see the DATABASE server's clock, never the
-- application server's — so instead of trusting whatever timestamp the app
-- sends for heartbeat_at, this trigger overwrites it with the database's
-- own `now()` on every insert/update, for scheduled rows only. The
-- application can send any placeholder value (or omit it); the persisted
-- value is always database-clock-accurate. This can never be bypassed by a
-- future application bug that forgets to pass a correct value.
CREATE OR REPLACE FUNCTION public.discovery_runs_stamp_heartbeat()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.triggered_by = 'scheduled' THEN
    NEW.heartbeat_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS discovery_runs_stamp_heartbeat_trg ON public.discovery_runs;
CREATE TRIGGER discovery_runs_stamp_heartbeat_trg
  BEFORE INSERT OR UPDATE ON public.discovery_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.discovery_runs_stamp_heartbeat();

-- ============================================================================
-- 3. db_now() RPC — a trustworthy database-time anchor for the application's
--    staleness/lease-expiry DECISIONS (the trigger above covers the WRITE
--    side; this covers the READ/comparison side — PostgREST filters can't
--    express "now() - interval" server-side, so the application fetches
--    this once per scheduler invocation instead of using its own
--    `Date.now()` to compute a staleness cutoff).
-- ============================================================================
-- Read-only, STABLE, trivially reversible (DROP FUNCTION), no side effects.
-- SECURITY (per the Final Production Safety Corrections review): this stays
-- SECURITY INVOKER (the default -- never elevate this to DEFINER; nothing
-- here needs privileges beyond what the caller already has), with
-- search_path pinned and `now()` fully schema-qualified so its name
-- resolution can never be influenced by a caller's own session
-- search_path. Execution is explicitly restricted to service_role below --
-- this function is callable ONLY by the Phase 3.2 scheduler's own
-- service-role Supabase client (src/routes/api/public/hooks/
-- company-scout-schedule.ts uses supabaseAdmin exclusively). No
-- interactive/RLS-scoped caller has ever had a legitimate reason to call
-- this.
CREATE OR REPLACE FUNCTION public.db_now()
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$ SELECT pg_catalog.now(); $$;

-- Explicit least-privilege grant -- every function this repo has ever
-- added to the public schema does this (see handle_new_user,
-- update_updated_at_column, is_admin in earlier migrations); db_now()
-- previously omitted it, which left it at Postgres's default (EXECUTE
-- granted to PUBLIC on CREATE FUNCTION) -- reachable via PostgREST's
-- /rpc/db_now by any authenticated, and possibly anon, API caller. Low
-- real-world impact (it returns only the database's current timestamp,
-- already visible via ordinary HTTP response Date headers) but an
-- unreviewed, ungated public RPC surface nonetheless. Corrected here.
REVOKE EXECUTE ON FUNCTION public.db_now() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.db_now() TO service_role;

-- ============================================================================
-- 4. discovery_runs_scheduler_lock_index_status() RPC -- runtime
--    verification that discovery_runs_scheduled_open_lock_uidx (the
--    hand-run, CONCURRENTLY-built partial unique index -- see
--    supabase/manual_migrations/discovery_runs_scheduled_lock_unique_index.sql)
--    actually exists, is valid, is unique, and matches the exact
--    definition this application depends on, BEFORE the scheduler is
--    allowed to acquire a lock or invoke Scout/ingestion at all.
-- ============================================================================
-- WHY THIS EXISTS (Final Production Safety Corrections review): until now,
-- "the index must exist before production scheduling is enabled" was
-- enforced ONLY by operator discipline -- a runbook comment and a manual
-- verification query, never checked by the running application. A single
-- forgotten step (enabling COMMAND_FLOW_SCHEDULE_ENABLED before running
-- the manual index-creation SQL, in any environment) would silently
-- revert the scheduler to the original, pre-hardening read-then-insert
-- race, with no error and no telemetry signal. scheduledScoutIngest now
-- calls this RPC itself, every invocation, before touching discovery_runs
-- for any other purpose -- see company-scout-schedule.functions.ts.
--
-- Deliberately avoids a brittle whole-statement string comparison against
-- pg_get_indexdef() (index DDL text formatting can vary across Postgres
-- versions/settings) -- instead inspects the structural pieces this
-- application actually depends on individually: the index exists on
-- public.discovery_runs, is valid (not left behind invalid by an
-- interrupted CONCURRENTLY build), is unique, is keyed on exactly one
-- column (user_id), and its partial predicate references both
-- triggered_by = 'scheduled' and run_finished_at IS NULL.
--
-- SECURITY INVOKER (the default) is correct and sufficient here -- every
-- pg_catalog system view/table this reads is world-readable in Postgres
-- regardless of caller; no elevated privilege is required or granted.
-- search_path is pinned and every catalog reference is fully
-- schema-qualified, for the same reason as db_now() above.
CREATE OR REPLACE FUNCTION public.discovery_runs_scheduler_lock_index_status()
RETURNS TABLE (
  index_exists boolean,
  index_valid boolean,
  index_unique boolean,
  index_definition_ok boolean,
  index_def text
)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_indexrelid oid;
  v_isvalid boolean;
  v_isunique boolean;
  v_def text;
  v_colname text;
  v_predicate text;
BEGIN
  SELECT c.oid INTO v_indexrelid
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'discovery_runs_scheduled_open_lock_uidx'
    AND n.nspname = 'public'
    AND c.relkind = 'i';

  IF v_indexrelid IS NULL THEN
    RETURN QUERY SELECT false, false, false, false, NULL::text;
    RETURN;
  END IF;

  SELECT i.indisvalid, i.indisunique, pg_catalog.pg_get_indexdef(i.indexrelid)
    INTO v_isvalid, v_isunique, v_def
  FROM pg_catalog.pg_index i
  WHERE i.indexrelid = v_indexrelid;

  SELECT a.attname INTO v_colname
  FROM pg_catalog.pg_index i2
  JOIN pg_catalog.pg_attribute a
    ON a.attrelid = i2.indrelid AND a.attnum = i2.indkey[0]
  WHERE i2.indexrelid = v_indexrelid;

  SELECT pg_catalog.pg_get_expr(i3.indpred, i3.indrelid) INTO v_predicate
  FROM pg_catalog.pg_index i3
  WHERE i3.indexrelid = v_indexrelid;

  RETURN QUERY SELECT
    true,
    coalesce(v_isvalid, false),
    coalesce(v_isunique, false),
    (
      coalesce(v_isvalid, false)
      AND coalesce(v_isunique, false)
      AND v_colname = 'user_id'
      AND v_predicate IS NOT NULL
      AND v_predicate ILIKE '%triggered_by%scheduled%'
      AND v_predicate ILIKE '%run_finished_at%is null%'
    ),
    v_def;
END;
$$;

-- Same least-privilege rationale as db_now() above: only the scheduler's
-- service-role client ever needs this.
REVOKE EXECUTE ON FUNCTION public.discovery_runs_scheduler_lock_index_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.discovery_runs_scheduler_lock_index_status() TO service_role;

-- ============================================================================
-- 5. Duplicate-row preflight check
-- ============================================================================
-- STATUS / IMPORTANT CAVEAT (per explicit review): this check is informational
-- and operator-facing ONLY. It reduces the chance of applying
-- discovery_runs_scheduled_open_lock_uidx (the actual atomic-exclusivity
-- index — see supabase/manual_migrations/) onto data that already violates
-- it, by surfacing a clear, actionable error instead of Postgres's generic
-- "could not create unique index" message. It runs in its own transaction,
-- here, separately from that index's creation (which cannot run in a
-- transaction at all). BECAUSE these are two separate operations at two
-- separate times, THIS CHECK DOES NOT AND CANNOT ELIMINATE THE RACE: a new
-- duplicate open-lock row could in principle be inserted after this check
-- runs and before the index is built. It is a diagnostic aid, not an
-- enforcement mechanism. THE PARTIAL UNIQUE INDEX ITSELF — not this check —
-- is the only real, final enforcement of "at most one open scheduled lock
-- per user." Scheduling must not be enabled in production until that index
-- has been created AND its existence verified (e.g.
-- `SELECT indexname, indisvalid FROM pg_indexes JOIN pg_index ON ...` or
-- simply `\d discovery_runs` in psql / the Supabase SQL editor, checking
-- the index is listed and NOT marked invalid).
DO $$
DECLARE
  dup_user_count integer;
  dup_detail text;
BEGIN
  SELECT count(*) INTO dup_user_count FROM (
    SELECT user_id
    FROM public.discovery_runs
    WHERE triggered_by = 'scheduled' AND run_finished_at IS NULL
    GROUP BY user_id
    HAVING count(*) > 1
  ) dupes;

  IF dup_user_count > 0 THEN
    SELECT string_agg(format('user_id=%s (%s open rows)', user_id, cnt), ', ')
      INTO dup_detail
    FROM (
      SELECT user_id, count(*) AS cnt
      FROM public.discovery_runs
      WHERE triggered_by = 'scheduled' AND run_finished_at IS NULL
      GROUP BY user_id
      HAVING count(*) > 1
    ) d;

    RAISE EXCEPTION
      'discovery_runs_scheduled_open_lock_uidx precondition failed: % user(s) already have more than one OPEN (run_finished_at IS NULL) triggered_by=''scheduled'' discovery_runs row: %. '
      'This check intentionally does NOT auto-resolve this — no row has been closed, finished, or deleted. '
      'Investigate which of each user''s open rows (if any) is a genuinely abandoned/crashed run, close ONLY that one by hand '
      '(set run_finished_at), and re-check before creating the unique index. Remember: passing this check now does not '
      'guarantee no duplicate appears later — re-verify immediately before running the index creation statement.',
      dup_user_count, dup_detail;
  END IF;

  RAISE NOTICE 'discovery_runs_scheduled_open_lock_uidx precondition check passed at %: no user has more than one open scheduled lock row right now. This is a point-in-time check, not a guarantee — proceed directly to the index creation statement without a long delay.', clock_timestamp();
END $$;

-- ============================================================================
-- ORDERING REQUIREMENT (operational, AND now also enforced at runtime):
--   1. Apply this file (via normal `supabase migration up` / `db push`).
--      This also creates discovery_runs_scheduler_lock_index_status(),
--      which scheduledScoutIngest now calls on EVERY invocation, before
--      touching discovery_runs for any other purpose.
--   2. Immediately run supabase/manual_migrations/discovery_runs_scheduled_lock_unique_index.sql
--      by hand (SQL editor or psql) — do not leave a gap between the
--      preflight passing and the index being created.
--   3. VERIFY the index exists and is valid before enabling scheduling
--      (COMMAND_FLOW_SCHEDULE_ENABLED) anywhere — either by hand (see that
--      file's verification query) or simply by enabling scheduling and
--      observing scheduledScoutIngest's own runtime check succeed.
-- Scheduling must remain disabled until step 3 is confirmed. As of the
-- Final Production Safety Corrections round, forgetting step 2 is no
-- longer silent: scheduledScoutIngest's runtime index check will return
-- status: 'fatal_configuration_error' and perform no lock/Scout/ingest
-- work at all until discovery_runs_scheduler_lock_index_status() reports
-- the index exists, is valid, is unique, and matches the expected
-- definition.
-- ============================================================================
