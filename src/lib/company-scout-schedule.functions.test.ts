// ============================================================================
// Phase 3.2 — Scheduled Scout -> Ingest orchestration tests.
//
// scheduledScoutIngest() and handleScheduledScoutIngestRequest() are both
// dependency-injectable by design (see the file header in
// company-scout-schedule.functions.ts) — every test below injects a fake
// `runScoutAndIngest` / `supabase` / `now`, so these tests need no live
// Supabase, network, HTTP request, or wall-clock dependency.
//
// Run with: bun run test (vitest)
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  scheduledScoutIngest,
  handleScheduledScoutIngestRequest,
  SCHEDULER_SECRET_HEADER,
  type ScheduledScoutIngestParams,
} from "./company-scout-schedule.functions";
import type { RunScoutAndIngestResult } from "./company-scout-ingest.functions";

const USER_ID = "11111111-1111-1111-1111-111111111111";

// ---- Minimal fake supabase covering exactly the discovery_runs shapes
// scheduledScoutIngest issues (select+eq+eq+is, insert+select+single, update+eq). ----
interface FakeLockRow {
  id: string;
  user_id: string;
  run_started_at: string;
  run_finished_at: string | null;
  triggered_by: string;
  notes: string | null;
  // Phase 3.2 heartbeat-lease hardening. Optional so every pre-existing
  // test literal (written before the heartbeat column existed) keeps
  // type-checking unchanged; a row that omits it behaves exactly like a
  // pre-migration row (heartbeat_at stays null/undefined forever).
  heartbeat_at?: string | null;
}

function createFakeScheduleSupabase(
  initialRows: FakeLockRow[] = [],
  // Phase 3.2 hardening: error injection for the lock-read (select) and
  // lock-acquire (insert) calls, so tests can prove scheduledScoutIngest
  // fails closed on either without ever invoking Scout/ingest. `code` lets
  // a test simulate a specific Postgres error code (e.g. "23505" —
  // unique_violation, the atomic-lock conflict signal) on the insert.
  //
  // RPC-related opts (Final Production Safety Corrections round): the
  // DEFAULT (every opt below omitted) represents a fully-configured,
  // production-ready environment — db_now() returns a real current
  // timestamp, and the unique-index-verification RPC reports the index
  // exists/valid/unique/correctly-defined — so every pre-existing test
  // that doesn't care about either RPC keeps working unmodified. This is
  // deliberate: db_now()/the index check are now REQUIRED preconditions
  // (see company-scout-schedule.functions.ts's FAIL-CLOSED header note),
  // so the factory's default must reflect a healthy system, not a
  // degraded one.
  //   - dbNowIso: override the returned timestamp (defaults to "now").
  //   - dbNowError: simulate the db_now() RPC call itself erroring.
  //   - dbNowMissing: simulate the RPC succeeding but returning no data
  //     (e.g. the heartbeat-lease migration not applied yet) — distinct
  //     from dbNowError, and NOT achievable by passing `dbNowIso: null`
  //     (nullish-coalescing would just fall through to the "now" default).
  //   - indexStatus: partial override of the index-status RPC's returned
  //     row (e.g. { index_valid: false } to simulate an invalid index).
  //   - indexStatusError: simulate that RPC call itself erroring.
  //   - indexStatusMissing: simulate the RPC returning an empty result set.
  opts: {
    selectError?: { message: string; code?: string };
    insertError?: { message: string; code?: string };
    dbNowIso?: string;
    dbNowError?: { message: string };
    dbNowMissing?: boolean;
    indexStatus?: Partial<{
      index_exists: boolean;
      index_valid: boolean;
      index_unique: boolean;
      index_definition_ok: boolean;
      index_def: string;
    }>;
    indexStatusError?: { message: string };
    indexStatusMissing?: boolean;
  } = {}
) {
  const rows: FakeLockRow[] = [...initialRows];
  let nextId = 1;
  const updates: Array<{ id: string; payload: any }> = [];
  const inserts: FakeLockRow[] = [];

  function table(name: string) {
    if (name !== "discovery_runs") throw new Error(`unexpected table in fake: ${name}`);

    return {
      select(_cols: string) {
        const filters: Array<(r: FakeLockRow) => boolean> = [];
        const builder = {
          eq(col: string, val: any) {
            filters.push((r: any) => r[col] === val);
            return builder;
          },
          is(col: string, val: null) {
            filters.push((r: any) => r[col] === val);
            return builder;
          },
          then(resolve: any) {
            if (opts.selectError) {
              resolve({ data: null, error: opts.selectError });
              return;
            }
            const data = rows.filter((r) => filters.every((f) => f(r)));
            resolve({ data, error: null });
          },
        };
        return builder;
      },
      insert(payload: any) {
        return {
          select(_cols: string) {
            return {
              single() {
                if (opts.insertError) {
                  return Promise.resolve({ data: null, error: opts.insertError });
                }
                const row: FakeLockRow = {
                  id: `lock-${nextId++}`,
                  user_id: payload.user_id,
                  run_started_at: payload.run_started_at,
                  run_finished_at: payload.run_finished_at ?? null,
                  triggered_by: payload.triggered_by,
                  notes: payload.notes ?? null,
                  heartbeat_at: payload.heartbeat_at ?? null,
                };
                rows.push(row);
                inserts.push({ ...row }); // snapshot — later updates mutate `rows`, not this record
                return Promise.resolve({ data: { id: row.id }, error: null });
              },
            };
          },
        };
      },
      update(payload: any) {
        // Chainable, like `select` above, so production code can do
        // `.update(p).eq("id", x).is("run_finished_at", null)` as a
        // compare-and-swap — only rows matching EVERY filter at the moment
        // `then` runs are mutated. A row that no longer matches (e.g. its
        // real owner already finished it) is left untouched, matching
        // zero rows, exactly like a real Postgrest UPDATE ... WHERE. A
        // trailing `.select(cols)` (used by the heartbeat refresh, which
        // needs to know how many rows actually matched) is a no-op here —
        // `then` already always resolves the matched rows' ids as `data`,
        // whether or not `.select()` was called in the chain.
        const filters: Array<(r: FakeLockRow) => boolean> = [];
        const builder = {
          eq(col: string, val: any) {
            filters.push((r: any) => r[col] === val);
            return builder;
          },
          is(col: string, val: null) {
            filters.push((r: any) => r[col] === val);
            return builder;
          },
          select(_cols?: string) {
            return builder;
          },
          then(resolve: any) {
            const matched = rows.filter((r) => filters.every((f) => f(r)));
            for (const row of matched) {
              updates.push({ id: row.id, payload });
              Object.assign(row, payload);
            }
            resolve({ data: matched.map((r) => ({ id: r.id })), error: null });
          },
        };
        return builder;
      },
    };
  }

  return {
    from: table,
    // Phase 3.2 heartbeat-lease hardening, extended by the Final
    // Production Safety Corrections round: db_now() (the database-time
    // anchor) and discovery_runs_scheduler_lock_index_status() (the
    // unique-index runtime verification) are now BOTH required
    // preconditions — see company-scout-schedule.functions.ts. The
    // default here (every opt omitted) is a fully healthy environment;
    // individual opts simulate specific failure modes for tests that
    // need them.
    rpc(fnName: string, _args?: any) {
      if (fnName === "db_now") {
        if (opts.dbNowError) return Promise.resolve({ data: null, error: opts.dbNowError });
        if (opts.dbNowMissing) return Promise.resolve({ data: null, error: null });
        return Promise.resolve({ data: opts.dbNowIso ?? new Date().toISOString(), error: null });
      }
      if (fnName === "discovery_runs_scheduler_lock_index_status") {
        if (opts.indexStatusError) return Promise.resolve({ data: null, error: opts.indexStatusError });
        if (opts.indexStatusMissing) return Promise.resolve({ data: [], error: null });
        const row = {
          index_exists: true,
          index_valid: true,
          index_unique: true,
          index_definition_ok: true,
          index_def: "CREATE UNIQUE INDEX discovery_runs_scheduled_open_lock_uidx ON discovery_runs USING btree (user_id) WHERE ((triggered_by = 'scheduled'::text) AND (run_finished_at IS NULL))",
          ...opts.indexStatus,
        };
        return Promise.resolve({ data: [row], error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unexpected rpc in fake: ${fnName}` } });
    },
    __rows: rows,
    __updates: updates,
    __inserts: inserts,
  };
}

function fakeScoutAndIngestResult(overrides: Partial<RunScoutAndIngestResult> = {}): RunScoutAndIngestResult {
  return {
    scout: {
      run_id: "run-1",
      dry_run: false,
      levels_run: [2],
      safety_caps: { maxCandidatesEvaluatedPerRun: 100, maxNewCompaniesValidatedPerRun: 25, maxNewJobSourcesPerRun: 10 },
      discovery_mix_used: { existingHighPerforming: 0.3, staleUnvisited: 0.25, newlyDiscovered: 0.25, similarityDerived: 0.1, randomExploration: 0.1 },
      expansion_mode: { active: false, reasons: [] },
      companies_evaluated: 5,
      companies_discovered: 3,
      companies_validated: 2,
      companies_rejected: 1,
      sources_added: 2,
      sources_refreshed: 1,
      errors: [],
      candidates: [],
      duration_ms: 50,
    },
    eligible_candidates: [],
    ingest: null,
    ingest_skipped_reason: "not_requested",
    ...overrides,
  };
}

describe("A. schedule disabled", () => {
  it("returns status=disabled and never touches supabase or runScoutAndIngest", async () => {
    const supabase = createFakeScheduleSupabase();
    const runScoutAndIngest = vi.fn(async () => fakeScoutAndIngestResult());
    const result = await scheduledScoutIngest({
      supabase, userId: USER_ID, scheduleEnabled: false, dryRun: true, runScoutAndIngest,
    });
    expect(result.status).toBe("disabled");
    expect(runScoutAndIngest).not.toHaveBeenCalled();
    expect(supabase.__inserts).toHaveLength(0);
    expect(supabase.__updates).toHaveLength(0);
  });

  it("defaults to disabled when scheduleEnabled is omitted", async () => {
    const supabase = createFakeScheduleSupabase();
    const runScoutAndIngest = vi.fn(async () => fakeScoutAndIngestResult());
    const result = await scheduledScoutIngest({ supabase, userId: USER_ID, runScoutAndIngest });
    expect(result.status).toBe("disabled");
    expect(runScoutAndIngest).not.toHaveBeenCalled();
  });
});

describe("B. schedule dry-run", () => {
  it("dry_run=true still acquires the lock and calls Scout, but Scout itself performs zero mutation (proven in company-scout-ingest.functions.test.ts) — here we assert the handoff is called with dry_run and ingest is reported skipped", async () => {
    const supabase = createFakeScheduleSupabase();
    const runScoutAndIngest = vi.fn(async () => fakeScoutAndIngestResult({ ingest: null, ingest_skipped_reason: "dry_run" }));
    const result = await scheduledScoutIngest({
      supabase, userId: USER_ID, scheduleEnabled: true, dryRun: true, runScoutAndIngest,
    });
    expect(runScoutAndIngest).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
    expect(result.mode).toBe("dry_run");
    expect(result.ingest_status).toBe("skipped_dry_run");
    expect(result.status).toBe("completed");
  });

  it("defaults to dry-run when dryRun is omitted", async () => {
    const supabase = createFakeScheduleSupabase();
    const runScoutAndIngest = vi.fn(async () => fakeScoutAndIngestResult({ ingest_skipped_reason: "dry_run" }));
    const result = await scheduledScoutIngest({ supabase, userId: USER_ID, scheduleEnabled: true, runScoutAndIngest });
    expect(result.mode).toBe("dry_run");
    expect(runScoutAndIngest).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });
});

describe("C. live scheduler", () => {
  it("dry_run=false, schedule enabled -> calls runScoutAndIngestCore (injected) with ingestAfterScout defaulting to true", async () => {
    const supabase = createFakeScheduleSupabase();
    const runScoutAndIngest = vi.fn(async () => fakeScoutAndIngestResult({
      ingest: { runs: [{ success: true }], totals: { found: 3, imported: 2, duplicate: 1, skipped: 0, rejected: 0, manual_review: 1 }, relaxed: false },
      ingest_skipped_reason: null,
    }));
    const result = await scheduledScoutIngest({
      supabase, userId: USER_ID, scheduleEnabled: true, dryRun: false, runScoutAndIngest,
    });
    expect(runScoutAndIngest).toHaveBeenCalledWith(expect.objectContaining({ dryRun: false, ingestAfterScout: true, userId: USER_ID }));
    expect(result.mode).toBe("live");
    expect(result.status).toBe("completed");
    expect(result.ingest_status).toBe("completed");
  });
});

describe("D/E. machine auth boundary (handleScheduledScoutIngestRequest)", () => {
  const headers = (value: string | null) => ({ get: (name: string) => (name === SCHEDULER_SECRET_HEADER ? value : null) });

  it("D. missing secret header is rejected with 401, and the scheduled core is never invoked", async () => {
    const runScheduledScoutIngest = vi.fn(async () => ({}) as any);
    const result = await handleScheduledScoutIngestRequest({
      headers: headers(null),
      env: { COMMAND_FLOW_SCHEDULER_SECRET: "correct-secret" },
      supabase: {},
      runScheduledScoutIngest,
    });
    expect(result.httpStatus).toBe(401);
    expect(runScheduledScoutIngest).not.toHaveBeenCalled();
  });

  it("E. wrong secret header is rejected with 401, and the scheduled core is never invoked", async () => {
    const runScheduledScoutIngest = vi.fn(async () => ({}) as any);
    const result = await handleScheduledScoutIngestRequest({
      headers: headers("wrong-secret"),
      env: { COMMAND_FLOW_SCHEDULER_SECRET: "correct-secret" },
      supabase: {},
      runScheduledScoutIngest,
    });
    expect(result.httpStatus).toBe(401);
    expect(runScheduledScoutIngest).not.toHaveBeenCalled();
  });

  it("fails closed: no secret configured at all rejects even a matching header", async () => {
    const runScheduledScoutIngest = vi.fn(async () => ({}) as any);
    const result = await handleScheduledScoutIngestRequest({
      headers: headers("anything"),
      env: {},
      supabase: {},
      runScheduledScoutIngest,
    });
    expect(result.httpStatus).toBe(401);
    expect(runScheduledScoutIngest).not.toHaveBeenCalled();
  });

  it("correct secret is accepted and forwarded to the scheduled core with env-derived params", async () => {
    const runScheduledScoutIngest = vi.fn(async () => ({ status: "disabled" }) as any);
    const result = await handleScheduledScoutIngestRequest({
      headers: headers("correct-secret"),
      env: {
        COMMAND_FLOW_SCHEDULER_SECRET: "correct-secret",
        COMMAND_FLOW_SCHEDULER_USER_ID: USER_ID,
        COMMAND_FLOW_SCHEDULE_ENABLED: "true",
        COMMAND_FLOW_SCHEDULE_DRY_RUN: "false",
      },
      supabase: {},
      runScheduledScoutIngest,
    });
    expect(result.httpStatus).toBe(200);
    expect(runScheduledScoutIngest).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, scheduleEnabled: true, dryRun: false })
    );
  });
});

describe("F. scheduler user ID missing/invalid", () => {
  it("missing userId -> fatal_configuration_error, no lock/scout/ingest calls", async () => {
    const supabase = createFakeScheduleSupabase();
    const runScoutAndIngest = vi.fn(async () => fakeScoutAndIngestResult());
    const result = await scheduledScoutIngest({
      supabase, userId: undefined, scheduleEnabled: true, dryRun: true, runScoutAndIngest,
    });
    expect(result.status).toBe("fatal_configuration_error");
    expect(result.errors[0]?.entity).toBe("COMMAND_FLOW_SCHEDULER_USER_ID");
    expect(runScoutAndIngest).not.toHaveBeenCalled();
    expect(supabase.__inserts).toHaveLength(0);
  });

  it("non-UUID userId -> fatal_configuration_error, no lock/scout/ingest calls", async () => {
    const supabase = createFakeScheduleSupabase();
    const runScoutAndIngest = vi.fn(async () => fakeScoutAndIngestResult());
    const result = await scheduledScoutIngest({
      supabase, userId: "not-a-uuid", scheduleEnabled: true, dryRun: true, runScoutAndIngest,
    });
    expect(result.status).toBe("fatal_configuration_error");
    expect(runScoutAndIngest).not.toHaveBeenCalled();
    expect(supabase.__inserts).toHaveLength(0);
  });
});

describe("G/H. lock acquisition", () => {
  it("G. no existing lock -> lock acquired, run proceeds, lock row inserted with triggered_by='scheduled'", async () => {
    const supabase = createFakeScheduleSupabase();
    const runScoutAndIngest = vi.fn(async () => fakeScoutAndIngestResult());
    const result = await scheduledScoutIngest({
      supabase, userId: USER_ID, scheduleEnabled: true, dryRun: true, runScoutAndIngest,
    });
    expect(runScoutAndIngest).toHaveBeenCalledTimes(1);
    expect(result.scheduler.lock_acquired).toBe(true);
    expect(supabase.__inserts).toHaveLength(1);
    expect(supabase.__inserts[0].triggered_by).toBe("scheduled");
    // __inserts holds a snapshot taken AT insert time (before any later
    // update mutates the live row) — proves the lock was opened correctly.
    expect(supabase.__inserts[0].run_finished_at).toBeNull();
    // The live row (post-run) is closed out — the lock was released.
    const liveRow = supabase.__rows.find((r) => r.id === supabase.__inserts[0].id)!;
    expect(liveRow.run_finished_at).not.toBeNull();
  });

  it("H. an existing fresh lock for this user -> lock_not_acquired, run #2 safely skips without calling runScoutAndIngest", async () => {
    const now = new Date("2026-08-16T12:00:00.000Z");
    const supabase = createFakeScheduleSupabase(
      [{ id: "existing-lock", user_id: USER_ID, run_started_at: new Date(now.getTime() - 5 * 60_000).toISOString(), run_finished_at: null, triggered_by: "scheduled", notes: null }],
      // Pin db_now() to this test's own fixed `now` -- otherwise the
      // factory's default (real wall-clock time) would anchor the
      // staleness cutoff to today, not to this test's 2026-08-16 scenario,
      // and could misclassify this "fresh" lock as stale by coincidence.
      { dbNowIso: now.toISOString() }
    );
    const runScoutAndIngest = vi.fn(async () => fakeScoutAndIngestResult());
    const result = await scheduledScoutIngest({
      supabase, userId: USER_ID, scheduleEnabled: true, dryRun: true, runScoutAndIngest, now: () => now,
    });
    expect(result.status).toBe("lock_not_acquired");
    expect(runScoutAndIngest).not.toHaveBeenCalled();
    expect(supabase.__inserts).toHaveLength(0); // no second lock row created
  });

  it("a fresh lock belonging to a DIFFERENT user does not block this user's run", async () => {
    const now = new Date("2026-08-16T12:00:00.000Z");
    const otherUser = "22222222-2222-2222-2222-222222222222";
    const supabase = createFakeScheduleSupabase(
      [{ id: "other-users-lock", user_id: otherUser, run_started_at: new Date(now.getTime() - 5 * 60_000).toISOString(), run_finished_at: null, triggered_by: "scheduled", notes: null }],
      { dbNowIso: now.toISOString() } // pin db_now() to this test's fixed clock -- see the "H" test's comment above
    );
    const runScoutAndIngest = vi.fn(async () => fakeScoutAndIngestResult());
    const result = await scheduledScoutIngest({
      supabase, userId: USER_ID, scheduleEnabled: true, dryRun: true, runScoutAndIngest, now: () => now,
    });
    expect(result.status).toBe("completed");
    expect(runScoutAndIngest).toHaveBeenCalledTimes(1);
  });
});

describe("I. stale lock recovery", () => {
  it("a lock older than the staleness window is closed out and this run proceeds normally", async () => {
    const now = new Date("2026-08-16T12:00:00.000Z");
    const staleStartedAt = new Date(now.getTime() - 3 * 60 * 60_000).toISOString(); // 3h ago > 120min staleness
    const supabase = createFakeScheduleSupabase(
      [{ id: "stale-lock", user_id: USER_ID, run_started_at: staleStartedAt, run_finished_at: null, triggered_by: "scheduled", notes: null }],
      { dbNowIso: now.toISOString() } // pin db_now() to this test's fixed clock -- see the "H" test's comment above
    );
    const runScoutAndIngest = vi.fn(async () => fakeScoutAndIngestResult());
    const result = await scheduledScoutIngest({
      supabase, userId: USER_ID, scheduleEnabled: true, dryRun: true, runScoutAndIngest, now: () => now,
    });
    expect(result.status).toBe("completed");
    expect(runScoutAndIngest).toHaveBeenCalledTimes(1);
    // The stale row was closed out (not left dangling), and a NEW lock row was inserted for this run.
    const staleRow = supabase.__rows.find((r) => r.id === "stale-lock")!;
    expect(staleRow.run_finished_at).not.toBeNull();
    expect(JSON.parse(staleRow.notes!).scheduler_stale_lock_recovered).toBe(true);
    expect(supabase.__inserts).toHaveLength(1);
    expect(supabase.__inserts[0].id).not.toBe("stale-lock");
  });

  it("a failure inside runScoutAndIngest still releases the lock (no permanent deadlock)", async () => {
    const supabase = createFakeScheduleSupabase();
    const runScoutAndIngest = vi.fn(async () => { throw new Error("boom"); });
    const result = await scheduledScoutIngest({
      supabase, userId: USER_ID, scheduleEnabled: true, dryRun: false, runScoutAndIngest,
    });
    expect(result.status).toBe("completed");
    expect(result.scout_status).toBe("partial_failure");
    expect(result.errors[0]?.message).toMatch(/boom/);
    const lockRow = supabase.__rows[0];
    expect(lockRow.run_finished_at).not.toBeNull(); // released, not left dangling
  });

  it("race-safe recovery: a stale-looking lock whose real owner finishes between the read and the recovery sweep is never clobbered (compare-and-swap via run_finished_at IS NULL)", async () => {
    const now = new Date("2026-08-16T12:00:00.000Z");
    const staleStartedAt = new Date(now.getTime() - 3 * 60 * 60_000).toISOString(); // 3h ago > 120min staleness
    const REAL_FINISH_AT = new Date(now.getTime() - 60_000).toISOString();
    const row: FakeLockRow = {
      id: "stale-lock", user_id: USER_ID, run_started_at: staleStartedAt,
      run_finished_at: null, triggered_by: "scheduled", notes: null,
    };
    const updateCalls: Array<{ matchedCount: number; payload: any }> = [];
    // A dedicated, minimal fake (not the shared factory) so we can simulate
    // the exact race: the row's REAL owner finishes it for real the
    // instant after scheduledScoutIngest reads it, i.e. between its
    // lock-read SELECT and its stale-recovery UPDATE.
    const supabase = {
      from(name: string) {
        if (name !== "discovery_runs") throw new Error(`unexpected table: ${name}`);
        return {
          select(_cols: string) {
            const filters: Array<(r: FakeLockRow) => boolean> = [];
            const builder = {
              eq(col: string, val: any) { filters.push((r: any) => r[col] === val); return builder; },
              is(col: string, val: null) { filters.push((r: any) => r[col] === val); return builder; },
              then(resolve: any) {
                const data = [row].filter((r) => filters.every((f) => f(r))).map((r) => ({ ...r }));
                // Simulate the real owner completing its run for real right
                // after this read is taken (the exact race window the CAS
                // update below must be safe against).
                row.run_finished_at = REAL_FINISH_AT;
                row.notes = JSON.stringify({ phase: "completed", real_owner: true });
                resolve({ data, error: null });
              },
            };
            return builder;
          },
          update(payload: any) {
            const filters: Array<(r: FakeLockRow) => boolean> = [];
            const builder = {
              eq(col: string, val: any) { filters.push((r: any) => r[col] === val); return builder; },
              is(col: string, val: null) { filters.push((r: any) => r[col] === val); return builder; },
              then(resolve: any) {
                const matched = [row].filter((r) => filters.every((f) => f(r)));
                updateCalls.push({ matchedCount: matched.length, payload });
                for (const r of matched) Object.assign(r, payload);
                resolve({ error: null });
              },
            };
            return builder;
          },
          insert(payload: any) {
            return { select() { return { single() { return Promise.resolve({ data: { id: "new-lock" }, error: null }); } }; } };
          },
        };
      },
      // Healthy-by-default RPC responses -- this test's custom fake
      // predates db_now()/the index-verification RPC being required
      // preconditions (Final Production Safety Corrections round); it is
      // not testing either gate, so both must report "everything is
      // fine" for this test's own race-recovery scenario to ever be
      // reached. db_now() is pinned to this test's own fixed `now`
      // (2026-08-16), NOT real wall-clock time -- otherwise the
      // staleness cutoff this test depends on would be computed against
      // today's real date instead of the scenario's intended clock.
      rpc(fnName: string) {
        if (fnName === "db_now") return Promise.resolve({ data: now.toISOString(), error: null });
        if (fnName === "discovery_runs_scheduler_lock_index_status") {
          return Promise.resolve({
            data: [{ index_exists: true, index_valid: true, index_unique: true, index_definition_ok: true, index_def: "uidx" }],
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: { message: `unexpected rpc in fake: ${fnName}` } });
      },
    };
    const runScoutAndIngest = vi.fn(async () => fakeScoutAndIngestResult());
    await scheduledScoutIngest({
      supabase: supabase as any, userId: USER_ID, scheduleEnabled: true, dryRun: true, runScoutAndIngest, now: () => now,
    });
    // The stale-recovery UPDATE targeted run_finished_at IS NULL — since the
    // row was already (really) finished by the time that update ran, it
    // must have matched ZERO rows, and the real completion data must be
    // untouched (not overwritten with "scheduler_stale_lock_recovered").
    expect(updateCalls[0].matchedCount).toBe(0);
    expect(row.run_finished_at).toBe(REAL_FINISH_AT);
    expect(JSON.parse(row.notes!).real_owner).toBe(true);
  });
});

describe("J. atomic lock acquisition — concurrency, constraint conflicts, and failures", () => {
  it("J1. a lock-read (select) failure fails closed: fatal_configuration_error, no lock row inserted, Scout/ingest never invoked", async () => {
    const supabase = createFakeScheduleSupabase([], { selectError: { message: "connection reset by peer" } });
    const runScoutAndIngest = vi.fn(async () => fakeScoutAndIngestResult());
    const result = await scheduledScoutIngest({
      supabase, userId: USER_ID, scheduleEnabled: true, dryRun: true, runScoutAndIngest,
    });
    expect(result.status).toBe("fatal_configuration_error");
    expect(result.errors).toEqual([
      expect.objectContaining({ stage: "lock_read", entity: "discovery_runs", message: expect.stringMatching(/connection reset/) }),
    ]);
    expect(runScoutAndIngest).not.toHaveBeenCalled();
    expect(supabase.__inserts).toHaveLength(0);
    expect(supabase.__updates).toHaveLength(0);
    expect(supabase.__rows).toHaveLength(0);
  });

  it("J2. concurrent acquisition: a lock-insert that loses the atomic race (Postgres 23505 unique_violation) is lock_not_acquired, not an error — Scout/ingest is never invoked", async () => {
    // Models exactly what discovery_runs_scheduled_open_lock_uidx produces
    // in production once applied: this process's own pre-read SELECT saw
    // no active lock (the fast path alone would have let it proceed), but
    // another invocation's INSERT for the same user has already committed
    // by the time THIS insert runs, so the database — not the earlier
    // read — rejects it with 23505. True multi-connection concurrency
    // can't be exercised by this in-process fake; this proves the code's
    // handling of the exact error Postgres raises in that race.
    const supabase = createFakeScheduleSupabase([], {
      insertError: { message: 'duplicate key value violates unique constraint "discovery_runs_scheduled_open_lock_uidx"', code: "23505" },
    });
    const runScoutAndIngest = vi.fn(async () => fakeScoutAndIngestResult());
    const result = await scheduledScoutIngest({
      supabase, userId: USER_ID, scheduleEnabled: true, dryRun: true, runScoutAndIngest,
    });
    expect(result.status).toBe("lock_not_acquired");
    expect(result.errors).toHaveLength(0); // a lost race is a normal outcome, not an error to report
    expect(runScoutAndIngest).not.toHaveBeenCalled();
    expect(supabase.__rows).toHaveLength(0); // the losing insert never actually produced a row
    expect(supabase.__inserts).toHaveLength(0);
  });

  it("J3. an unexpected database error on lock-insert (not a 23505 conflict) still fails closed as fatal_configuration_error, distinct from a lost race", async () => {
    const supabase = createFakeScheduleSupabase([], {
      insertError: { message: "connection terminated unexpectedly" }, // no `code` — not a constraint conflict
    });
    const runScoutAndIngest = vi.fn(async () => fakeScoutAndIngestResult());
    const result = await scheduledScoutIngest({
      supabase, userId: USER_ID, scheduleEnabled: true, dryRun: true, runScoutAndIngest,
    });
    expect(result.status).toBe("fatal_configuration_error");
    expect(result.errors).toEqual([
      expect.objectContaining({ stage: "lock_acquire", entity: "discovery_runs", message: expect.stringMatching(/connection terminated/) }),
    ]);
    expect(runScoutAndIngest).not.toHaveBeenCalled();
    expect(supabase.__rows).toHaveLength(0);
    expect(supabase.__inserts).toHaveLength(0);
  });

  it("J4. lock release uses the exact acquired lock id — never touches another user's lock, or any row besides the one this run itself inserted", async () => {
    const now = new Date("2026-08-16T12:00:00.000Z");
    const otherUser = "22222222-2222-2222-2222-222222222222";
    const supabase = createFakeScheduleSupabase(
      [
        // Another user's own currently-open lock — must be completely unaffected.
        { id: "other-users-lock", user_id: otherUser, run_started_at: now.toISOString(), run_finished_at: null, triggered_by: "scheduled", notes: null },
      ],
      { dbNowIso: now.toISOString() } // pin db_now() to this test's fixed clock -- see the "H" test's comment above
    );
    const runScoutAndIngest = vi.fn(async () => fakeScoutAndIngestResult());
    const result = await scheduledScoutIngest({
      supabase, userId: USER_ID, scheduleEnabled: true, dryRun: true, runScoutAndIngest, now: () => now,
    });
    expect(result.status).toBe("completed");
    // This run's own inserted lock (and only that row) was released.
    expect(supabase.__inserts).toHaveLength(1);
    const ownLock = supabase.__rows.find((r) => r.id === supabase.__inserts[0].id)!;
    expect(ownLock.run_finished_at).not.toBeNull();
    // The other user's unrelated open lock was never touched by this run's release.
    const otherLock = supabase.__rows.find((r) => r.id === "other-users-lock")!;
    expect(otherLock.run_finished_at).toBeNull();
    expect(otherLock.notes).toBeNull();
  });
});

describe("O. heartbeat-backed lease", () => {
  it("renewal: refreshes discovery_runs.heartbeat_at periodically on the owned lock row while Scout/ingest is executing", async () => {
    vi.useFakeTimers();
    try {
      const supabase = createFakeScheduleSupabase();
      let resolveRun: (() => void) | undefined;
      const runScoutAndIngest = vi.fn(
        () => new Promise<RunScoutAndIngestResult>((resolve) => { resolveRun = () => resolve(fakeScoutAndIngestResult()); })
      );
      const promise = scheduledScoutIngest({
        supabase, userId: USER_ID, scheduleEnabled: true, dryRun: true, runScoutAndIngest, heartbeatIntervalMs: 1000,
      });
      await vi.advanceTimersByTimeAsync(0); // let lock-acquire's own awaited calls settle
      await vi.advanceTimersByTimeAsync(3500); // 3+ heartbeat ticks while "Scout/ingest" is still in flight
      const lockId = supabase.__inserts[0].id;
      const heartbeatRefreshes = supabase.__updates.filter(
        (u) => u.id === lockId && "heartbeat_at" in u.payload && !("run_finished_at" in u.payload)
      );
      expect(heartbeatRefreshes.length).toBeGreaterThanOrEqual(3);
      resolveRun!();
      await vi.advanceTimersByTimeAsync(0);
      const result = await promise;
      expect(result.status).toBe("completed"); // ownership was never lost — a normal, uncontested run
    } finally {
      vi.useRealTimers();
    }
  });

  it("failure / ownership loss: a heartbeat refresh that cannot be confirmed (zero rows matched) is reported as lock_lost, not a plain completed success", async () => {
    vi.useFakeTimers();
    try {
      // A dedicated fake (not the shared factory) so the heartbeat-refresh
      // update can be made to deterministically match zero rows — exactly
      // what a real reclaim-by-another-invocation would look like — while
      // every other call (select/insert/the final release) behaves
      // normally.
      const row: FakeLockRow = {
        id: "lock-1", user_id: USER_ID, run_started_at: new Date().toISOString(),
        run_finished_at: null, triggered_by: "scheduled", notes: null, heartbeat_at: null,
      };
      const updates: Array<{ id: string | null; payload: any }> = [];
      const supabase = {
        from(name: string) {
          if (name !== "discovery_runs") throw new Error(`unexpected table: ${name}`);
          return {
            select(_cols: string) {
              const filters: Array<(r: FakeLockRow) => boolean> = [];
              const builder = {
                eq(col: string, val: any) { filters.push((r: any) => r[col] === val); return builder; },
                is(col: string, val: null) { filters.push((r: any) => r[col] === val); return builder; },
                then(resolve: any) {
                  // No pre-existing open lock here: this run must acquire
                  // ITS OWN fresh lock via the insert() below, then lose
                  // heartbeat ownership of it mid-run — that is the
                  // scenario this test exists to prove. `row` is used
                  // only to give that later-inserted lock a fixed,
                  // predictable id (and as a bookkeeping target for the
                  // update() handler below); it must NOT also appear as
                  // an already-active lock on THIS initial read, or
                  // scheduledScoutIngest's own activeLock check correctly
                  // (and incorrectly, for this test's purpose) short-
                  // circuits to lock_not_acquired before insert,
                  // runScoutAndIngest, or any heartbeat renewal ever run.
                  resolve({ data: [], error: null });
                },
              };
              return builder;
            },
            insert(payload: any) {
              return { select() { return { single() { return Promise.resolve({ data: { id: row.id }, error: null }); } }; } };
            },
            update(payload: any) {
              // Any update that touches heartbeat_at but NOT run_finished_at
              // is a heartbeat refresh — simulate it always losing the race
              // (matches zero rows), as if another invocation already
              // closed this row out from under us.
              const isHeartbeatRefresh = "heartbeat_at" in payload && !("run_finished_at" in payload);
              return {
                eq() { return this; },
                is() { return this; },
                select() {
                  updates.push({ id: row.id, payload });
                  if (!isHeartbeatRefresh) Object.assign(row, payload);
                  return Promise.resolve({ data: isHeartbeatRefresh ? [] : [{ id: row.id }], error: null });
                },
                then(resolve: any) {
                  // release/stale-recovery paths await the chain directly
                  // without a trailing .select() — mirror the same outcome.
                  updates.push({ id: row.id, payload });
                  if (!isHeartbeatRefresh) Object.assign(row, payload);
                  resolve({ data: isHeartbeatRefresh ? [] : [{ id: row.id }], error: null });
                },
              };
            },
          };
        },
        // Healthy-by-default RPC responses -- this test is specifically
        // about heartbeat-refresh ownership loss, not db_now()/the
        // index-verification RPC (both required preconditions as of the
        // Final Production Safety Corrections round) -- both must report
        // "everything is fine" for this test's own scenario (losing the
        // lease WHILE Scout/ingest executes) to ever be reached.
        rpc(fnName: string) {
          if (fnName === "db_now") return Promise.resolve({ data: new Date().toISOString(), error: null });
          if (fnName === "discovery_runs_scheduler_lock_index_status") {
            return Promise.resolve({
              data: [{ index_exists: true, index_valid: true, index_unique: true, index_definition_ok: true, index_def: "uidx" }],
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: { message: `unexpected rpc in fake: ${fnName}` } });
        },
      };
      // Construct the deferred promise (and assign resolveRun) EAGERLY,
      // synchronously, before scheduledScoutIngest is ever invoked. This
      // guarantees resolveRun is a real function from the start, regardless
      // of how many of scheduledScoutIngest's own preceding awaited calls
      // (db_now RPC, lock-read, stale-recovery, lock-insert) have resolved
      // yet — eliminating the timing dependency rather than guessing a
      // "large enough" advanceTimersByTimeAsync value.
      let resolveRun!: () => void;
      const runPromise = new Promise<RunScoutAndIngestResult>((resolve) => {
        resolveRun = () => resolve(fakeScoutAndIngestResult());
      });
      const runScoutAndIngest = vi.fn(() => runPromise);
      const promise = scheduledScoutIngest({
        supabase: supabase as any, userId: USER_ID, scheduleEnabled: true, dryRun: true, runScoutAndIngest, heartbeatIntervalMs: 1000,
      });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1500); // at least one missed/lost heartbeat tick
      resolveRun();
      await vi.advanceTimersByTimeAsync(0);
      const result = await promise;
      expect(result.status).toBe("lock_lost");
      expect(result.errors.some((e) => e.stage === "lock_fencing")).toBe(true);
      // Scout/ingest's own results are still reported (not discarded) —
      // they are just never represented as an uncontested success.
      expect(result.scout_status).toBe("completed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ownership fencing wiring: when ownership is NEVER lost, the shouldContinue callback scheduledScoutIngest passes into the Scout->ingest handoff reports true", async () => {
    vi.useFakeTimers();
    try {
      // Reuses the shared, already-proven-healthy factory and the exact
      // same timing pattern as the "renewal" test above (0ms then a
      // generous 3500ms advance) -- a pattern this file's own prior
      // debugging already established is reliable for letting
      // scheduledScoutIngest's own preceding awaited calls (index
      // verification, db_now, lock-read, lock-insert) fully settle before
      // the heartbeat timer's ticks are evaluated. Reading the captured
      // callback is deliberately NOT attempted any earlier than that.
      const supabase = createFakeScheduleSupabase();
      let resolveRun: (() => void) | undefined;
      let capturedShouldContinue: (() => boolean) | undefined;
      const runScoutAndIngest = vi.fn((callParams: any) => {
        capturedShouldContinue = callParams.shouldContinue;
        return new Promise<RunScoutAndIngestResult>((resolve) => {
          resolveRun = () => resolve(fakeScoutAndIngestResult());
        });
      });
      const promise = scheduledScoutIngest({
        supabase, userId: USER_ID, scheduleEnabled: true, dryRun: true, runScoutAndIngest, heartbeatIntervalMs: 1000,
      });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(3500); // 3+ heartbeat ticks, all successfully renewed
      expect(typeof capturedShouldContinue).toBe("function");
      expect(capturedShouldContinue!()).toBe(true); // ownership was never lost
      resolveRun!();
      await vi.advanceTimersByTimeAsync(0);
      const result = await promise;
      expect(result.status).toBe("completed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ownership fencing wiring: when ownership IS lost, the SAME shouldContinue callback scheduledScoutIngest already passed into the handoff reflects it -- a live read of the current lease state, not a value frozen at call time", async () => {
    vi.useFakeTimers();
    try {
      // Same minimal, dedicated fake as the "failure / ownership loss"
      // test above (a heartbeat-refresh update always matches zero rows,
      // simulating a reclaimed lease), using the exact same proven-safe
      // 0ms-then-1500ms timing that test's own fix established. This
      // test's purpose is narrower than that one: prove scheduledScoutIngest
      // actually WIRES shouldContinue through to whatever it calls for
      // Scout->ingest, and that the SAME captured function reference now
      // reports false -- i.e. it closes over the live ownershipLost flag
      // rather than snapshotting a value when runScoutAndIngest was first
      // called. The separate, actual in-process CONSUMPTION of this
      // callback (skip ingestion when it returns false) is unit-tested
      // directly against runScoutAndIngestCore in
      // company-scout-ingest.functions.test.ts.
      const row: FakeLockRow = {
        id: "lock-1", user_id: USER_ID, run_started_at: new Date().toISOString(),
        run_finished_at: null, triggered_by: "scheduled", notes: null, heartbeat_at: null,
      };
      const supabase = {
        from(name: string) {
          if (name !== "discovery_runs") throw new Error(`unexpected table: ${name}`);
          return {
            select(_cols: string) {
              return { eq() { return this; }, is() { return this; }, then(resolve: any) { resolve({ data: [], error: null }); } };
            },
            insert(_payload: any) {
              return { select() { return { single() { return Promise.resolve({ data: { id: row.id }, error: null }); } }; } };
            },
            update(payload: any) {
              const isHeartbeatRefresh = "heartbeat_at" in payload && !("run_finished_at" in payload);
              return {
                eq() { return this; },
                is() { return this; },
                select() { return Promise.resolve({ data: isHeartbeatRefresh ? [] : [{ id: row.id }], error: null }); },
                then(resolve: any) { resolve({ data: isHeartbeatRefresh ? [] : [{ id: row.id }], error: null }); },
              };
            },
          };
        },
        rpc(fnName: string) {
          if (fnName === "db_now") return Promise.resolve({ data: new Date().toISOString(), error: null });
          if (fnName === "discovery_runs_scheduler_lock_index_status") {
            return Promise.resolve({
              data: [{ index_exists: true, index_valid: true, index_unique: true, index_definition_ok: true, index_def: "uidx" }],
              error: null,
            });
          }
          return Promise.resolve({ data: null, error: { message: `unexpected rpc in fake: ${fnName}` } });
        },
      };
      let resolveRun!: () => void;
      const runPromise = new Promise<RunScoutAndIngestResult>((resolve) => {
        resolveRun = () => resolve(fakeScoutAndIngestResult());
      });
      let capturedShouldContinue: (() => boolean) | undefined;
      const runScoutAndIngest = vi.fn((callParams: any) => {
        capturedShouldContinue = callParams.shouldContinue;
        return runPromise;
      });
      const promise = scheduledScoutIngest({
        supabase: supabase as any, userId: USER_ID, scheduleEnabled: true, dryRun: true, runScoutAndIngest, heartbeatIntervalMs: 1000,
      });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1500); // at least one missed/lost heartbeat tick
      expect(typeof capturedShouldContinue).toBe("function");
      expect(capturedShouldContinue!()).toBe(false); // ownership was lost by this point
      resolveRun();
      await vi.advanceTimersByTimeAsync(0);
      const result = await promise;
      expect(result.status).toBe("lock_lost");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not rely solely on run_started_at: a FRESH run_started_at with a STALE heartbeat is reclaimed when the heartbeat lease is available", async () => {
    const now = new Date("2026-10-26T12:00:00.000Z");
    const supabase = createFakeScheduleSupabase(
      [{
        id: "fresh-started-stale-heartbeat", user_id: USER_ID,
        run_started_at: new Date(now.getTime() - 60_000).toISOString(), // 1 min ago — "fresh" under the old run_started_at-only policy
        run_finished_at: null, triggered_by: "scheduled", notes: null,
        heartbeat_at: new Date(now.getTime() - 10 * 60_000).toISOString(), // 10 min ago — well past the 5-minute heartbeat lease
      }],
      { dbNowIso: now.toISOString() } // heartbeat-lease decision path is available
    );
    const runScoutAndIngest = vi.fn(async () => fakeScoutAndIngestResult());
    const result = await scheduledScoutIngest({
      supabase, userId: USER_ID, scheduleEnabled: true, dryRun: true, runScoutAndIngest, now: () => now,
    });
    expect(result.status).toBe("completed"); // the "fresh" lock was correctly reclaimed as abandoned, and this run proceeded
    expect(runScoutAndIngest).toHaveBeenCalledTimes(1);
    const reclaimed = supabase.__rows.find((r) => r.id === "fresh-started-stale-heartbeat")!;
    expect(reclaimed.run_finished_at).not.toBeNull();
    expect(JSON.parse(reclaimed.notes!).basis).toBe("heartbeat_lease");
  });

  it("does not rely solely on run_started_at: a STALE run_started_at with a FRESH heartbeat is NOT reclaimed when the heartbeat lease is available", async () => {
    const now = new Date("2026-10-26T12:00:00.000Z");
    const supabase = createFakeScheduleSupabase(
      [{
        id: "stale-started-fresh-heartbeat", user_id: USER_ID,
        run_started_at: new Date(now.getTime() - 3 * 60 * 60_000).toISOString(), // 3h ago — "stale" under the old run_started_at-only policy
        run_finished_at: null, triggered_by: "scheduled", notes: null,
        heartbeat_at: new Date(now.getTime() - 30_000).toISOString(), // 30s ago — well within the 5-minute heartbeat lease: genuinely alive
      }],
      { dbNowIso: now.toISOString() }
    );
    const runScoutAndIngest = vi.fn(async () => fakeScoutAndIngestResult());
    const result = await scheduledScoutIngest({
      supabase, userId: USER_ID, scheduleEnabled: true, dryRun: true, runScoutAndIngest, now: () => now,
    });
    expect(result.status).toBe("lock_not_acquired"); // correctly recognized as still genuinely alive, NOT reclaimed just because run_started_at is old
    expect(runScoutAndIngest).not.toHaveBeenCalled();
    const untouched = supabase.__rows.find((r) => r.id === "stale-started-fresh-heartbeat")!;
    expect(untouched.run_finished_at).toBeNull(); // never closed out
  });

  it("migration prerequisites (Final Production Safety Corrections): if the db_now() RPC is MISSING (returns no data -- heartbeat-lease migration not applied), scheduledScoutIngest now fails CLOSED, not degraded-but-running", async () => {
    // dbNowMissing: true -> the fake's db_now() resolves {data: null,
    // error: null}, exactly like a real PostgREST response when the RPC
    // doesn't exist yet. Earlier rounds of this hardening effort silently
    // fell back to the coarser run_started_at-only policy here -- that
    // silent degradation was itself identified as a risk (an operator
    // could stay in that weaker mode indefinitely with zero signal) and
    // was explicitly removed. This is now a hard precondition failure.
    const supabase = createFakeScheduleSupabase([], { dbNowMissing: true });
    const runScoutAndIngest = vi.fn(async () => fakeScoutAndIngestResult());
    const result = await scheduledScoutIngest({
      supabase, userId: USER_ID, scheduleEnabled: true, dryRun: true, runScoutAndIngest,
    });
    expect(result.status).toBe("fatal_configuration_error");
    expect(result.errors.some((e) => e.stage === "db_time_anchor")).toBe(true);
    expect(runScoutAndIngest).not.toHaveBeenCalled();
    expect(supabase.__inserts).toHaveLength(0); // no lock row was ever written
  });

  it("fail-closed: a db_now() RPC call that itself ERRORS (not just missing data) also prevents scheduled execution, with the error surfaced in telemetry", async () => {
    const supabase = createFakeScheduleSupabase([], {
      dbNowError: { message: "permission denied for function db_now" },
    });
    const runScoutAndIngest = vi.fn(async () => fakeScoutAndIngestResult());
    const result = await scheduledScoutIngest({
      supabase, userId: USER_ID, scheduleEnabled: true, dryRun: true, runScoutAndIngest,
    });
    expect(result.status).toBe("fatal_configuration_error");
    expect(result.errors.some((e) => e.stage === "db_time_anchor" && e.message.includes("permission denied"))).toBe(true);
    expect(runScoutAndIngest).not.toHaveBeenCalled();
    expect(supabase.__inserts).toHaveLength(0);
  });
});

describe("P. runtime unique-index verification (Final Production Safety Corrections)", () => {
  it("a MISSING unique lock index fails closed as fatal_configuration_error, before any lock read/insert or Scout/ingest call", async () => {
    const supabase = createFakeScheduleSupabase([], { indexStatusMissing: true });
    const runScoutAndIngest = vi.fn(async () => fakeScoutAndIngestResult());
    const result = await scheduledScoutIngest({
      supabase, userId: USER_ID, scheduleEnabled: true, dryRun: true, runScoutAndIngest,
    });
    expect(result.status).toBe("fatal_configuration_error");
    expect(result.errors.some((e) => e.stage === "index_verification")).toBe(true);
    expect(runScoutAndIngest).not.toHaveBeenCalled();
    expect(supabase.__inserts).toHaveLength(0);
  });

  it("an INVALID unique lock index (e.g. left behind by an interrupted CONCURRENTLY build) fails closed the same way", async () => {
    const supabase = createFakeScheduleSupabase([], { indexStatus: { index_valid: false } });
    const runScoutAndIngest = vi.fn(async () => fakeScoutAndIngestResult());
    const result = await scheduledScoutIngest({
      supabase, userId: USER_ID, scheduleEnabled: true, dryRun: true, runScoutAndIngest,
    });
    expect(result.status).toBe("fatal_configuration_error");
    expect(result.errors.some((e) => e.stage === "index_verification")).toBe(true);
    expect(runScoutAndIngest).not.toHaveBeenCalled();
  });

  it("an index that exists and is valid but is NOT UNIQUE, or whose definition doesn't match what this application depends on, also fails closed", async () => {
    const supabaseNotUnique = createFakeScheduleSupabase([], { indexStatus: { index_unique: false } });
    const resultNotUnique = await scheduledScoutIngest({
      supabase: supabaseNotUnique, userId: USER_ID, scheduleEnabled: true, dryRun: true,
      runScoutAndIngest: vi.fn(async () => fakeScoutAndIngestResult()),
    });
    expect(resultNotUnique.status).toBe("fatal_configuration_error");

    const supabaseWrongDef = createFakeScheduleSupabase([], { indexStatus: { index_definition_ok: false } });
    const resultWrongDef = await scheduledScoutIngest({
      supabase: supabaseWrongDef, userId: USER_ID, scheduleEnabled: true, dryRun: true,
      runScoutAndIngest: vi.fn(async () => fakeScoutAndIngestResult()),
    });
    expect(resultWrongDef.status).toBe("fatal_configuration_error");
  });

  it("the index-verification RPC call itself erroring (not just reporting an unready index) also fails closed, with the error surfaced in telemetry", async () => {
    const supabase = createFakeScheduleSupabase([], {
      indexStatusError: { message: "function discovery_runs_scheduler_lock_index_status() does not exist" },
    });
    const runScoutAndIngest = vi.fn(async () => fakeScoutAndIngestResult());
    const result = await scheduledScoutIngest({
      supabase, userId: USER_ID, scheduleEnabled: true, dryRun: true, runScoutAndIngest,
    });
    expect(result.status).toBe("fatal_configuration_error");
    expect(result.errors.some((e) => e.stage === "index_verification" && e.message.includes("does not exist"))).toBe(true);
    expect(runScoutAndIngest).not.toHaveBeenCalled();
  });

  it("a VALID, unique, correctly-defined index (the default healthy fake) does NOT block the run -- lock acquisition proceeds normally", async () => {
    const supabase = createFakeScheduleSupabase();
    const runScoutAndIngest = vi.fn(async () => fakeScoutAndIngestResult());
    const result = await scheduledScoutIngest({
      supabase, userId: USER_ID, scheduleEnabled: true, dryRun: true, runScoutAndIngest,
    });
    expect(result.status).toBe("completed");
    expect(runScoutAndIngest).toHaveBeenCalledTimes(1);
    expect(supabase.__inserts).toHaveLength(1);
  });
});

describe("R. disabled scheduler still performs zero database access (Final Production Safety Corrections regression guard)", () => {
  it("scheduleEnabled: false returns status=disabled without ever calling supabase.rpc (db_now / index verification) or supabase.from", async () => {
    let rpcCalls = 0;
    let fromCalls = 0;
    const supabase = {
      rpc(_fnName: string) { rpcCalls++; return Promise.resolve({ data: null, error: { message: "should never be called" } }); },
      from(_name: string) { fromCalls++; throw new Error("should never be called"); },
    };
    const runScoutAndIngest = vi.fn(async () => fakeScoutAndIngestResult());
    const result = await scheduledScoutIngest({
      supabase: supabase as any, userId: USER_ID, scheduleEnabled: false, dryRun: true, runScoutAndIngest,
    });
    expect(result.status).toBe("disabled");
    expect(rpcCalls).toBe(0);
    expect(fromCalls).toBe(0);
    expect(runScoutAndIngest).not.toHaveBeenCalled();
  });
});

describe("K. partial Scout failure", () => {
  it("Scout errors are surfaced as scout_status=partial_failure without discarding the rest of the result", async () => {
    const supabase = createFakeScheduleSupabase();
    const runScoutAndIngest = vi.fn(async () => fakeScoutAndIngestResult({
      scout: { ...fakeScoutAndIngestResult().scout, errors: [{ candidate: "Bad Co", stage: "process_candidate", message: "boom" }] },
    }));
    const result = await scheduledScoutIngest({
      supabase, userId: USER_ID, scheduleEnabled: true, dryRun: false, runScoutAndIngest,
    });
    expect(result.scout_status).toBe("partial_failure");
    expect(result.errors.some((e) => e.stage === "scout:process_candidate" && e.entity === "Bad Co")).toBe(true);
    expect(result.scout.companies_validated).toBe(2); // rest of the scout summary is still reported
  });
});

describe("L. partial ingest failure", () => {
  it("a failed source run is surfaced as ingest_status=partial_failure without discarding successful sources' totals", async () => {
    const supabase = createFakeScheduleSupabase();
    const runScoutAndIngest = vi.fn(async () => fakeScoutAndIngestResult({
      ingest: {
        runs: [{ success: true, source_url: "https://good.example" }, { success: false, source_url: "https://bad.example", message: "fetch failed" }],
        totals: { found: 5, imported: 3, duplicate: 0, skipped: 0, rejected: 1, manual_review: 1 },
        relaxed: false,
      },
      ingest_skipped_reason: null,
    }));
    const result = await scheduledScoutIngest({
      supabase, userId: USER_ID, scheduleEnabled: true, dryRun: false, runScoutAndIngest,
    });
    expect(result.ingest_status).toBe("partial_failure");
    expect(result.errors.some((e) => e.stage === "ingest" && e.entity === "https://bad.example")).toBe(true);
    expect(result.ingest.jobs_inserted).toBe(3); // successful source's contribution still counted
  });
});

describe("M/N. telemetry", () => {
  it("M. telemetry contains every required field", async () => {
    const supabase = createFakeScheduleSupabase();
    const runScoutAndIngest = vi.fn(async () => fakeScoutAndIngestResult({
      ingest: { runs: [], totals: { found: 1, imported: 1, duplicate: 0, skipped: 0, rejected: 0, manual_review: 0 }, relaxed: false },
      ingest_skipped_reason: null,
    }));
    const result = await scheduledScoutIngest({
      supabase, userId: USER_ID, scheduleEnabled: true, dryRun: false, runScoutAndIngest, triggerSource: "pg_cron",
    });
    expect(result).toEqual(expect.objectContaining({
      run_id: expect.any(String),
      started_at: expect.any(String),
      completed_at: expect.any(String),
      duration_ms: expect.any(Number),
      mode: "live",
      scout: expect.objectContaining({
        candidates_evaluated: expect.any(Number),
        companies_validated: expect.any(Number),
        companies_rejected: expect.any(Number),
        sources_added: expect.any(Number),
        sources_updated: expect.any(Number),
      }),
      ingest: expect.objectContaining({
        sources_requested: expect.any(Number),
        sources_processed: expect.any(Number),
        jobs_fetched: expect.any(Number),
        jobs_inserted: expect.any(Number),
        jobs_deduped: expect.any(Number),
        hard_rejected: expect.any(Number),
        manual_review: expect.any(Number),
        ready_to_apply: expect.any(Number),
      }),
      scheduler: expect.objectContaining({
        trigger_source: "pg_cron",
        lock_acquired: true,
        schedule_enabled: true,
        scheduler_version: expect.any(String),
      }),
      errors: expect.any(Array),
    }));
  });

  it("N. telemetry never contains the scheduler secret, in any nested field", async () => {
    const supabase = createFakeScheduleSupabase();
    const runScoutAndIngest = vi.fn(async () => fakeScoutAndIngestResult());
    const result = await handleScheduledScoutIngestRequest({
      headers: { get: (n) => (n === SCHEDULER_SECRET_HEADER ? "super-secret-value" : null) },
      env: { COMMAND_FLOW_SCHEDULER_SECRET: "super-secret-value", COMMAND_FLOW_SCHEDULER_USER_ID: USER_ID, COMMAND_FLOW_SCHEDULE_ENABLED: "true" },
      supabase,
      runScheduledScoutIngest: (p) => scheduledScoutIngest({ ...p, runScoutAndIngest }),
    });
    expect(JSON.stringify(result.body)).not.toMatch(/super-secret-value/);
  });
});

describe("Q. scheduled path never creates applications", () => {
  const scheduleSrc = readFileSync(new URL("./company-scout-schedule.functions.ts", import.meta.url), "utf8");
  const routeSrc = readFileSync(new URL("../routes/api/public/hooks/company-scout-schedule.ts", import.meta.url), "utf8");

  // Both files' own header comments legitimately DISCUSS runSmartApply /
  // evaluateAutoReview in prose (explaining why they're deliberately never
  // called) — same false-positive class Phase 3.1 hit with "ON DELETE
  // CASCADE" in the migration's explanatory comment. Strip comment-only
  // lines before matching so these assertions check real code, not prose.
  const codeOnly = (src: string) =>
    src.split("\n").filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*")).join("\n");

  it("company-scout-schedule.functions.ts never CALLS runSmartApply, evaluateAutoReview, or any application-submission surface", () => {
    const code = codeOnly(scheduleSrc);
    expect(code).not.toMatch(/runSmartApply/);
    expect(code).not.toMatch(/evaluateAutoReview/);
    expect(code).not.toMatch(/from\s*["']\.\/smart-apply\.functions["']/);
    expect(code).not.toMatch(/from\s*["']\.\/auto-review-scoring["']/);
    expect(code).not.toMatch(/from\s*["']\.\/packet\.functions["']/);
    expect(code).not.toMatch(/\.from\(\s*["']applications["']\s*\)/);
    expect(code).not.toMatch(/puppeteer|playwright/i);
  });

  it("the scheduled HTTP route never imports runSmartApply or application-submission surfaces", () => {
    const code = codeOnly(routeSrc);
    expect(code).not.toMatch(/runSmartApply/);
    expect(code).not.toMatch(/evaluateAutoReview/);
    expect(code).not.toMatch(/smart-apply\.functions|auto-review-scoring|packet\.functions/);
  });

  it("scheduledScoutIngest only imports from the Phase 3.1 Scout->ingest handoff — no other write-capable surface", () => {
    const imported = [...codeOnly(scheduleSrc).matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)]
      .map((m) => ({ names: m[1], from: m[2] }));
    const localImports = imported.filter((i) => i.from.startsWith("."));
    for (const imp of localImports) {
      expect(imp.from).toBe("./company-scout-ingest.functions");
    }
  });
});
