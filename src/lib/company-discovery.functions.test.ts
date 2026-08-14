// ============================================================================
// Company Discovery Intelligence Layer — Phase 2 unit tests (orchestrator).
//
// Exercises processCandidate() and refreshExistingCompany() directly against
// a hand-built mock Supabase client, bypassing the createServerFn/HTTP/
// auth-middleware machinery (that layer is Supabase/TanStack Start plumbing,
// not Company Scout logic, and isn't meaningfully unit-testable without a
// running server).
//
// fetchByPlatform (real network call in ingest.functions.ts) is mocked so
// these tests are deterministic and make no network requests.
//
// Covers the minimum required surface:
//   - Dry run produces ZERO insert/update calls to companies/job_sources,
//     while still returning correct would_create/would_update/would_add
//     outcomes.
//   - A valid, strong candidate creates the correct companies row AND the
//     correct job_sources row on a live (non-dry-run) run.
//   - An existing job_sources row is UPDATED, not duplicated, when the
//     canonical careers URL already exists in job_sources.
//
// Run with: bun run test  (vitest)
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildExistingCompanyIndex, NEUTRAL_PRIORS, type ExistingCompanyIndexEntry } from "./company-discovery";
import type { NormJob } from "./ingest.functions";

// ---- Mock the real network-calling ATS fetcher -----------------------------
// company-discovery.functions.ts imports `fetchByPlatform` (and the NormJob
// type) from ./ingest.functions. We replace the runtime value only; the type
// import is erased at compile time and needs no mock.
const mockFetchByPlatform = vi.fn<[string, string], Promise<NormJob[]>>();
vi.mock("./ingest.functions", () => ({
  fetchByPlatform: (...args: [string, string]) => mockFetchByPlatform(...args),
}));

// Imported AFTER the mock is registered so company-discovery.functions.ts
// picks up the mocked fetchByPlatform.
const { processCandidate, refreshExistingCompany } = await import("./company-discovery.functions");

// ----------------------------------------------------------------------------
// Mock Supabase client — records every insert/update call so tests can assert
// on exactly what would have been written, and lets each test configure what
// the (fake) database returns.
// ----------------------------------------------------------------------------
interface RecordedCall {
  table: string;
  op: "insert" | "update";
  payload: any;
  filters: Array<[string, any]>;
}

function createMockSupabase(config: {
  companiesInsertResult?: { data?: any; error?: any };
  companiesUpdateResult?: { error?: any };
  jobSourcesInsertResult?: { error?: any };
  jobSourcesUpdateResult?: { error?: any };
} = {}) {
  const calls: RecordedCall[] = [];
  const resolved = {
    companiesInsertResult: config.companiesInsertResult ?? { data: { id: "new-company-id" }, error: null },
    companiesUpdateResult: config.companiesUpdateResult ?? { error: null },
    jobSourcesInsertResult: config.jobSourcesInsertResult ?? { error: null },
    jobSourcesUpdateResult: config.jobSourcesUpdateResult ?? { error: null },
  };

  function resultFor(table: string, op: "insert" | "update") {
    if (table === "companies" && op === "insert") return resolved.companiesInsertResult;
    if (table === "companies" && op === "update") return resolved.companiesUpdateResult;
    if (table === "job_sources" && op === "insert") return resolved.jobSourcesInsertResult;
    if (table === "job_sources" && op === "update") return resolved.jobSourcesUpdateResult;
    return { error: null };
  }

  function makeChain(table: string, op: "insert" | "update", payload: any) {
    const filters: Array<[string, any]> = [];
    let logged = false;
    const log = () => {
      if (!logged) {
        calls.push({ table, op, payload, filters: [...filters] });
        logged = true;
      }
    };
    const chain: any = {
      eq(col: string, val: any) {
        filters.push([col, val]);
        return chain;
      },
      select(_cols: string) {
        return chain;
      },
      single() {
        log();
        return Promise.resolve(resultFor(table, op));
      },
      then(resolve: any, reject: any) {
        log();
        return Promise.resolve(resultFor(table, op)).then(resolve, reject);
      },
    };
    return chain;
  }

  return {
    calls,
    from(table: string) {
      return {
        insert(payload: any) {
          return makeChain(table, "insert", payload);
        },
        update(payload: any) {
          return makeChain(table, "update", payload);
        },
      };
    },
  };
}

// A sample of strong, relevant, US-eligible, well-paid postings — designed to
// clear the APPROVED/HIGH_PRIORITY opportunity-score band so job_sources
// upsert logic actually runs.
function strongJobSample(): NormJob[] {
  const titles = [
    "Senior Business Analyst",
    "Customer Success Manager",
    "Operations Coordinator",
    "Product Analyst",
    "Business Operations Lead",
  ];
  return titles.map((title, i) => ({
    external_id: `job-${i}`,
    title,
    location: "Remote - US",
    description_html: "<p>Remote - US. Must be based in the United States. $95,000 - $120,000</p>",
    description_text: "Remote - US. Must be based in the United States. $95,000 - $120,000",
    url: `https://boards.greenhouse.io/acmeinc/jobs/${i}`,
    posted_at: new Date().toISOString(),
    salary_min: 95000,
    salary_max: 120000,
    salary_estimated: false,
  }));
}

// A weak sample that should never clear the sourcing bar: EU-only, irrelevant
// roles, no salary signal.
function weakJobSample(): NormJob[] {
  return [
    {
      external_id: "job-weak-0",
      title: "Senior Backend Engineer",
      location: "EU only",
      description_html: "<p>This role is EU-only.</p>",
      description_text: "This role is EU-only.",
      url: "https://boards.greenhouse.io/weakco/jobs/0",
      posted_at: new Date().toISOString(),
      salary_min: null,
      salary_max: null,
      salary_estimated: true,
    },
  ];
}

beforeEach(() => {
  mockFetchByPlatform.mockReset();
});

describe("processCandidate — dry run", () => {
  it("makes ZERO insert/update calls to companies or job_sources, yet still returns would_create + would_add", async () => {
    mockFetchByPlatform.mockResolvedValue(strongJobSample());
    const supabase = createMockSupabase();
    const existingIndex = buildExistingCompanyIndex([]);

    const outcome = await processCandidate({
      supabase,
      userId: "user-1",
      candidate: {
        name: "Acme Inc",
        domain_guess: "acme.com",
        careers_url_guess: "https://boards.greenhouse.io/acmeinc",
        discovery_level: 2,
        discovery_source: "ats_pattern",
        discovery_reason: "test fixture",
      },
      existingIndex,
      existingJobSourceUrls: new Set<string>(),
      priors: NEUTRAL_PRIORS,
      dryRun: true,
      remainingNewCompanySlots: 25,
      remainingNewSourceSlots: 10,
    });

    expect(supabase.calls).toEqual([]); // <-- the core dry-run guarantee
    expect(outcome.outcome).toBe("would_create");
    expect(outcome.job_source_action).toBe("would_add");
    expect(outcome.discovery_status === "APPROVED" || outcome.discovery_status === "HIGH_PRIORITY").toBe(true);
  });

  it("refreshExistingCompany dry run also makes zero mutation calls", async () => {
    mockFetchByPlatform.mockResolvedValue(strongJobSample());
    const supabase = createMockSupabase();

    const outcome = await refreshExistingCompany({
      supabase,
      userId: "user-1",
      company: {
        id: "existing-1",
        name: "Acme Inc",
        domain: "acme.com",
        careers_url: "https://boards.greenhouse.io/acmeinc",
        ats_provider: "Greenhouse",
        discovery_status: "APPROVED",
        company_opportunity_score: 80,
        avg_job_quality: null,
        application_count: 0,
        response_count: 0,
        interview_count: 0,
        last_job_seen_at: null,
      },
      priors: NEUTRAL_PRIORS,
      dryRun: true,
    });

    expect(supabase.calls).toEqual([]);
    expect(outcome.outcome).toBe("would_update");
  });
});

describe("processCandidate — live run", () => {
  it("creates the correct companies row AND the correct job_sources row for a strong new candidate", async () => {
    mockFetchByPlatform.mockResolvedValue(strongJobSample());
    const supabase = createMockSupabase({
      companiesInsertResult: { data: { id: "new-company-id" }, error: null },
    });
    const existingIndex = buildExistingCompanyIndex([]);

    const outcome = await processCandidate({
      supabase,
      userId: "user-1",
      candidate: {
        name: "Acme Inc",
        domain_guess: "acme.com",
        careers_url_guess: "https://boards.greenhouse.io/acmeinc",
        discovery_level: 2,
        discovery_source: "ats_pattern",
        discovery_reason: "test fixture",
      },
      existingIndex,
      existingJobSourceUrls: new Set<string>(),
      priors: NEUTRAL_PRIORS,
      dryRun: false,
      remainingNewCompanySlots: 25,
      remainingNewSourceSlots: 10,
    });

    expect(outcome.outcome).toBe("created");
    expect(outcome.matched_existing_company_id).toBe("new-company-id");
    expect(outcome.job_source_action).toBe("added");

    const companiesInsert = supabase.calls.find((c) => c.table === "companies" && c.op === "insert");
    const jobSourcesInsert = supabase.calls.find((c) => c.table === "job_sources" && c.op === "insert");
    expect(companiesInsert).toBeDefined();
    expect(companiesInsert!.payload.user_id).toBe("user-1");
    expect(companiesInsert!.payload.domain).toBe("acme.com");
    expect(jobSourcesInsert).toBeDefined();
    expect(jobSourcesInsert!.payload.careers_url).toBe("https://boards.greenhouse.io/acmeinc");
    expect(jobSourcesInsert!.payload.ats).toBe("Greenhouse");
    // No update calls should have happened for a brand-new company.
    expect(supabase.calls.some((c) => c.op === "update")).toBe(false);
  });

  it("does NOT duplicate an existing job_sources row — updates it instead", async () => {
    mockFetchByPlatform.mockResolvedValue(strongJobSample());
    const existingCompany: ExistingCompanyIndexEntry = {
      id: "existing-company-1",
      domain: "acme.com",
      ats_provider: "Greenhouse",
      ats_company_slug: "acmeinc",
      careers_url: "https://boards.greenhouse.io/acmeinc",
      name: "Acme Inc",
    };
    const existingIndex = buildExistingCompanyIndex([existingCompany]);
    const supabase = createMockSupabase();

    const outcome = await processCandidate({
      supabase,
      userId: "user-1",
      candidate: {
        name: "Acme Inc",
        domain_guess: "acme.com",
        careers_url_guess: "https://boards.greenhouse.io/acmeinc",
        discovery_level: 1,
        discovery_source: "ats_pattern",
        discovery_reason: "refresh via level-2 rediscovery",
      },
      existingIndex,
      // Canonical URL already present — simulates a source that already exists.
      existingJobSourceUrls: new Set<string>(["boards.greenhouse.io/acmeinc"]),
      priors: NEUTRAL_PRIORS,
      dryRun: false,
      remainingNewCompanySlots: 25,
      remainingNewSourceSlots: 10,
    });

    expect(outcome.matched_existing_company_id).toBe("existing-company-1");
    expect(outcome.matched_by).toBe("domain");
    expect(outcome.outcome).toBe("updated");
    expect(outcome.job_source_action).toBe("updated");

    const jobSourcesInsert = supabase.calls.find((c) => c.table === "job_sources" && c.op === "insert");
    const jobSourcesUpdate = supabase.calls.find((c) => c.table === "job_sources" && c.op === "update");
    expect(jobSourcesInsert).toBeUndefined(); // <-- the no-duplicate guarantee
    expect(jobSourcesUpdate).toBeDefined();

    const companiesInsert = supabase.calls.find((c) => c.table === "companies" && c.op === "insert");
    expect(companiesInsert).toBeUndefined(); // matched existing company → update, not insert
  });

  it("rejects a weak/ineligible candidate before it ever reaches company_upsert with an active source", async () => {
    mockFetchByPlatform.mockResolvedValue(weakJobSample());
    const supabase = createMockSupabase();
    const existingIndex = buildExistingCompanyIndex([]);

    const outcome = await processCandidate({
      supabase,
      userId: "user-1",
      candidate: {
        name: "Weak Co",
        domain_guess: "weakco.com",
        careers_url_guess: "https://boards.greenhouse.io/weakco",
        discovery_level: 2,
        discovery_source: "ats_pattern",
        discovery_reason: "test fixture",
      },
      existingIndex,
      existingJobSourceUrls: new Set<string>(),
      priors: NEUTRAL_PRIORS,
      dryRun: false,
      remainingNewCompanySlots: 25,
      remainingNewSourceSlots: 10,
    });

    // The company row is still recorded (so it isn't re-discovered every run)
    // but it must never become an active job source.
    expect(outcome.job_source_action).toBe("skipped");
    expect(supabase.calls.some((c) => c.table === "job_sources")).toBe(false);
  });

  it("rejects candidates on unsupported/rejected ATS platforms without any Supabase calls", async () => {
    const supabase = createMockSupabase();
    const existingIndex = buildExistingCompanyIndex([]);

    const outcome = await processCandidate({
      supabase,
      userId: "user-1",
      candidate: {
        name: "Workday Co",
        domain_guess: "workdayco.com",
        careers_url_guess: "https://workdayco.myworkdayjobs.com/careers",
        discovery_level: 2,
        discovery_source: "ats_pattern",
        discovery_reason: "test fixture",
      },
      existingIndex,
      existingJobSourceUrls: new Set<string>(),
      priors: NEUTRAL_PRIORS,
      dryRun: false,
      remainingNewCompanySlots: 25,
      remainingNewSourceSlots: 10,
    });

    expect(outcome.outcome).toBe("rejected");
    expect(outcome.reject_reason).toContain("unsupported_ats");
    expect(supabase.calls).toEqual([]);
    expect(mockFetchByPlatform).not.toHaveBeenCalled();
  });

  it("respects remainingNewCompanySlots — rejects a new company when the cap is exhausted", async () => {
    mockFetchByPlatform.mockResolvedValue(strongJobSample());
    const supabase = createMockSupabase();
    const existingIndex = buildExistingCompanyIndex([]);

    const outcome = await processCandidate({
      supabase,
      userId: "user-1",
      candidate: {
        name: "Acme Inc",
        domain_guess: "acme.com",
        careers_url_guess: "https://boards.greenhouse.io/acmeinc",
        discovery_level: 2,
        discovery_source: "ats_pattern",
        discovery_reason: "test fixture",
      },
      existingIndex,
      existingJobSourceUrls: new Set<string>(),
      priors: NEUTRAL_PRIORS,
      dryRun: false,
      remainingNewCompanySlots: 0, // <-- cap exhausted
      remainingNewSourceSlots: 10,
    });

    expect(outcome.outcome).toBe("rejected");
    expect(outcome.reject_reason).toBe("max_new_companies_validated_per_run_reached");
    expect(supabase.calls).toEqual([]);
  });
});
