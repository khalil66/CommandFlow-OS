-- ROLLBACK for supabase/migrations/20261026025804_scheduled_lock_heartbeat_and_preflight.sql
--
-- Reverses, in dependency order: the trigger, its function, the
-- discovery_runs_scheduler_lock_index_status() RPC (added in the Final
-- Production Safety Corrections round), the db_now() RPC, then the
-- heartbeat_at column. The duplicate-row preflight check (a DO block) has
-- no persistent object to roll back. Neither RPC's REVOKE/GRANT needs an
-- explicit undo — DROP FUNCTION removes a function's grants along with
-- the function itself.
--
-- IMPORTANT: if this rollback runs, scheduledScoutIngest's runtime index
-- check (added in the same round) will find
-- discovery_runs_scheduler_lock_index_status() missing and correctly fail
-- closed (status: 'fatal_configuration_error') on every future invocation
-- — exactly as intended. Re-enable scheduling only after re-applying this
-- migration (and the manual unique-index statement) if that happens.
--
-- SAFE: dropping a trigger/function/column never touches any other table
-- data. Dropping heartbeat_at discards only heartbeat timestamps
-- themselves (not run_started_at/run_finished_at/notes or any other
-- discovery_runs data) — acceptable since, once rolled back, nothing reads
-- heartbeat_at anymore either.
--
-- IMPORTANT: if supabase/manual_migrations/discovery_runs_scheduled_lock_unique_index.sql
-- has already been applied, run its own rollback
-- (ROLLBACK_discovery_runs_scheduled_lock_unique_index.sql) FIRST — that
-- index's predicate does not reference heartbeat_at, so ordering between
-- the two rollbacks is not strictly required for correctness, but rolling
-- back in the reverse order you applied things in is the safer default.
DROP TRIGGER IF EXISTS discovery_runs_stamp_heartbeat_trg ON public.discovery_runs;
DROP FUNCTION IF EXISTS public.discovery_runs_stamp_heartbeat();
DROP FUNCTION IF EXISTS public.discovery_runs_scheduler_lock_index_status();
DROP FUNCTION IF EXISTS public.db_now();
ALTER TABLE public.discovery_runs DROP COLUMN IF EXISTS heartbeat_at;
