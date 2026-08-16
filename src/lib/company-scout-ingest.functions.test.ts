// ============================================================================
// Phase 3.1 — Scout → Ingest handoff tests.
//
// runScoutAndIngestCore() is dependency-injectable by design (see the file
// header in company-scout-ingest.functions.ts) — every test below injects a
// fake `runScout`/`runIngest` rather than exercising the real
// createServerFn-wrapped runCompanyScout/importJobsNow, so these tests need
// no live Supabase, network, or HTTP request context.
//
// Run with: bun run test (vitest)
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runScoutAndIngestCore, type RunScoutAndIngestParams } from "./company-scout-ingest.functions";
import type { ScoutRunResult, CandidateOutcome } from "./company-discovery.functions";
import type { RunImportJobsPipelineResult } from "./ingest.functions";

function fakeCandidate(overrides: Partial<CandidateOutcome> = {}): CandidateOutcome {
  return {
    name: "Acme Inc",
    domain: "acme.com",
    careers_url: "https://boards.greenhouse.io/acme",
    ats_provider: "Greenhouse",
    discovery_level: 2,
    stage_reached: "job_source_upsert",
    outcome: "created",
    discovery_status: "APPROVED",
    opportunity_score: 90,
    remote_eligibility_class: "us_confirmed",
    matched_existing_company_id: "company-1",
    matched_by: null,
    job_source_action: "added",
    job_source_company_id: "company-1",
    job_source_id: "job-source-1",
    reject_reason: null,
    error: null,
    ...overrides,
  };
}

function fakeScoutResult(candidates: CandidateOutcome[], dryRun: boolean): ScoutRunResult {
  return {
    run_id: "run-1",
    dry_run: dryRun,
    levels_run: [2],
    safety_caps: { maxCandidatesEvaluatedPerRun: 100, maxNewCompaniesValidatedPerRun: 25, maxNewJobSourcesPerRun: 10 },
    discovery_mix_used: {
      existingHighPerforming: 0.3, staleUnvisited: 0.25, newlyDiscovered: 0.25, similarityDerived: 0.1, randomExploration: 0.1,
    },
    expansion_mode: { active: false, reasons: [] },
    companies_evaluated: candidates.length,
    companies_discovered: candidates.length,
    companies_validated: candidates.filter((c) => c.discovery_status === "APPROVED" || c.discovery_status === "HIGH_PRIORITY").length,
    companies_rejected: 0,
    sources_added: candidates.filter((c) => c.job_source_action === "added").length,
    sources_refreshed: 0,
    errors: [],
    candidates,
    duration_ms: 100,
  };
}

const NEVER_INGEST: RunScoutAndIngestParams["runIngest"] = vi.fn(async () => {
  throw new Error("runIngest must never be called in this test");
});

describe("A. migration contract — job_sources.company_id", () => {
  const migrationSrc = readFileSync(
    new URL("../../supabase/migrations/20260816140000_96c86220-e893-4bda-a072-9ecc1cb669bd.sql", import.meta.url),
    "utf8"
  );

  it("adds company_id as nullable (no NOT NULL constraint)", () => {
    expect(migrationSrc).toMatch(/add column if not exists company_id uuid references public\.companies\(id\)/);
    expect(migrationSrc).not.toMatch(/company_id uuid not null/i);
  });

  it("references companies(id)", () => {
    expect(migrationSrc).toMatch(/references public\.companies\(id\)/);
  });

  it("uses ON DELETE SET NULL, not CASCADE, on the actual DDL statement", () => {
    // The explanatory comment above the DDL legitimately discusses CASCADE
    // in prose (explaining why it was rejected) — so this checks the real
    // ADD COLUMN statement specifically, not the whole file.
    const ddlMatch = migrationSrc.match(/add column if not exists company_id[^;]*;/i);
    expect(ddlMatch).not.toBeNull();
    expect(ddlMatch![0]).toMatch(/on delete set null/i);
    expect(ddlMatch![0]).not.toMatch(/on delete cascade/i);
  });

  it("creates an index on job_sources(company_id)", () => {
    expect(migrationSrc).toMatch(/create index if not exists idx_job_sources_company_id\s+on public\.job_sources \(company_id\)/);
  });

  it("does not blindly backfill company_id by name", () => {
    expect(migrationSrc.toLowerCase()).not.toMatch(/update public\.job_sources/);
  });

  it("has a companion rollback script that only drops what this migration added", () => {
    const rollback = readFileSync(
      new URL("../../supabase/rollback_scripts/ROLLBACK_20260816140000_job_sources_company_id.sql", import.meta.url),
      "utf8"
    );
    expect(rollback).toMatch(/drop column if exists company_id/);
    expect(rollback).toMatch(/drop index if exists public\.idx_job_sources_company_id/);
  });
});

describe("I. Scout → ingest handoff", () => {
  it("defaults (no params) are dry-run and no-ingest — a bare call never mutates and never ingests", async () => {
    const candidates = [fakeCandidate()];
    const runScout = vi.fn(async () => fakeScoutResult(candidates, true));
    const result = await runScoutAndIngestCore({
      supabase: {}, userId: "user-1", runScout, runIngest: NEVER_INGEST,
    });
    expect(result.ingest).toBeNull();
    expect(result.ingest_skipped_reason).toBe("dry_run");
    expect(runScout).toHaveBeenCalledWith(expect.objectContaining({ dry_run: true }));
  });

  it("dry_run=true never calls the ingestion core, even if ingest_after_scout is also true", async () => {
    const candidates = [fakeCandidate({ job_source_action: "would_add", job_source_id: null })];
    const runScout = vi.fn(async () => fakeScoutResult(candidates, true));
    const result = await runScoutAndIngestCore({
      supabase: {}, userId: "user-1", dryRun: true, ingestAfterScout: true,
      runScout, runIngest: NEVER_INGEST,
    });
    expect(result.ingest).toBeNull();
    expect(result.ingest_skipped_reason).toBe("dry_run");
    expect(result.eligible_candidates).toHaveLength(1);
    expect(result.eligible_candidates[0].job_source_id).toBeNull(); // no real id exists yet in dry-run
  });

  it("ingest_after_scout=false (live run) collects eligible sources but never ingests them", async () => {
    const candidates = [fakeCandidate({ job_source_action: "added", job_source_id: "job-source-1" })];
    const runScout = vi.fn(async () => fakeScoutResult(candidates, false));
    const result = await runScoutAndIngestCore({
      supabase: {}, userId: "user-1", dryRun: false, ingestAfterScout: false,
      runScout, runIngest: NEVER_INGEST,
    });
    expect(result.ingest).toBeNull();
    expect(result.ingest_skipped_reason).toBe("not_requested");
    expect(result.eligible_candidates).toHaveLength(1);
    expect(result.eligible_candidates[0].job_source_id).toBe("job-source-1");
  });

  it("dry_run=false AND ingest_after_scout=true calls the SAME injected ingestion core, scoped to exactly the eligible source ids", async () => {
    const candidates = [
      fakeCandidate({ name: "Acme", job_source_action: "added", job_source_id: "src-acme", ats_provider: "Greenhouse" }),
      fakeCandidate({ name: "Weak Co", job_source_action: "skipped", job_source_id: null, ats_provider: null }), // not eligible
    ];
    const runScout = vi.fn(async () => fakeScoutResult(candidates, false));
    const runIngest = vi.fn(async () => ({
      runs: [], totals: { found: 1, imported: 1, duplicate: 0, skipped: 0, rejected: 0, manual_review: 0 }, relaxed: false,
    } as RunImportJobsPipelineResult));
    const result = await runScoutAndIngestCore({
      supabase: { marker: "real-supabase" }, userId: "user-1", dryRun: false, ingestAfterScout: true,
      runScout, runIngest,
    });
    expect(runIngest).toHaveBeenCalledTimes(1);
    expect(runIngest).toHaveBeenCalledWith({ supabase: { marker: "real-supabase" }, userId: "user-1", sourceIds: ["src-acme"] });
    expect(result.ingest?.totals.imported).toBe(1);
    expect(result.ingest_skipped_reason).toBeNull();
  });

  it("a candidate resolved to an unsupported/no ATS is never included in the eligible set, even if job_source_action looks otherwise eligible", async () => {
    const candidates = [fakeCandidate({ job_source_action: "added", job_source_id: "src-1", ats_provider: null })];
    const runScout = vi.fn(async () => fakeScoutResult(candidates, false));
    const result = await runScoutAndIngestCore({
      supabase: {}, userId: "user-1", dryRun: false, ingestAfterScout: true,
      runScout, runIngest: NEVER_INGEST,
    });
    expect(result.eligible_candidates).toHaveLength(0);
    expect(result.ingest_skipped_reason).toBe("no_eligible_sources");
  });

  it("a candidate that was only skipped/rejected by Scout (never became a job source) is never included in the eligible set", async () => {
    const candidates = [fakeCandidate({ job_source_action: "skipped", job_source_id: null, outcome: "rejected" })];
    const runScout = vi.fn(async () => fakeScoutResult(candidates, false));
    const result = await runScoutAndIngestCore({
      supabase: {}, userId: "user-1", dryRun: false, ingestAfterScout: true,
      runScout, runIngest: NEVER_INGEST,
    });
    expect(result.eligible_candidates).toHaveLength(0);
  });

  it("no result field from this handoff, at any settings, ever contains an application id or writes to applications — the handoff's own return shape has no such field", async () => {
    const candidates = [fakeCandidate()];
    const runScout = vi.fn(async () => fakeScoutResult(candidates, false));
    const runIngest = vi.fn(async () => ({
      runs: [], totals: { found: 0, imported: 0, duplicate: 0, skipped: 0, rejected: 0, manual_review: 0 }, relaxed: false,
    } as RunImportJobsPipelineResult));
    const result = await runScoutAndIngestCore({
      supabase: {}, userId: "user-1", dryRun: false, ingestAfterScout: true, runScout, runIngest,
    });
    expect(Object.keys(result)).toEqual(["scout", "eligible_candidates", "ingest", "ingest_skipped_reason"]);
    expect(JSON.stringify(result)).not.toMatch(/application_id|applications/i);
  });

  it("this file never imports from the Auto Apply / application-submission surface", () => {
    const src = readFileSync(new URL("./company-scout-ingest.functions.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/from\s*["']\.\/auto-review-scoring["']/);
    expect(src).not.toMatch(/from\s*["']\.\/smart-apply\.functions["']/);
    expect(src).not.toMatch(/\.from\(\s*["']applications["']\s*\)/);
  });
});

describe("J. Authentication boundary — no externally reachable path bypasses requireSupabaseAuth", () => {
  // Phase 3.1 final stabilization: runScoutAndIngestCore's default runScout
  // now calls runCompanyScoutCore directly (a plain function taking explicit
  // supabase/userId) instead of the createServerFn-wrapped runCompanyScout.
  // These tests prove that extraction didn't create a bypass: every
  // externally-reachable createServerFn still carries the auth middleware,
  // and neither plain core imports or invokes it itself (they only accept
  // already-authenticated context as explicit params).
  const handoffSrc = readFileSync(new URL("./company-scout-ingest.functions.ts", import.meta.url), "utf8");
  const scoutSrc = readFileSync(new URL("./company-discovery.functions.ts", import.meta.url), "utf8");

  it("runCompanyScoutAndIngest (the externally callable Scout→ingest entrypoint) is wrapped with requireSupabaseAuth", () => {
    const start = handoffSrc.indexOf("export const runCompanyScoutAndIngest");
    expect(start).toBeGreaterThan(-1);
    const block = handoffSrc.slice(start, start + 300);
    expect(block).toMatch(/createServerFn\(/);
    expect(block).toMatch(/\.middleware\(\[requireSupabaseAuth\]\)/);
  });

  it("runCompanyScout (the externally callable Company Scout entrypoint) is wrapped with requireSupabaseAuth", () => {
    const start = scoutSrc.indexOf("export const runCompanyScout = createServerFn");
    expect(start).toBeGreaterThan(-1);
    const block = scoutSrc.slice(start, start + 300);
    expect(block).toMatch(/\.middleware\(\[requireSupabaseAuth\]\)/);
  });

  it("runScoutAndIngestCore is a plain function — not createServerFn-wrapped, and does not import requireSupabaseAuth itself", () => {
    expect(handoffSrc).toMatch(/export async function runScoutAndIngestCore/);
    const start = handoffSrc.indexOf("export async function runScoutAndIngestCore");
    const end = handoffSrc.indexOf("\n// Thin auth/context wrapper", start);
    expect(end).toBeGreaterThan(start);
    const body = handoffSrc.slice(start, end);
    expect(body).not.toMatch(/createServerFn\(/);
    expect(body).not.toMatch(/requireSupabaseAuth/);
    // It takes supabase/userId as explicit params rather than resolving them itself.
    expect(handoffSrc).toMatch(/export interface RunScoutAndIngestParams\s*\{\s*\n\s*supabase: any;\s*\n\s*userId: string;/);
  });

  it("runCompanyScoutCore is a plain function — not createServerFn-wrapped, and does not import requireSupabaseAuth itself", () => {
    const start = scoutSrc.indexOf("export async function runCompanyScoutCore");
    expect(start).toBeGreaterThan(-1);
    const end = scoutSrc.indexOf("\n// Thin auth/context wrapper", start);
    expect(end).toBeGreaterThan(start);
    const body = scoutSrc.slice(start, end);
    expect(body).not.toMatch(/createServerFn\(/);
    expect(body).not.toMatch(/requireSupabaseAuth/);
    expect(scoutSrc).toMatch(/export interface RunCompanyScoutCoreParams\s*\{\s*\n\s*supabase: any;\s*\n\s*userId: string;/);
  });

  it("the handoff's default runScout calls runCompanyScoutCore directly, never the createServerFn-wrapped runCompanyScout", () => {
    expect(handoffSrc).toMatch(/import\s*\{\s*runCompanyScoutCore\b/);
    // No *code* call to the createServerFn wrapper — only its name may appear
    // in prose comments explaining why it's deliberately not called that way.
    const codeOnly = handoffSrc
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(codeOnly).not.toMatch(/\brunCompanyScout\(\s*\{/);
    expect(handoffSrc).toMatch(/runCompanyScoutCore\(\{\s*supabase:\s*params\.supabase,\s*userId:\s*params\.userId/);
  });
});
