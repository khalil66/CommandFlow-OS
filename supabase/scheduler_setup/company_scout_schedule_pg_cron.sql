-- ============================================================================
-- CommandFlow OS — Phase 3.2: pg_cron registration for the scheduled
-- Company Scout -> ingestion orchestration.
--
-- THIS IS NOT A MIGRATION. It is deliberately kept OUTSIDE
-- supabase/migrations/ so the Supabase CLI / migration runner never
-- auto-applies it — exactly the same convention this repo already uses for
-- supabase/rollback_scripts/. Run it BY HAND, once, via the Supabase SQL
-- editor, only when you are ready to register the schedule. It has NOT been
-- run as part of Phase 3.2 — no cron job exists yet from this work.
--
-- WHY NOT A MIGRATION: a cron.schedule() call for this endpoint must embed
-- (a) the deployed app's URL, which is deployment-specific, and (b) the
-- COMMAND_FLOW_SCHEDULER_SECRET value as a request header, which must NEVER
-- be committed to git in plaintext. A migration file is version-controlled
-- and would either hardcode a secret (unacceptable) or require templating
-- infrastructure this repo doesn't have. This repo's own existing scheduled
-- job — see src/routes/api/public/hooks/retry-queue.ts's header comment,
-- "Runs every 15 minutes via pg_cron" — was set up the same way: manually,
-- outside migrations. No new convention is being introduced here.
--
-- SAFETY: registering this cron job is not itself dangerous. Every fire is
-- a no-op ("status": "disabled") until COMMAND_FLOW_SCHEDULE_ENABLED=true is
-- explicitly set in the deployed app's environment (Phase 3.2, Step 5) — the
-- gate lives in application code (scheduledScoutIngest), not in whether the
-- cron job exists. It is still recommended to leave this UNSCHEDULED until
-- you have manually verified one live curl call end-to-end (see the "first
-- controlled validation procedure" in the Phase 3.2 final report).
--
-- PREREQUISITES (set in the deployed app's environment, never in this file):
--   COMMAND_FLOW_SCHEDULER_SECRET     — a long random value, e.g.
--                                        `openssl rand -hex 32`
--   COMMAND_FLOW_SCHEDULER_USER_ID    — the CommandFlow user (uuid) that owns
--                                        the companies/job_sources/job_listings
--                                        this schedule should act on
--   COMMAND_FLOW_SCHEDULE_ENABLED     — "false" until you're ready to go live
--   COMMAND_FLOW_SCHEDULE_DRY_RUN     — "true" for the first N runs
-- ============================================================================

-- 1. Extensions this project needs for an HTTP-calling cron job (idempotent
--    — safe to run even if already enabled; pg_cron is very likely already
--    enabled given retry-queue.ts's existing 15-minute job).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Replace the two placeholders below before running:
--      <YOUR_DEPLOYED_APP_URL>      e.g. https://commandflow-os.example.workers.dev
--      <COMMAND_FLOW_SCHEDULER_SECRET_VALUE>   the SAME value set in the
--                                               deployed app's
--                                               COMMAND_FLOW_SCHEDULER_SECRET
--                                               environment variable.
--    Never commit this file back to git with the placeholders filled in.
--
--    Cadence: every 12 hours (Step 8's conservative recommended default —
--    '0 */12 * * *'). To change cadence later, re-run cron.schedule() with
--    the same job name; pg_cron replaces the existing schedule for that name
--    rather than creating a duplicate.
select cron.schedule(
  'company-scout-schedule',
  '0 */12 * * *',
  $$
  select net.http_post(
    url := '<YOUR_DEPLOYED_APP_URL>/api/public/hooks/company-scout-schedule',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-commandflow-scheduler-secret', '<COMMAND_FLOW_SCHEDULER_SECRET_VALUE>'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ---- To check the job is registered ----
-- select * from cron.job where jobname = 'company-scout-schedule';

-- ---- To inspect recent run history ----
-- select * from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'company-scout-schedule')
--   order by start_time desc limit 20;

-- ---- To disable/remove the schedule entirely (companion to this file) ----
-- select cron.unschedule('company-scout-schedule');
