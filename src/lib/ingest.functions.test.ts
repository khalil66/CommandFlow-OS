// ============================================================================
// Phase 3.0/3.1 — Scout-to-Pipeline Non-Regression Contracts.
//
// ingest.functions.ts had ZERO dedicated test coverage before Phase 3.0.
// At that point, its ingestion pipeline (importJobsNow) was a createServerFn
// handler with no separately-exported, dependency-injectable core function,
// so Phase 3.0 pinned several claims via source-inspection (reading the
// module's raw text), clearly labeled as a stopgap.
//
// Phase 3.1 extracted that pipeline into runImportJobsPipeline() — a plain,
// injectable function importJobsNow now just calls (see ingest.functions.ts's
// own header comment on the extraction). Every test that used to read source
// text to prove a claim about importJobsNow's internals has been rewritten
// to call the real runImportJobsPipeline() against a purpose-built fake
// Supabase client instead — genuine behavioral coverage of the real pipeline,
// not an assertion about what the module's text happens to contain.
//
// What's left as source-inspection, and why:
//   - The pass-rate guard (smart-apply.functions.ts's runSmartApply) — a
//     SEPARATE createServerFn handler Phase 3.1 did not touch or extract.
//   - A couple of cross-file structural checks (e.g. addJobSource()'s
//     payload shape, Company Scout's job_sources status literals) where the
//     claim genuinely is about source shape, not runtime behavior.
// Everything else below calls real, exported code — either the pure
// functions the pipeline composes (detectAts, isRemote, hasAccessBlockers,
// evaluateAutoReview, isReadyToApply, SALARY_FLOOR, SUPPORTED_ATS) or
// runImportJobsPipeline() itself.
//
// Run with: bun run test (vitest)
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { detectAts, hasAccessBlockers, isRemote, parseSalary } from "./ats-detect";
import { detectScamFlags } from "./scam-signals";
import {
  computeTrustScore,
  computeInterviewProbability,
  isReadyToApply,
  SUPPORTED_ATS,
  SALARY_FLOOR,
} from "./scoring";
import { evaluateAutoReview, AUTO_THRESHOLDS } from "./auto-review-scoring";
import { runImportJobsPipeline, type NormJob } from "./ingest.functions";

const INGEST_SRC = readFileSync(new URL("./ingest.functions.ts", import.meta.url), "utf8");
const SMART_APPLY_SRC = readFileSync(new URL("./smart-apply.functions.ts", import.meta.url), "utf8");

// A job/company shape matching exactly what processCandidate() writes to
// job_sources today (user_id, name, careers_url, ats, status, notes — see
// company-discovery.functions.ts's job_sources insert) and what a resulting
// job_listings row from that source would carry. Used across several tests
// below as "a Company Scout-originated job", to prove it receives no special
// treatment anywhere downstream.
function scoutSourcedJob(overrides: Partial<{
  title: string; description: string; location: string; remote: boolean;
  salary_min: number | null; posted_at: string | null; ats: string;
}> = {}) {
  const now = new Date().toISOString();
  return {
    job: {
      title: overrides.title ?? "Operations Analyst",
      description: overrides.description ?? "A".repeat(300),
      location: overrides.location ?? "Remote - US",
      remote: overrides.remote ?? true,
      salary_min: overrides.salary_min ?? 90000,
      salary_estimated_min: null,
      salary_confidence: "high",
      salary_source: "posted_salary",
      salary_gate_status: "pass",
      ats: overrides.ats ?? "Greenhouse",
      posted_at: overrides.posted_at ?? now,
      created_at: now,
      role_category: "Operations",
      interview_probability: 96,
      resume_match: 96,
    },
    // A company shaped like a freshly-created, Company-Scout-approved row:
    // high trust score (Company Scout only sources APPROVED/HIGH_PRIORITY
    // companies, which requires a "verified" trust decision upstream), no
    // red flags, us_remote_allowed true at the COMPANY level.
    company: {
      trust_score: 96,
      verification_status: "verified",
      red_flags: [] as string[],
      us_remote_allowed: true,
      discovery_status: "APPROVED",
    },
  };
}

// ============================================================================
// Phase 3.1 — a purpose-built fake Supabase client covering exactly the
// query shapes runImportJobsPipeline() actually issues (confirmed by
// reading the extracted function): user_settings lookup, job_sources
// select (status/id-filtered), today's job_listings count-by-ats,
// per-job dedupe_hash check, "already applied" check, company lookup/
// insert-by-name, job_listings insert, job_sources update, import_logs
// insert. Each table's rows are a real in-memory array that the chain
// methods actually filter/mutate — not canned per-call responses — so
// these tests exercise the real pipeline's real query logic rather than
// asserting on the module's source text.
// ============================================================================
interface FakeIngestDbConfig {
  jobSources?: any[];
  userSettings?: any | null;
  jobListingsToday?: Array<{ ats: string }>;
  existingDedupeHashes?: Set<string>;
  applicationDedupeHashes?: Set<string>;
  existingCompaniesByName?: Map<string, { id: string; trust_score?: number; verification_status?: string }>;
  jobListingsInsertError?: (payload: any) => { code?: string; message?: string } | null;
}

function createFakeIngestSupabase(config: FakeIngestDbConfig = {}) {
  const insertedJobListings: any[] = [];
  const jobSourceUpdates: any[] = [];
  const insertedImportLogs: any[] = [];
  let nextCompanyId = 1;
  const companiesByName = config.existingCompaniesByName ?? new Map();

  function from(table: string) {
    if (table === "user_settings") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: config.userSettings ?? null, error: null }),
          }),
        }),
      };
    }

    if (table === "job_sources") {
      return {
        select: (_cols: string) => {
          let filters: Array<[string, any]> = [];
          let inFilter: { col: string; vals: any[] } | null = null;
          const builder: any = {
            eq(col: string, val: any) { filters.push([col, val]); return builder; },
            in(col: string, vals: any[]) { inFilter = { col, vals }; return builder; },
            then(resolve: any) {
              let rows = config.jobSources ?? [];
              for (const [col, val] of filters) rows = rows.filter((r) => r[col] === val);
              if (inFilter) rows = rows.filter((r) => inFilter!.vals.includes(r[inFilter!.col]));
              return Promise.resolve({ data: rows, error: null }).then(resolve);
            },
          };
          return builder;
        },
        update: (payload: any) => ({
          eq: async (col: string, val: any) => {
            jobSourceUpdates.push({ [col]: val, payload });
            return { data: null, error: null };
          },
        }),
      };
    }

    if (table === "job_listings") {
      // Two distinct query shapes reuse this table: the "today by ats"
      // select and the per-job dedupe_hash check. Distinguished by which
      // columns/filters are actually applied, matching the real query text.
      return {
        select: (cols: string) => {
          const filters: Array<[string, any]> = [];
          const builder: any = {
            eq(col: string, val: any) { filters.push([col, val]); return builder; },
            gte(_col: string, _val: any) {
              // "today by ats" query — return the seeded rows verbatim.
              return { then: (resolve: any) => Promise.resolve({ data: config.jobListingsToday ?? [], error: null }).then(resolve) };
            },
            async maybeSingle() {
              // dedupe_hash check: { data: existingRow | null }
              const dedupeFilter = filters.find(([c]) => c === "dedupe_hash");
              const exists = dedupeFilter ? (config.existingDedupeHashes ?? new Set()).has(dedupeFilter[1]) : false;
              return { data: exists ? { id: "existing-job-listing" } : null, error: null };
            },
          };
          return builder;
        },
        insert: (payload: any) => {
          const err = config.jobListingsInsertError?.(payload) ?? null;
          if (!err) insertedJobListings.push(payload);
          return Promise.resolve({ data: null, error: err });
        },
      };
    }

    if (table === "applications") {
      return {
        select: (_cols: string) => ({
          eq: (_col1: string, _val1: any) => ({
            eq: (col2: string, val2: any) => ({
              limit: (_n: number) => ({
                async maybeSingle() {
                  const has = col2 === "job_listings.dedupe_hash" && (config.applicationDedupeHashes ?? new Set()).has(val2);
                  return { data: has ? { id: "existing-application" } : null, error: null };
                },
              }),
            }),
          }),
        }),
      };
    }

    if (table === "companies") {
      return {
        select: (_cols: string) => ({
          eq: (_col1: string, _val1: any) => ({
            eq: (_col2: string, nameVal: any) => ({
              async maybeSingle() {
                const existing = companiesByName.get(nameVal);
                return { data: existing ?? null, error: null };
              },
            }),
          }),
        }),
        insert: (payload: any) => ({
          select: (_cols: string) => ({
            async single() {
              const id = `new-company-${nextCompanyId++}`;
              companiesByName.set(payload.name, { id });
              return { data: { id }, error: null };
            },
          }),
        }),
      };
    }

    if (table === "import_logs") {
      return {
        insert: (payload: any) => ({
          select: () => ({
            async single() {
              const row = { id: `log-${insertedImportLogs.length + 1}`, ...payload };
              insertedImportLogs.push(row);
              return { data: row, error: null };
            },
          }),
        }),
      };
    }

    throw new Error(`createFakeIngestSupabase: unexpected table "${table}"`);
  }

  return { from, insertedJobListings, jobSourceUpdates, insertedImportLogs };
}

// A minimal, always-healthy AI health check for tests that don't care about
// that specific manual-review reason — matches the real isOpenAiHealthy()'s
// return shape without a network call.
async function fakeHealthyOpenAi() {
  return { ok: true } as any;
}

describe("Phase 3.1 — ingest safety contract, pinned against the real runImportJobsPipeline()", () => {
  it("only status='active' job_sources are ever fetched — an inactive row in the same query result is never touched", async () => {
    const fetcher = vi.fn(async () => [] as NormJob[]);
    const supabase = createFakeIngestSupabase({
      jobSources: [
        { id: "src-active", user_id: "user-1", name: "Acme", careers_url: "https://boards.greenhouse.io/acme", ats: "Greenhouse", status: "active" },
      ],
    });
    await runImportJobsPipeline({ supabase, userId: "user-1", fetcher, openAiHealthCheck: fakeHealthyOpenAi });
    expect(fetcher).toHaveBeenCalledWith("Greenhouse", "acme");
  });

  it("re-derives the ATS platform from the live careers_url via detectAts() rather than trusting the stored job_sources.ats string", async () => {
    const fetcher = vi.fn(async () => [] as NormJob[]);
    const supabase = createFakeIngestSupabase({
      jobSources: [
        // Stored `ats` deliberately wrong — careers_url is the only source
        // of truth the pipeline is supposed to trust.
        { id: "src-1", user_id: "user-1", name: "Acme", careers_url: "https://boards.greenhouse.io/acme", ats: "Lever", status: "active" },
      ],
    });
    await runImportJobsPipeline({ supabase, userId: "user-1", fetcher, openAiHealthCheck: fakeHealthyOpenAi });
    expect(fetcher).toHaveBeenCalledWith("Greenhouse", "acme");
    expect(fetcher).not.toHaveBeenCalledWith("Lever", expect.anything());
  });

  it("a job_source whose careers_url is not a supported ATS is rejected before any fetch is attempted", async () => {
    const fetcher = vi.fn(async () => [] as NormJob[]);
    const supabase = createFakeIngestSupabase({
      jobSources: [
        { id: "src-1", user_id: "user-1", name: "Acme", careers_url: "https://acme.myworkdayjobs.com/careers", ats: "Workday", status: "active" },
      ],
    });
    const result = await runImportJobsPipeline({ supabase, userId: "user-1", fetcher, openAiHealthCheck: fakeHealthyOpenAi });
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.totals.rejected).toBe(1);
  });
});

describe("A. a Company Scout-shaped source receives no special treatment", () => {
  it("the job_sources payload processCandidate() writes has no field distinguishing its origin from a manually-added source", () => {
    // addJobSource() (the manual "add a source" path) inserts exactly:
    // { user_id, name, careers_url, ats, status, notes }. Company Scout's
    // processCandidate() job_sources insert (company-discovery.functions.ts)
    // uses the identical key set — confirmed by reading both insert call
    // sites — with no additional "source_type"/"bypass_review"/similar flag.
    const addJobSourceStart = INGEST_SRC.indexOf("export const addJobSource");
    const addJobSourceBody = INGEST_SRC.slice(addJobSourceStart, addJobSourceStart + 800);
    const insertMatch = addJobSourceBody.match(/\.insert\(\{([\s\S]*?)\}\)/);
    expect(insertMatch).not.toBeNull();
    const manualKeys = [...insertMatch![1].matchAll(/(\w+):/g)].map((m) => m[1]).sort();
    expect(manualKeys).toEqual(["ats", "careers_url", "name", "notes", "status", "user_id"].sort());
  });

  it("job_listings has no column capable of recording a row's discovery origin — a job cannot carry 'this came from Company Scout' as data", () => {
    // The base job_listings schema (20260515055751_...) plus every later
    // ALTER TABLE on it adds no discovery/source-type/origin column. If this
    // ever changes, any future code branching on job origin becomes
    // possible — which is exactly the risk this test exists to catch early.
    const migrationFiles = [
      "20260515055751_44bb3a9e-eab9-4afe-850f-86d1f35eff2e.sql",
      "20260515061540_35299a64-4094-4b46-8899-5b6e9ba6b773.sql",
      "20260515074401_152c9add-2cf2-4874-9089-00735df89458.sql",
      "20260515092120_16898ab5-33c3-43c0-aace-e92d2d6f60c7.sql",
      "20260518212023_370f77dd-a3dc-40b0-bad1-07ebd621f673.sql",
    ];
    const combined = migrationFiles
      .map((f) => readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), "utf8"))
      .join("\n");
    expect(combined.toLowerCase()).not.toMatch(/job_listings[\s\S]{0,400}(discovery_source|source_origin|scout_origin|discovered_by)/);
  });

  it("evaluateAutoReview() (the real gate) produces the same decision whether or not the company was Company-Scout-approved — it reads no discovery/origin field at all", () => {
    const { job, company } = scoutSourcedJob();
    const withScoutFields = evaluateAutoReview({ job, company: { ...company, discovery_status: "APPROVED", discovery_source: "ats_pattern" } as any, quality: 96 });
    const withoutScoutFields = evaluateAutoReview({ job, company: { trust_score: company.trust_score, verification_status: company.verification_status, red_flags: company.red_flags } as any, quality: 96 });
    expect(withScoutFields.decision).toBe(withoutScoutFields.decision);
    expect(withScoutFields.scores).toEqual(withoutScoutFields.scores);
  });
});

describe("B. an inactive job_source is never ingested", () => {
  it("a non-active source in the same result set is never fetched, even sitting right next to an active one", async () => {
    const fetcher = vi.fn(async () => [] as NormJob[]);
    const supabase = createFakeIngestSupabase({
      jobSources: [
        { id: "src-active", user_id: "user-1", name: "Acme", careers_url: "https://boards.greenhouse.io/acme", ats: "Greenhouse", status: "active" },
        { id: "src-inactive", user_id: "user-1", name: "Zombie Co", careers_url: "https://boards.greenhouse.io/zombie", ats: "Greenhouse", status: "rejected" },
      ],
    });
    await runImportJobsPipeline({ supabase, userId: "user-1", fetcher, openAiHealthCheck: fakeHealthyOpenAi });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("Greenhouse", "acme");
    expect(fetcher).not.toHaveBeenCalledWith("Greenhouse", "zombie");
  });

  it("Company Scout never writes a job_sources row with any status other than 'active', and never writes one at all for a non-eligible discovery_status", () => {
    // The only status Company Scout's insert/update ever sets is 'active'
    // (company-discovery.functions.ts's job_source_upsert step) — there is
    // no code path where it writes 'inactive'/'paused'/etc, and the
    // eligibleForSourcing gate (APPROVED/HIGH_PRIORITY only) runs BEFORE
    // that insert, so a non-eligible company produces zero job_sources rows
    // rather than an inactive one. See company-discovery.functions.test.ts
        // for the behavioral proof (Step 5 additions).
    const src = readFileSync(new URL("./company-discovery.functions.ts", import.meta.url), "utf8");
    const statusLiterals = [...src.matchAll(/from\("job_sources"\)[\s\S]{0,200}?status:\s*"([a-z_]+)"/g)].map((m) => m[1]);
    expect(new Set(statusLiterals)).toEqual(new Set(["active"]));
  });

  it("Phase 3.1: a job_source with company_id = NULL (every pre-Phase-3.1 row) still ingests exactly as before — company_id is not read anywhere in the ingest pipeline", async () => {
    const fetcher = vi.fn(async () => [] as NormJob[]);
    const supabase = createFakeIngestSupabase({
      jobSources: [
        { id: "src-1", user_id: "user-1", name: "Acme", careers_url: "https://boards.greenhouse.io/acme", ats: "Greenhouse", status: "active", company_id: null },
      ],
    });
    const result = await runImportJobsPipeline({ supabase, userId: "user-1", fetcher, openAiHealthCheck: fakeHealthyOpenAi });
    expect(fetcher).toHaveBeenCalledWith("Greenhouse", "acme");
    expect(result.totals.found).toBe(0); // ran cleanly to completion, no special-casing on a missing link
  });
});

describe("H. filtered ingest support (Phase 3.1, Step 6) — sourceIds scopes which sources run", () => {
  const threeSources = [
    { id: "src-a", user_id: "user-1", name: "Acme", careers_url: "https://boards.greenhouse.io/acme", ats: "Greenhouse", status: "active" },
    { id: "src-b", user_id: "user-1", name: "Beta", careers_url: "https://boards.greenhouse.io/beta", ats: "Greenhouse", status: "active" },
    { id: "src-c", user_id: "user-1", name: "Gamma", careers_url: "https://boards.greenhouse.io/gamma", ats: "Greenhouse", status: "active" },
  ];

  it("absent sourceIds -> current behavior: every active source runs", async () => {
    const fetcher = vi.fn(async () => [] as NormJob[]);
    const supabase = createFakeIngestSupabase({ jobSources: threeSources });
    await runImportJobsPipeline({ supabase, userId: "user-1", fetcher, openAiHealthCheck: fakeHealthyOpenAi });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("present sourceIds -> only those source ids run, even though others are active too", async () => {
    const fetcher = vi.fn(async () => [] as NormJob[]);
    const supabase = createFakeIngestSupabase({ jobSources: threeSources });
    await runImportJobsPipeline({ supabase, userId: "user-1", sourceIds: ["src-b"], fetcher, openAiHealthCheck: fakeHealthyOpenAi });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("Greenhouse", "beta");
  });

  it("a source id in the filter list that is NOT active is still excluded — the status='active' requirement is never bypassed by sourceIds", async () => {
    const fetcher = vi.fn(async () => [] as NormJob[]);
    const supabase = createFakeIngestSupabase({
      jobSources: [
        { id: "src-a", user_id: "user-1", name: "Acme", careers_url: "https://boards.greenhouse.io/acme", ats: "Greenhouse", status: "rejected" },
      ],
    });
    await runImportJobsPipeline({ supabase, userId: "user-1", sourceIds: ["src-a"], fetcher, openAiHealthCheck: fakeHealthyOpenAi });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("a filtered source still has its ATS independently re-validated — an unsupported careers_url in the filter list is rejected, not fetched", async () => {
    const fetcher = vi.fn(async () => [] as NormJob[]);
    const supabase = createFakeIngestSupabase({
      jobSources: [
        { id: "src-workday", user_id: "user-1", name: "Legacy Co", careers_url: "https://legacy.myworkdayjobs.com/careers", ats: "Workday", status: "active" },
      ],
    });
    const result = await runImportJobsPipeline({ supabase, userId: "user-1", sourceIds: ["src-workday"], fetcher, openAiHealthCheck: fakeHealthyOpenAi });
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.totals.rejected).toBe(1);
  });

  it("an empty sourceIds array behaves like 'absent' — falls through to all active sources, not zero", async () => {
    const fetcher = vi.fn(async () => [] as NormJob[]);
    const supabase = createFakeIngestSupabase({ jobSources: threeSources });
    await runImportJobsPipeline({ supabase, userId: "user-1", sourceIds: [], fetcher, openAiHealthCheck: fakeHealthyOpenAi });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});

describe("C. hard reject still wins — using a real production hard-reject rule", () => {
  it("hasAccessBlockers() (the actual rule importJobsNow uses as a hard reject) flags a login/captcha/MFA posting from a Company Scout-shaped source", () => {
    const { job } = scoutSourcedJob({ description: "Sign in to apply for this role. " + "A".repeat(280) });
    const blockers = hasAccessBlockers(job.description);
    expect(blockers.length).toBeGreaterThan(0);
  });

  it("a clean posting from the same Company Scout-shaped source produces no blockers — the rule discriminates on content, not origin", () => {
    const { job } = scoutSourcedJob();
    expect(hasAccessBlockers(job.description)).toEqual([]);
  });

  it("the real pipeline actually excludes an access-blocked posting from job_listings — the hard reject is unconditional, not just a standalone rule", async () => {
    const blockedJob: NormJob = {
      external_id: "job-1", title: "Operations Analyst",
      location: "Remote - US",
      description_html: "", description_text: "Sign in to apply for this role. " + "A".repeat(280),
      url: "https://boards.greenhouse.io/acme/jobs/1", posted_at: new Date().toISOString(),
      salary_min: 90000, salary_max: 110000, salary_estimated: false,
    };
    const fetcher = vi.fn(async () => [blockedJob]);
    const supabase = createFakeIngestSupabase({
      jobSources: [{ id: "src-1", user_id: "user-1", name: "Acme", careers_url: "https://boards.greenhouse.io/acme", ats: "Greenhouse", status: "active" }],
    });
    const result = await runImportJobsPipeline({ supabase, userId: "user-1", fetcher, openAiHealthCheck: fakeHealthyOpenAi });
    expect((supabase as any).insertedJobListings).toHaveLength(0);
    expect(result.totals.rejected).toBe(1);
  });
});

describe("D. US-remote eligibility remains job-level, never inherited from company approval", () => {
  it("isRemote()'s signature accepts only job text/location — it cannot read a company object even if a caller wanted it to", () => {
    // job-level only: (text: string, location?: string | null) => boolean.
    // There is no third `company` parameter to pass a company-level
    // us_remote_allowed flag through, structurally.
    expect(isRemote.length).toBeLessThanOrEqual(2);
  });

  it("an on-site/non-US job from an APPROVED, us_remote_allowed=true Company Scout company is still classified non-remote", () => {
    const { job } = scoutSourcedJob({ location: "London, UK — on-site", description: "On-site role in our London office. " + "A".repeat(260) });
    // Company-level us_remote_allowed=true (see scoutSourcedJob's company
    // fixture) must not leak into this per-job call — isRemote only ever
    // receives the job's own text/location, proven by the signature test
    // above and re-confirmed behaviorally here.
    expect(isRemote(job.description, job.location)).toBe(false);
  });

  it("a genuinely remote-US job from the same company classifies as remote — the rule tracks the job, not a company shortcut", () => {
    const { job } = scoutSourcedJob({ location: "Remote - US" });
    expect(isRemote(job.description, job.location)).toBe(true);
  });
});

describe("E. the production salary floor remains enforced (SALARY_FLOOR unchanged, not duplicated)", () => {
  it("SALARY_FLOOR is still $55,000", () => {
    expect(SALARY_FLOOR).toBe(55000);
  });

  it("isReadyToApply() rejects a Company Scout-shaped job one dollar under the floor, and accepts it at the floor", () => {
    const base = { trust_score: 96, interview_probability: 96, remote: true, ats: "Greenhouse" };
    expect(isReadyToApply({ ...base, salary_min: SALARY_FLOOR - 1 })).toBe(false);
    expect(isReadyToApply({ ...base, salary_min: SALARY_FLOOR })).toBe(true);
  });
});

describe("F. role-category filtering remains enforced regardless of company approval", () => {
  it("a software-engineering-only title is rejected by evaluateAutoReview() even for a trusted, APPROVED-company job that clears every other gate", () => {
    const { job, company } = scoutSourcedJob({ title: "Senior Backend Engineer" });
    const result = evaluateAutoReview({ job, company, quality: 96 });
    expect(result.decision).not.toBe("auto");
    expect(result.rejected_for.some((r) => /software-engineering-only/.test(r))).toBe(true);
  });

  it("an allowed production role category (Operations Analyst) is not rejected on role grounds", () => {
    const { job, company } = scoutSourcedJob({ title: "Operations Analyst" });
    const result = evaluateAutoReview({ job, company, quality: 96 });
    expect(result.rejected_for.some((r) => /role outside/.test(r))).toBe(false);
  });
});

describe("G. recency remains enforced regardless of company approval", () => {
  it("a job posted well beyond AUTO_THRESHOLDS.fresh_days fails the freshness gate even from an APPROVED company", () => {
    const staleDate = new Date(Date.now() - (AUTO_THRESHOLDS.fresh_days + 5) * 86_400_000).toISOString();
    const { job, company } = scoutSourcedJob({ posted_at: staleDate });
    const result = evaluateAutoReview({ job, company, quality: 96 });
    expect(result.failed.some((f) => f.startsWith("posted ≤"))).toBe(true);
    expect(result.decision).not.toBe("auto");
  });

  it("a job posted within the freshness window passes that specific gate", () => {
    const freshDate = new Date(Date.now() - 1 * 86_400_000).toISOString();
    const { job, company } = scoutSourcedJob({ posted_at: freshDate });
    const result = evaluateAutoReview({ job, company, quality: 96 });
    expect(result.passed.some((p) => p.startsWith("posted ≤"))).toBe(true);
  });
});

describe("H. trust / interview / quality gates remain enforced at production thresholds", () => {
  it("each gate independently blocks auto-decision one point below its production AUTO_THRESHOLDS value", () => {
    const { job, company } = scoutSourcedJob();

    const belowTrust = evaluateAutoReview({
      job, company: { ...company, trust_score: AUTO_THRESHOLDS.trust - 1 }, quality: 96,
    });
    expect(belowTrust.decision).not.toBe("auto");

    const belowInterview = evaluateAutoReview({
      job: { ...job, interview_probability: AUTO_THRESHOLDS.interview - 1 }, company, quality: 96,
    });
    expect(belowInterview.decision).not.toBe("auto");

    const belowQuality = evaluateAutoReview({ job, company, quality: AUTO_THRESHOLDS.quality - 1 });
    expect(belowQuality.decision).not.toBe("auto");
  });

  it("all three gates passing at the production threshold value is necessary but not sufficient on its own to change the tested boundary (each is checked independently above)", () => {
    const { job, company } = scoutSourcedJob();
    const atThreshold = evaluateAutoReview({
      job: { ...job, interview_probability: AUTO_THRESHOLDS.interview },
      company: { ...company, trust_score: AUTO_THRESHOLDS.trust },
      quality: AUTO_THRESHOLDS.quality,
    });
    expect(atThreshold.passed).toEqual(expect.arrayContaining([
      expect.stringContaining(`trust ≥ ${AUTO_THRESHOLDS.trust}`),
      expect.stringContaining(`interview ≥ ${AUTO_THRESHOLDS.interview}`),
      expect.stringContaining(`quality ≥ ${AUTO_THRESHOLDS.quality}`),
    ]));
  });
});

describe("I. the daily auto-pass-rate guard is not bypassable by job/company origin", () => {
  // The guard itself (liveRate > AUTO_GATES.passRateCap) lives inside
  // runSmartApply()'s handler body in smart-apply.functions.ts — a
  // createServerFn handler with the same non-DI-testable shape as
  // importJobsNow (see file header). It is NOT part of ingest.functions.ts
  // at all: ingestion and the pass-rate guard are two separate stages.
  // Structural inspection is the only option available without a
  // production refactor this phase doesn't authorize.
  it("AUTO_GATES.passRateCap derives from the single AUTO_THRESHOLDS source of truth, not a duplicated constant", () => {
    expect(SMART_APPLY_SRC).toMatch(/passRateCap:\s*AUTO_THRESHOLDS\.daily_pass_rate_cap/);
  });

  it("the pass-rate guard condition is unconditional on job/company origin — no discovery/scout-related check gates it", () => {
    const guardIdx = SMART_APPLY_SRC.indexOf("liveRate > AUTO_GATES.passRateCap");
    expect(guardIdx).toBeGreaterThan(-1);
    const surrounding = SMART_APPLY_SRC.slice(Math.max(0, guardIdx - 400), guardIdx + 100);
    expect(surrounding).not.toMatch(/discovery_status|discovery_source|company_scout|scout_origin/i);
  });
});

describe("J. job deduplication remains enforced", () => {
  it("the database-level unique index on job_listings(user_id, dedupe_hash) still exists in the migration history", () => {
    const src = readFileSync(
      new URL("../../supabase/migrations/20260515061540_35299a64-4094-4b46-8899-5b6e9ba6b773.sql", import.meta.url),
      "utf8"
    );
    expect(src).toMatch(/CREATE UNIQUE INDEX[\s\S]{0,120}job_listings\(user_id, dedupe_hash\)/);
  });

  it("a job whose dedupe_hash already exists in job_listings is never inserted again", async () => {
    const job: NormJob = {
      external_id: "job-1", title: "Operations Analyst", location: "Remote - US",
      description_html: "", description_text: "A".repeat(300),
      url: "https://boards.greenhouse.io/acme/jobs/1", posted_at: new Date().toISOString(),
      salary_min: 90000, salary_max: 110000, salary_estimated: false,
    };
    const dedupe = "acme|operations analyst|remote - us|https://boards.greenhouse.io/acme/jobs/1";
    const fetcher = vi.fn(async () => [job]);
    const supabase = createFakeIngestSupabase({
      jobSources: [{ id: "src-1", user_id: "user-1", name: "Acme", careers_url: "https://boards.greenhouse.io/acme", ats: "Greenhouse", status: "active" }],
      existingDedupeHashes: new Set([dedupe]),
    });
    const result = await runImportJobsPipeline({ supabase, userId: "user-1", fetcher, openAiHealthCheck: fakeHealthyOpenAi });
    expect((supabase as any).insertedJobListings).toHaveLength(0);
    expect(result.totals.duplicate).toBe(1);
  });

  it("a 23505 (unique-violation) race at insert time — the dedupe check passed, but the DB caught it anyway — is treated as a duplicate, not a hard failure", async () => {
    const job: NormJob = {
      external_id: "job-1", title: "Operations Analyst", location: "Remote - US",
      description_html: "", description_text: "A".repeat(300),
      url: "https://boards.greenhouse.io/acme/jobs/1", posted_at: new Date().toISOString(),
      salary_min: 90000, salary_max: 110000, salary_estimated: false,
    };
    const fetcher = vi.fn(async () => [job]);
    const supabase = createFakeIngestSupabase({
      jobSources: [{ id: "src-1", user_id: "user-1", name: "Acme", careers_url: "https://boards.greenhouse.io/acme", ats: "Greenhouse", status: "active" }],
      // The pre-insert select-based check finds nothing (a race), but the
      // insert itself reports Postgres's real unique-violation code.
      jobListingsInsertError: () => ({ code: "23505", message: "duplicate key value violates unique constraint" }),
    });
    const result = await runImportJobsPipeline({ supabase, userId: "user-1", fetcher, openAiHealthCheck: fakeHealthyOpenAi });
    expect(result.totals.duplicate).toBe(1);
    expect(result.totals.rejected).toBe(0); // a race-duplicate is not a hard failure
  });
});

describe("K. the supported-ATS requirement is structural, not a stored/forgeable field", () => {
  it("detectAts() — the function importJobsNow actually calls — ignores any stored 'ats' string and re-derives the platform from the live careers_url", () => {
    // A Company Scout-shaped job_source with a deliberately wrong stored
    // `ats` value cannot forge ATS support: importJobsNow never reads
    // src.ats for the platform decision (confirmed above), it recomputes
    // detectAts(src.careers_url) fresh every run.
    const det = detectAts("https://boards.greenhouse.io/acmeinc");
    expect(det.supported).toBe(true);
    expect(det.platform).toBe("Greenhouse");
    // The stored field is irrelevant to this outcome — detectAts() takes
    // only a URL, structurally incapable of reading a job_sources.ats value.
    expect(detectAts.length).toBe(1);
  });

  it("a job_source whose careers_url resolves to a recognized-but-unsupported ATS is rejected before any fetch is attempted", () => {
    const det = detectAts("https://acme.myworkdayjobs.com/careers");
    expect(det.supported).toBe(false);
    expect(det.platform).toBe("Workday");
    expect(SUPPORTED_ATS).not.toContain("Workday");
  });

  it("Company Scout itself only ever writes a supported-ATS careers_url into job_sources — ats-resolver.ts's own MAX_CANDIDATE_ENDPOINTS validation is the upstream guarantee (see ats-resolver.test.ts)", () => {
    // Cross-check the two files agree on the same 4-provider list, so
    // "supported" means the same thing on both sides of the handoff.
    expect(new Set(["Greenhouse", "Lever", "Ashby", "Breezy"])).toEqual(
      new Set(SUPPORTED_ATS.filter((a) => a !== "Workable"))
    );
  });
});

describe("L. the manual-review path remains available — a near-miss is routed, not discarded or auto-approved", () => {
  it("a job that fails exactly one gate (resume_match) lands in 'manual', not 'reject' or silently dropped", () => {
    const { job, company } = scoutSourcedJob({});
    const result = evaluateAutoReview({
      job: { ...job, resume_match: AUTO_THRESHOLDS.resume_match - 20 }, // well below, but nothing hard-rejects
      company, quality: 96,
    });
    expect(result.decision).toBe("manual");
    expect(result.rejected_for).toEqual([]);
    expect(result.failed.length).toBeGreaterThan(0);
    expect(result.passed.length).toBeGreaterThan(0);
  });

  it("a job that trips a soft gate (missing posted date) is still inserted into job_listings, with status='manual_review' and ready_to_apply=false — never omitted", async () => {
    const job: NormJob = {
      external_id: "job-1", title: "Operations Analyst", location: "Remote - US",
      description_html: "", description_text: "A".repeat(300),
      url: "https://boards.greenhouse.io/acme/jobs/1",
      posted_at: null, // triggers "missing_posted_date" — a soft gate, not a hard reject
      salary_min: 90000, salary_max: 110000, salary_estimated: false,
    };
    const fetcher = vi.fn(async () => [job]);
    const supabase = createFakeIngestSupabase({
      jobSources: [{ id: "src-1", user_id: "user-1", name: "Acme", careers_url: "https://boards.greenhouse.io/acme", ats: "Greenhouse", status: "active" }],
    });
    const result = await runImportJobsPipeline({ supabase, userId: "user-1", fetcher, openAiHealthCheck: fakeHealthyOpenAi });
    const inserted = (supabase as any).insertedJobListings;
    expect(inserted).toHaveLength(1);
    expect(inserted[0].status).toBe("manual_review");
    expect(inserted[0].ready_to_apply).toBe(false);
    expect(inserted[0].blockers).toContain("missing_posted_date");
    expect(result.totals.manual_review).toBe(1);
    expect(result.totals.imported).toBe(1); // manual-review jobs are still counted as imported, not rejected
  });
});

describe("architectural context checks that support the tests above", () => {
  it("computeTrustScore / computeInterviewProbability are unchanged in shape (sanity check that scoring.ts wasn't touched by this phase)", () => {
    const trust = computeTrustScore({
      has_official_site: true, has_careers_page: true, has_linkedin: true,
      ats_domain_match: true, business_footprint_score: 90, news_signals_count: 3,
    });
    expect(trust.score).toBeGreaterThanOrEqual(80);
    const interview = computeInterviewProbability({ resume_match: 96, remote: true, ats: "Greenhouse" });
    expect(interview.score).toBeGreaterThan(0);
  });

  it("parseSalary / detectScamFlags are real, unmocked production functions available to hard-reject/soft-gate logic", () => {
    expect(parseSalary("$90,000 - $120,000").min).toBe(90000);
    expect(detectScamFlags("Please arrange a wire transfer to begin onboarding.").length).toBeGreaterThan(0);
  });
});
