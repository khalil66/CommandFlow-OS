// ============================================================================
// Company Discovery Intelligence Layer — Phase 3.2: Scheduled Scout→Ingest
// orchestration.
//
// PROBLEM THIS SOLVES: the Phase 3.1 handoff (runScoutAndIngestCore) already
// connects Company Scout to ingestion, but only when a human calls it. This
// file adds a machine-triggerable entrypoint (scheduledScoutIngest) so an
// external scheduler (pg_cron, in this repo's case — see the file header on
// the HTTP route this backs, ../routes/api/public/hooks/company-scout-schedule.ts)
// can run the exact same handoff unattended, on a cadence, safely.
//
// SAFETY MODEL — read this before changing anything:
//   - OFF by default (scheduleEnabled must be explicitly true) and dry-run
//     by default (dryRun must be explicitly false to mutate). Both gates are
//     enforced HERE, in the core, not just at the HTTP boundary — so a test
//     or a future caller that skips the HTTP route still gets the same
//     default-safe behavior.
//   - When disabled, this function performs ZERO Supabase calls of any kind
//     (no lock read, no lock write, no Scout, no ingest) — not just zero
//     writes.
//   - Ingestion is only ever reachable through runScoutAndIngestCore's own
//     dry-run/ingest_after_scout gating (Phase 3.1) — this file adds
//     scheduling and locking around that call, it does not re-implement or
//     loosen any of its guarantees.
//   - This file never imports from, or calls, runSmartApply,
//     evaluateAutoReview, or any other application-submission surface. See
//     the "Q. scheduled path never creates applications" describe block in
//     company-scout-schedule.functions.test.ts for the enforced boundary.
//     Phase 3.2 ends at job_listings, exactly like Phase 3.1.
//   - The scheduled endpoint's user identity comes from an operator-configured
//     environment variable (COMMAND_FLOW_SCHEDULER_USER_ID), validated as a
//     UUID before any Supabase call — never trusted unchecked, never
//     hardcoded, never exposed in a response.
//
// RUN LOCK — reuses the EXISTING discovery_runs table (Phase 1) rather than
// a new migration. Phase 1's own migration comment already anticipated this:
// `triggered_by text not null default 'manual' -- 'manual' | 'scheduled' |
// 'expansion_mode' — 'scheduled' unused until a scheduler exists`. Every
// pre-Phase-3.2 discovery_runs row (written by runCompanyScoutCore itself,
// always with triggered_by='manual' and run_started_at/run_finished_at set
// together in one insert at the END of a run) can never match this lock's
// own query filter (triggered_by='scheduled' AND run_finished_at IS NULL),
// so there is no collision with existing data or with Company Scout's own
// unrelated audit-log insert, and runCompanyScoutCore needed no changes.
// The lock lifecycle is entirely owned by this file:
//   1. Before calling Scout: look for an existing discovery_runs row for
//      this user with triggered_by='scheduled' AND run_finished_at IS NULL.
//        - none found            -> insert one (run_finished_at: null) = lock held.
//        - found, still fresh    -> lock_not_acquired, this run is skipped.
//        - found, stale (older than LOCK_STALE_MINUTES) -> treat as a
//          crashed previous run: close it out (run_finished_at = now(),
//          notes explain the recovery) and proceed as if it were absent.
//   2. After Scout+ingest finishes (success OR failure): update the SAME
//      row's run_finished_at, releasing the lock. A thrown exception is
//      still caught and still releases the lock — a failure never leaves a
//      permanent deadlock (LOCK_STALE_MINUTES is also a hard backstop even
//      if release itself somehow never runs).
// This is a row-based lock, not a transactional Postgres advisory lock.
//
// ATOMIC ACQUISITION (Phase 3.2 hardening): the original design accepted a
// read-then-insert race between "read: no active lock" and "insert: new
// lock row" as a tradeoff, on the basis that this repo runs at most one
// scheduled trigger per user. That race is closed at the database level by
// discovery_runs_scheduled_open_lock_uidx — a partial unique index on
// (user_id) WHERE triggered_by='scheduled' AND run_finished_at IS NULL.
// THIS INDEX — not the duplicate-row preflight check that also exists in
// the tracked migration — is the FINAL enforcement mechanism: a preflight
// check run in an earlier, separate transaction cannot close the window
// between "checked: no duplicates" and "index exists", so it is a
// diagnostic aid only. See supabase/manual_migrations/
// discovery_runs_scheduled_lock_unique_index.sql (hand-run only — not a
// tracked migration; see that file for why) — PREPARED, NOT YET APPLIED as
// of this comment. The SELECT below remains a fast path and for stale-lock
// recovery only; real exclusivity comes from the INSERT failing atomically
// with Postgres error 23505 when another invocation already holds the
// lock. PRODUCTION SCHEDULING MUST NOT BE ENABLED until that index exists
// and has been verified valid — see that file's verification query.
//
// HEARTBEAT-BACKED LEASE (Phase 3.2 hardening, round 2): a bare
// run_started_at timestamp cannot distinguish "crashed" from "still
// genuinely, legitimately running" — any fixed staleness window can always
// misclassify a slow-but-alive run as abandoned. heartbeat_at (added by
// supabase/migrations/20261026025804_scheduled_lock_heartbeat_and_preflight.sql)
// + a periodic in-process refresh turn this into a real lease: a run only
// stays "alive" in the eyes of recovery as long as it keeps renewing
// heartbeat_at within HEARTBEAT_LEASE_MINUTES. Clock skew between the app
// server and the database is avoided on both sides: a database trigger
// (discovery_runs_stamp_heartbeat_trg) overwrites heartbeat_at with the
// DATABASE's own `now()` on every write regardless of what value this code
// sends, and staleness DECISIONS are anchored to a database-time snapshot
// fetched via the db_now() RPC rather than this process's own clock.
// Do not rely solely on run_started_at — see `isStale` below.
//
// FAIL-CLOSED ON db_now()/INDEX VERIFICATION (Phase 3.2 Final Production
// Safety Corrections round): earlier rounds of this hardening effort
// treated a missing or failing db_now() RPC as "fall back to the coarser,
// pre-heartbeat-lease run_started_at-only policy" — safe in the sense that
// it never reclaimed a lock too eagerly, but OPAQUE: an operator could
// stay silently degraded indefinitely (e.g. db_now()'s privileges
// misconfigured, or the heartbeat migration simply never applied) with no
// error and no telemetry signal. That silent fallback is REMOVED. Once
// scheduling is enabled, both db_now() succeeding with a real, parseable
// timestamp AND discovery_runs_scheduler_lock_index_status() reporting the
// partial unique index present/valid/unique/correctly-defined are now
// REQUIRED preconditions, checked on every invocation before this run
// touches discovery_runs for any other purpose. Either one missing or
// failing returns status: 'fatal_configuration_error' immediately — no
// lock read, no lock insert, no Scout, no ingest.
//
// FENCING / LOST OWNERSHIP — read before assuming this is airtight: if this
// run's heartbeat renewal fails or is reclaimed by another invocation while
// Scout is still executing, this file CANNOT cancel that already in-flight
// Scout call — runScout (and the Company Scout pipeline internals it
// calls) expose no cancellation token, and wiring one through would be a
// substantial change to those files, out of scope here.
//
// What this file DOES do once ownership loss is detected (via a failed
// heartbeat refresh, checked by lock id with a fail-closed `.is(
// "run_finished_at", null)` guard — see `refreshHeartbeat`):
//   1. (Final Production Safety Corrections round) it passes
//      `shouldContinue: () => !ownershipLost` into runScoutAndIngest —
//      checked exactly once, by runScoutAndIngestCore, immediately after
//      Scout returns and before ingestion (the SECOND write-producing
//      phase) would start. If ownership was lost at any point while Scout
//      was running, ingestion never starts at all (`ingest_skipped_reason:
//      "ownership_lost"`). This narrows the gap by one phase; it does NOT
//      close it — Scout itself, once started, still always runs to
//      completion.
//   2. It never reports a plain "completed" success for that run (a
//      distinct `lock_lost` status is returned instead, so no caller
//      mistakes the result for an uncontested run), and its own release
//      attempt is itself guarded the same way so it can never clobber
//      whatever the reclaiming invocation already wrote.
// It does NOT retroactively undo any job_sources/job_listings rows Scout
// already wrote before ownership was lost — those writes are already
// governed by Phase 3.1's own idempotency/dedupe guarantees, and the lock
// has only ever prevented a SECOND invocation from STARTING concurrently,
// never aborted Scout's own FIRST, already in-flight call (true before
// this hardening pass too, and still true after it). This is a reported,
// narrowed limitation, not a fully solved problem — see the Phase 3.2
// hardening reports for the full reasoning, including why a true Postgres
// advisory lock was considered and rejected (this app talks to Postgres
// via supabase-js/PostgREST, which gives each call its own request-scoped
// connection — an advisory lock taken inside one RPC call releases as soon
// as that call ends, so it cannot span a scheduled run's multiple separate
// calls).
//
// STATUS MODEL (Step 9 of the Phase 3.2 authorization, extended) — the
// literal states requested (scout_completed, scout_partial_failure,
// ingest_completed, ingest_partial_failure, disabled, dry_run,
// lock_not_acquired, fatal_configuration_error) are not all mutually
// exclusive (e.g. Scout can partially fail while ingest still completes for
// the sources that did resolve), so they are represented as a small
// combination of fields rather than one flat enum:
//   - status: 'disabled' | 'fatal_configuration_error' | 'lock_not_acquired'
//             | 'lock_lost'   (ownership could not be confirmed for the
//                               full run — see FENCING above; Scout/ingest
//                               may still have run and partially written
//                               data, reported via scout/ingest below, but
//                               this is never reported as plain 'completed')
//             | 'completed'   (the run reached and returned from Scout/ingest,
//                               held its lease the whole time, regardless of
//                               dry-run or partial failures — 'dry_run'
//                               itself is reported via `mode`, not folded
//                               into `status`, since mode already
//                               distinguishes it per Step 10.)
//   - scout_status:  'completed' | 'partial_failure' | 'not_attempted'
//   - ingest_status: 'completed' | 'partial_failure' | 'not_attempted'
//                     | 'skipped_dry_run' | 'skipped_not_requested'
//                     | 'skipped_no_eligible_sources'
//                     | 'skipped_ownership_lost' (Final Production Safety
//                       Corrections round — the shouldContinue ownership-
//                       fencing checkpoint in runScoutAndIngestCore
//                       reported lost ownership immediately before
//                       ingestion would have started; see FENCING above.
//                       Always paired with status: 'lock_lost'.)
// Every literal state in the Step 9 list is recoverable from this
// combination: e.g. "dry_run" = mode==='dry_run' && ingest_status===
// 'skipped_dry_run'; "scout_partial_failure" = scout_status===
// 'partial_failure'. See the Phase 3.2 final report for the full mapping.
// ============================================================================

import { runScoutAndIngestCore, type RunScoutAndIngestResult } from "./company-scout-ingest.functions";

export const SCHEDULER_VERSION = "3.2.0";
// Legacy fallback only: used when a CANDIDATE LOCK ROW has no usable
// heartbeat_at of its own (e.g. a row written before the heartbeat
// migration existed). db_now() itself is now a REQUIRED precondition for
// this run to proceed at all (see the FAIL-CLOSED header note above) — it
// is never the reason this constant is used; only a specific row's own
// missing heartbeat_at is. See `isStale` below. Matches the pre-lease 2h
// staleness convention this file (and retry-queue.ts) originally used.
const LOCK_STALE_MINUTES = 120;
// Heartbeat-lease window: a scheduled lock row is considered abandoned once
// its heartbeat_at is older than this, per DATABASE time. Short relative to
// LOCK_STALE_MINUTES on purpose — a genuinely alive run renews heartbeat_at
// roughly every HEARTBEAT_INTERVAL_MS, so missing this many minutes' worth
// of renewals (10 consecutive ticks at the default interval) is a much
// stronger signal of abandonment than a bare elapsed-time guess ever was.
const HEARTBEAT_LEASE_MINUTES = 5;
// How often a run refreshes its own heartbeat while Scout/ingest executes.
// Overridable per call via ScheduledScoutIngestParams.heartbeatIntervalMs
// (tests only — production never overrides this).
const HEARTBEAT_INTERVAL_MS = 30_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ScheduledScoutIngestParams {
  supabase: any;
  // Operator-configured owning user. Validated as a UUID before use; never
  // hardcoded, never read from a request body, never client-controlled.
  userId: string | null | undefined;
  // Both gates default to the SAFEST value if omitted — matching the HTTP
  // route's own env-var defaults (COMMAND_FLOW_SCHEDULE_ENABLED=false,
  // COMMAND_FLOW_SCHEDULE_DRY_RUN=true) — so a caller (test or otherwise)
  // that forgets to pass them gets "do nothing" / "preview only", not a
  // silent live run.
  scheduleEnabled?: boolean;
  dryRun?: boolean;
  // Scheduled orchestration's entire purpose is Scout -> ingest; defaults to
  // true (unlike the interactive runCompanyScoutAndIngest endpoint, whose
  // own default is false). Still fully gated by dryRun and by
  // runScoutAndIngestCore's own eligible-source-id requirement either way.
  ingestAfterScout?: boolean;
  scoutInput?: {
    levels?: number[];
    max_candidates_evaluated?: number;
    max_new_companies_validated?: number;
    max_new_job_sources?: number;
  };
  // Free-text label for telemetry only (e.g. "pg_cron", "manual_test").
  triggerSource?: string;
  // Phase 3.2 hardening — heartbeat-lease DI seam: how often this run
  // refreshes discovery_runs.heartbeat_at while Scout/ingest executes.
  // Tests override this (combined with vi.useFakeTimers()) to exercise
  // renewal without waiting for real wall-clock time; production never
  // overrides it — see HEARTBEAT_INTERVAL_MS.
  heartbeatIntervalMs?: number;
  // DI seams — both default to the real production implementation. Tests
  // inject fakes; production never overrides these.
  runScoutAndIngest?: (params: Parameters<typeof runScoutAndIngestCore>[0]) => Promise<RunScoutAndIngestResult>;
  now?: () => Date;
}

export interface ScheduledRunError {
  stage: string;
  entity: string;
  message: string;
}

export interface ScheduledRunTelemetry {
  run_id: string | null;
  started_at: string;
  completed_at: string;
  duration_ms: number;
  mode: "dry_run" | "live";
  // 'lock_lost': this run's heartbeat lease could not be confirmed held for
  // the full duration (see the FENCING comment above `scheduledScoutIngest`)
  // — Scout/ingest may still have executed and partially written data
  // (reflected in scout/ingest below), but this is never reported as a
  // plain, uncontested 'completed' success.
  status: "disabled" | "fatal_configuration_error" | "lock_not_acquired" | "lock_lost" | "completed";
  scout_status: "completed" | "partial_failure" | "not_attempted";
  ingest_status:
    | "completed"
    | "partial_failure"
    | "not_attempted"
    | "skipped_dry_run"
    | "skipped_not_requested"
    | "skipped_no_eligible_sources"
    | "skipped_ownership_lost";
  scout: {
    candidates_evaluated: number;
    companies_validated: number;
    companies_rejected: number;
    sources_added: number;
    sources_updated: number;
  };
  ingest: {
    sources_requested: number;
    sources_processed: number;
    jobs_fetched: number;
    jobs_inserted: number;
    jobs_deduped: number;
    hard_rejected: number;
    manual_review: number;
    ready_to_apply: number;
  };
  scheduler: {
    trigger_source: string;
    lock_acquired: boolean;
    schedule_enabled: boolean;
    scheduler_version: string;
  };
  errors: ScheduledRunError[];
}

const EMPTY_SCOUT = { candidates_evaluated: 0, companies_validated: 0, companies_rejected: 0, sources_added: 0, sources_updated: 0 };
const EMPTY_INGEST = { sources_requested: 0, sources_processed: 0, jobs_fetched: 0, jobs_inserted: 0, jobs_deduped: 0, hard_rejected: 0, manual_review: 0, ready_to_apply: 0 };

export async function scheduledScoutIngest(params: ScheduledScoutIngestParams): Promise<ScheduledRunTelemetry> {
  const now = params.now ?? (() => new Date());
  const startedAt = now();
  const dryRun = params.dryRun ?? true; // default-safe
  const scheduleEnabled = params.scheduleEnabled ?? false; // default-safe
  const triggerSource = params.triggerSource ?? "unknown";
  const runScoutAndIngest = params.runScoutAndIngest ?? runScoutAndIngestCore;

  const finish = (overrides: Partial<ScheduledRunTelemetry>): ScheduledRunTelemetry => {
    const completedAt = now();
    return {
      run_id: null,
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      duration_ms: completedAt.getTime() - startedAt.getTime(),
      mode: dryRun ? "dry_run" : "live",
      status: "completed",
      scout_status: "not_attempted",
      ingest_status: "not_attempted",
      scout: EMPTY_SCOUT,
      ingest: EMPTY_INGEST,
      scheduler: { trigger_source: triggerSource, lock_acquired: false, schedule_enabled: scheduleEnabled, scheduler_version: SCHEDULER_VERSION },
      errors: [],
      ...overrides,
    };
  };

  // ---- Gate 1: schedule must be explicitly enabled. Zero Supabase calls
  // of any kind below this point when disabled. ----
  if (!scheduleEnabled) {
    return finish({ status: "disabled" });
  }

  // ---- Gate 2: owning user id must be a real UUID, never trusted unchecked. ----
  if (!params.userId || !UUID_RE.test(params.userId)) {
    return finish({
      status: "fatal_configuration_error",
      errors: [{ stage: "configuration", entity: "COMMAND_FLOW_SCHEDULER_USER_ID", message: "missing or not a valid UUID" }],
    });
  }
  const userId = params.userId;
  const supabase = params.supabase;

  // ---- Run lock (discovery_runs reuse — see file header) ----
  const nowIso = startedAt.toISOString();

  // ---- Gate 3: the partial unique index is the ONLY real atomic-
  // exclusivity guarantee for this lock (see the ATOMIC ACQUISITION
  // comment above) — and, unlike heartbeat_at/db_now()/the trigger, it is
  // NEVER created by the tracked, CLI-applied migration (CREATE INDEX
  // CONCURRENTLY cannot run inside a migration transaction — see
  // supabase/manual_migrations/discovery_runs_scheduled_lock_unique_index.sql
  // for why). That makes it the one piece of this hardening effort an
  // operator could forget, or enable scheduling ahead of, without anything
  // else failing to compile or deploy. Verified here, at runtime, on every
  // invocation, rather than trusted as a completed runbook step — fail
  // closed on anything other than "exists, valid, unique, correctly
  // defined". No discovery_runs read/write, Scout call, or ingest call
  // happens if this fails. ----
  try {
    const { data: indexStatusRaw, error: indexStatusErr } = await supabase.rpc("discovery_runs_scheduler_lock_index_status");
    if (indexStatusErr) {
      return finish({
        status: "fatal_configuration_error",
        errors: [{
          stage: "index_verification",
          entity: "discovery_runs_scheduled_open_lock_uidx",
          message: indexStatusErr.message || "discovery_runs_scheduler_lock_index_status() RPC returned an error",
        }],
      });
    }
    const indexStatus: any = Array.isArray(indexStatusRaw) ? indexStatusRaw[0] : indexStatusRaw;
    if (
      !indexStatus ||
      !indexStatus.index_exists ||
      !indexStatus.index_valid ||
      !indexStatus.index_unique ||
      !indexStatus.index_definition_ok
    ) {
      return finish({
        status: "fatal_configuration_error",
        errors: [{
          stage: "index_verification",
          entity: "discovery_runs_scheduled_open_lock_uidx",
          message: indexStatus
            ? `unique lock index is not production-ready (exists=${indexStatus.index_exists}, valid=${indexStatus.index_valid}, unique=${indexStatus.index_unique}, definition_ok=${indexStatus.index_definition_ok}) — see supabase/manual_migrations/discovery_runs_scheduled_lock_unique_index.sql`
            : "discovery_runs_scheduler_lock_index_status() RPC returned no result",
        }],
      });
    }
  } catch (e: any) {
    return finish({
      status: "fatal_configuration_error",
      errors: [{ stage: "index_verification", entity: "discovery_runs_scheduled_open_lock_uidx", message: (e?.message || String(e)).slice(0, 300) }],
    });
  }

  // ---- Gate 4: database-time anchor (clock-skew avoidance) — REQUIRED,
  // fail-closed. A missing or failing db_now() RPC is no longer treated as
  // "fall back to the coarser run_started_at-only policy" (see the
  // FAIL-CLOSED header note above for why that silent degradation was
  // itself a problem). Once scheduling is enabled, a trustworthy
  // database-time anchor is REQUIRED before this run is allowed to touch
  // discovery_runs, let alone Scout/ingest, at all. ----
  let anchor: Date;
  try {
    const { data: dbNowRaw, error: dbNowErr } = await supabase.rpc("db_now");
    if (dbNowErr) {
      return finish({
        status: "fatal_configuration_error",
        errors: [{ stage: "db_time_anchor", entity: "db_now", message: dbNowErr.message || "db_now() RPC returned an error" }],
      });
    }
    if (!dbNowRaw) {
      return finish({
        status: "fatal_configuration_error",
        errors: [{ stage: "db_time_anchor", entity: "db_now", message: "db_now() RPC returned no value — heartbeat-lease migration likely not applied" }],
      });
    }
    const parsed = new Date(dbNowRaw as string);
    if (isNaN(parsed.getTime())) {
      return finish({
        status: "fatal_configuration_error",
        errors: [{ stage: "db_time_anchor", entity: "db_now", message: "db_now() RPC returned an unparseable timestamp" }],
      });
    }
    anchor = parsed;
  } catch (e: any) {
    return finish({
      status: "fatal_configuration_error",
      errors: [{ stage: "db_time_anchor", entity: "db_now", message: (e?.message || String(e)).slice(0, 300) }],
    });
  }

  const staleCutoffIso = new Date(anchor.getTime() - LOCK_STALE_MINUTES * 60_000).toISOString();
  const heartbeatCutoffIso = new Date(anchor.getTime() - HEARTBEAT_LEASE_MINUTES * 60_000).toISOString();

  const { data: candidateLocks, error: lockReadErr } = await supabase
    .from("discovery_runs")
    .select("id, run_started_at, heartbeat_at")
    .eq("user_id", userId)
    .eq("triggered_by", "scheduled")
    .is("run_finished_at", null);

  if (lockReadErr) {
    return finish({
      status: "fatal_configuration_error",
      errors: [{ stage: "lock_read", entity: "discovery_runs", message: lockReadErr.message }],
    });
  }

  const locks = (candidateLocks ?? []) as { id: string; run_started_at: string; heartbeat_at: string | null }[];

  // Do NOT rely solely on run_started_at: prefer the heartbeat lease
  // whenever a candidate row has a populated heartbeat_at; fall back to
  // the original, coarser, already-reviewed run_started_at-only policy
  // only for a specific row that lacks one (e.g. written before the
  // heartbeat migration existed). db_now() itself is a REQUIRED
  // precondition by this point (Gate 4 above already returned
  // fatal_configuration_error otherwise) — the anchor used below is
  // always a trustworthy database-time snapshot.
  const isStale = (l: { run_started_at: string; heartbeat_at: string | null }): boolean =>
    l.heartbeat_at
      ? l.heartbeat_at <= heartbeatCutoffIso
      : l.run_started_at <= staleCutoffIso;

  const activeLock = locks.find((l) => !isStale(l));
  const staleLocks = locks.filter((l) => isStale(l));

  // Stale-run recovery: close out any abandoned previous lock before
  // deciding whether this run can proceed. Best-effort — a failure here
  // does not block this run's own attempt to acquire a fresh lock.
  //
  // RACE SAFETY (compare-and-swap): the `.is("run_finished_at", null)` on
  // this update re-checks, AT UPDATE TIME, that the row is still open. If
  // the row's real owner finishes (or renews its heartbeat) concurrently
  // with this sweep, the update matches zero rows and the real state is
  // left untouched — this sweep can never overwrite a lock that is
  // genuinely still alive or has genuinely finished in the interim.
  for (const stale of staleLocks) {
    await supabase
      .from("discovery_runs")
      .update({
        run_finished_at: nowIso,
        notes: JSON.stringify({
          scheduler_stale_lock_recovered: true,
          recovered_at: nowIso,
          basis: stale.heartbeat_at ? "heartbeat_lease" : "run_started_at_fallback",
        }),
      })
      .eq("id", stale.id)
      .is("run_finished_at", null);
  }

  if (activeLock) {
    return finish({ status: "lock_not_acquired" });
  }

  const { data: lockRow, error: lockInsertErr } = await supabase
    .from("discovery_runs")
    .insert({
      user_id: userId,
      run_started_at: nowIso,
      run_finished_at: null,
      triggered_by: "scheduled",
      // Stamped with the DATABASE's own now() by
      // discovery_runs_stamp_heartbeat_trg regardless of this value —
      // included only so the payload's shape is self-documenting and so
      // this still behaves sensibly before that migration/trigger exists.
      heartbeat_at: nowIso,
      notes: JSON.stringify({ phase: "lock_acquired", trigger_source: triggerSource }),
    } as any)
    .select("id")
    .single();

  if (lockInsertErr) {
    // Postgres 23505 = unique_violation. Once
    // discovery_runs_scheduled_open_lock_uidx exists, this is exactly the
    // signal that another invocation won the race for this user's lock
    // between our SELECT and this INSERT — a normal, expected outcome,
    // not a configuration/infrastructure problem.
    if ((lockInsertErr as { code?: string }).code === "23505") {
      return finish({ status: "lock_not_acquired" });
    }
    return finish({
      status: "fatal_configuration_error",
      errors: [{ stage: "lock_acquire", entity: "discovery_runs", message: lockInsertErr.message }],
    });
  }
  if (!lockRow) {
    return finish({
      status: "fatal_configuration_error",
      errors: [{ stage: "lock_acquire", entity: "discovery_runs", message: "lock row insert returned no id" }],
    });
  }

  const lockId = (lockRow as { id: string }).id;

  // ---- Heartbeat lease: renew periodically, fail closed on any renewal
  // we cannot confirm. See the FENCING comment above this function for
  // what this can and cannot protect against. ----
  let ownershipLost = false;
  const heartbeatIntervalMs = params.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;

  const refreshHeartbeat = async () => {
    try {
      const { data, error } = await supabase
        .from("discovery_runs")
        .update({ heartbeat_at: now().toISOString() }) // overwritten with the database's own now() by the trigger
        .eq("id", lockId)
        .is("run_finished_at", null)
        .select("id");
      // Fail closed: an error, or zero rows matched, means we cannot
      // CONFIRM we still own this lock (most likely: another invocation's
      // stale-recovery sweep already reclaimed it because our heartbeat
      // appeared to have stopped). Never optimistically assume ownership.
      if (error || !data || (data as unknown[]).length === 0) {
        ownershipLost = true;
      }
    } catch {
      ownershipLost = true;
    }
  };

  const heartbeatTimer: ReturnType<typeof setInterval> | null =
    typeof setInterval === "function" ? setInterval(() => { void refreshHeartbeat(); }, heartbeatIntervalMs) : null;

  const releaseLock = async (notes: Record<string, unknown>) => {
    try {
      await supabase
        .from("discovery_runs")
        .update({ run_finished_at: now().toISOString(), notes: JSON.stringify(notes) })
        .eq("id", lockId)
        // CAS: never close (or overwrite the close of) a row this run does
        // not currently see as still open — if ownership was already lost
        // and reclaimed elsewhere, this becomes a harmless no-op instead
        // of clobbering whatever the reclaiming invocation wrote.
        .is("run_finished_at", null);
    } catch {
      /* best-effort — the lease/staleness policy above is the backstop if this itself fails */
    }
  };

  // ---- Scout -> ingest, through the exact same Phase 3.1 handoff ----
  // The heartbeat timer above renews concurrently with this single awaited
  // call for as long as it runs; it is always cleared below, on every exit
  // path, before this function returns.
  let result: RunScoutAndIngestResult;
  try {
    result = await runScoutAndIngest({
      supabase,
      userId,
      dryRun,
      ingestAfterScout: params.ingestAfterScout ?? true,
      scoutInput: params.scoutInput,
      // Phase 3.2 hardening: attribute this run as scheduler-originated in
      // discovery_runs.triggered_by (threaded through runScoutAndIngestCore
      // -> runCompanyScoutCore). Every interactive caller leaves this
      // unset and still records "manual".
      triggeredBy: "scheduled",
      // Phase 3.2 Final Production Safety Corrections — ownership-fencing
      // checkpoint (see the FENCING comment above and the OWNERSHIP
      // FENCING note in company-scout-ingest.functions.ts). Checked once,
      // by runScoutAndIngestCore, immediately before ingestion would
      // start. `ownershipLost` reflects the LATEST heartbeat-refresh
      // outcome at the moment this is called, which — because Scout runs
      // to completion before this checkpoint is ever reached — can only
      // have been set by a heartbeat tick that already fired during
      // Scout's own execution.
      shouldContinue: () => !ownershipLost,
    });
  } catch (e: any) {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    const message = (e?.message || String(e)).slice(0, 300);
    await releaseLock({ phase: "failed", error: message, ownership_lost: ownershipLost });
    const scheduler = { trigger_source: triggerSource, lock_acquired: true, schedule_enabled: scheduleEnabled, scheduler_version: SCHEDULER_VERSION };
    // FENCING: if ownership was already lost before/during this failure,
    // do not report it as an ordinary partial failure under a plain
    // "completed" run — see the FENCING comment above this function.
    if (ownershipLost) {
      return finish({
        status: "lock_lost",
        scout_status: "partial_failure",
        ingest_status: "not_attempted",
        scheduler,
        errors: [
          { stage: "scout_orchestration", entity: "runScoutAndIngestCore", message },
          { stage: "lock_fencing", entity: "discovery_runs", message: "heartbeat lease could not be confirmed held for the full run" },
        ],
      });
    }
    return finish({
      status: "completed",
      scout_status: "partial_failure",
      ingest_status: "not_attempted",
      scheduler,
      errors: [{ stage: "scout_orchestration", entity: "runScoutAndIngestCore", message }],
    });
  }
  if (heartbeatTimer) clearInterval(heartbeatTimer);

  const scoutStatus: ScheduledRunTelemetry["scout_status"] = result.scout.errors.length > 0 ? "partial_failure" : "completed";

  let ingestStatus: ScheduledRunTelemetry["ingest_status"];
  switch (result.ingest_skipped_reason) {
    case "dry_run":
      ingestStatus = "skipped_dry_run";
      break;
    case "not_requested":
      ingestStatus = "skipped_not_requested";
      break;
    case "no_eligible_sources":
      ingestStatus = "skipped_no_eligible_sources";
      break;
    case "ownership_lost":
      ingestStatus = "skipped_ownership_lost";
      break;
    default:
      ingestStatus = result.ingest && result.ingest.runs.some((r: any) => r && r.success === false) ? "partial_failure" : "completed";
  }

  const errors: ScheduledRunError[] = [
    ...result.scout.errors.map((e) => ({ stage: `scout:${e.stage}`, entity: e.candidate, message: e.message })),
    ...(result.ingest?.runs ?? [])
      .filter((r: any) => r && r.success === false)
      .map((r: any) => ({ stage: "ingest", entity: r.source_url ?? r.source_id ?? "unknown_source", message: r.message ?? "ingest run reported failure" })),
  ];

  await releaseLock({
    phase: "completed",
    scout_status: scoutStatus,
    ingest_status: ingestStatus,
    companies_validated: result.scout.companies_validated,
    sources_added: result.scout.sources_added,
    ownership_lost: ownershipLost,
  });

  const telemetryBase = {
    run_id: result.scout.run_id,
    scout_status: scoutStatus,
    ingest_status: ingestStatus,
    scheduler: { trigger_source: triggerSource, lock_acquired: true, schedule_enabled: scheduleEnabled, scheduler_version: SCHEDULER_VERSION },
    scout: {
      candidates_evaluated: result.scout.companies_evaluated,
      companies_validated: result.scout.companies_validated,
      companies_rejected: result.scout.companies_rejected,
      sources_added: result.scout.sources_added,
      sources_updated: result.scout.sources_refreshed,
    },
    ingest: {
      sources_requested: result.eligible_candidates.length,
      sources_processed: result.ingest?.runs.length ?? 0,
      jobs_fetched: result.ingest?.totals.found ?? 0,
      jobs_inserted: result.ingest?.totals.imported ?? 0,
      jobs_deduped: result.ingest?.totals.duplicate ?? 0,
      hard_rejected: result.ingest?.totals.rejected ?? 0,
      manual_review: result.ingest?.totals.manual_review ?? 0,
      ready_to_apply: result.ingest ? result.ingest.totals.imported - result.ingest.totals.manual_review : 0,
    },
  };

  // FENCING: Scout/ingest already ran to completion (and may already have
  // written job_sources/job_listings — see the FENCING comment above this
  // function for why those writes cannot be retroactively undone), but
  // this run cannot confirm it held its lease the whole time it was
  // running. Never report a plain "completed" success in that case.
  if (ownershipLost) {
    return finish({
      ...telemetryBase,
      status: "lock_lost",
      errors: [...errors, { stage: "lock_fencing", entity: "discovery_runs", message: "heartbeat lease could not be confirmed held for the full run" }],
    });
  }

  return finish({ ...telemetryBase, status: "completed", errors });
}

// ============================================================================
// Machine-auth HTTP boundary. Kept as a plain, injectable function (same
// pattern as every createServerFn wrapper elsewhere in this codebase) so it
// is directly testable without needing the TanStack Start file-route/compiler
// machinery — see company-scout-schedule.functions.test.ts. The actual route
// (../routes/api/public/hooks/company-scout-schedule.ts) is a ~10-line
// wrapper that calls this with the real Request, process.env, and
// supabaseAdmin.
//
// Auth model: a dedicated shared-secret header, separate from
// requireSupabaseAuth's interactive browser-session auth (this endpoint has
// no interactive user session to authenticate — Step 4 of the Phase 3.2
// authorization). Fails CLOSED: if the operator has not configured
// COMMAND_FLOW_SCHEDULER_SECRET at all, every call is rejected — an unset
// secret is never treated as "no auth required". The secret is compared,
// never logged, and never included in any response body.
// ============================================================================

export const SCHEDULER_SECRET_HEADER = "x-commandflow-scheduler-secret";

export interface ScheduledRequestEnv {
  COMMAND_FLOW_SCHEDULER_SECRET?: string;
  COMMAND_FLOW_SCHEDULER_USER_ID?: string;
  COMMAND_FLOW_SCHEDULE_ENABLED?: string;
  COMMAND_FLOW_SCHEDULE_DRY_RUN?: string;
}

export interface HandleScheduledScoutIngestRequestParams {
  headers: { get(name: string): string | null };
  env: ScheduledRequestEnv;
  supabase: any;
  triggerSource?: string;
  // DI seam — defaults to the real scheduledScoutIngest. Tests inject a fake
  // to assert routing/auth behavior without exercising the full pipeline.
  runScheduledScoutIngest?: (params: ScheduledScoutIngestParams) => Promise<ScheduledRunTelemetry>;
}

export interface ScheduledHttpResult {
  httpStatus: 200 | 401;
  body: ScheduledRunTelemetry | { error: string };
}

export async function handleScheduledScoutIngestRequest(
  params: HandleScheduledScoutIngestRequestParams
): Promise<ScheduledHttpResult> {
  const expectedSecret = params.env.COMMAND_FLOW_SCHEDULER_SECRET;
  const providedSecret = params.headers.get(SCHEDULER_SECRET_HEADER);

  if (!expectedSecret || !providedSecret || providedSecret !== expectedSecret) {
    return { httpStatus: 401, body: { error: "unauthorized" } };
  }

  const run = params.runScheduledScoutIngest ?? scheduledScoutIngest;
  const result = await run({
    supabase: params.supabase,
    userId: params.env.COMMAND_FLOW_SCHEDULER_USER_ID,
    scheduleEnabled: params.env.COMMAND_FLOW_SCHEDULE_ENABLED === "true",
    dryRun: params.env.COMMAND_FLOW_SCHEDULE_DRY_RUN !== "false",
    triggerSource: params.triggerSource ?? "pg_cron",
  });
  return { httpStatus: 200, body: result };
}
