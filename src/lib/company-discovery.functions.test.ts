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
import { buildExistingCompanyIndex, NEUTRAL_PRIORS, statusForOpportunityScore, type ExistingCompanyIndexEntry } from "./company-discovery";
import type { NormJob } from "./ingest.functions";
import type { AtsResolutionResult } from "./ats-resolver";

// ---- Mock the real network-calling ATS fetcher -----------------------------
// company-discovery.functions.ts imports `fetchByPlatform` (and the NormJob
// type) from ./ingest.functions. We replace the runtime value only; the type
// import is erased at compile time and needs no mock.
const mockFetchByPlatform = vi.fn<(platform: string, slug: string) => Promise<NormJob[]>>();

vi.doMock("./ingest.functions", async () => {
  const actual = await vi.importActual<typeof import("./ingest.functions")>("./ingest.functions");
  return {
    ...actual,
    fetchByPlatform: mockFetchByPlatform,
  };
});

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

// Fills in Phase 2.6 v2.1/v2.2's budget-telemetry fields with sensible
// defaults so integration-test fixtures only need to specify what each test
// actually cares about (attemptCount, resolutionStatus, etc).
function fakeAtsResolution(overrides: Partial<AtsResolutionResult> & Pick<AtsResolutionResult,
  "resolved" | "resolutionStatus" | "provider" | "careersUrl" | "slug" | "confidence" | "resolutionMethod"
>): AtsResolutionResult {
  const attemptCount = overrides.attemptCount ?? 0;
  return {
    validationEvidence: [],
    careerPageChecked: false,
    detectedUnsupportedProvider: null,
    validatedJobCount: null,
    attemptsBySource: { canonical_link: 0, career_page_link: 0, career_page_redirect: 0, known_url_pattern: 0, ai_hint_validated: 0 },
    attemptBudgetMax: 8,
    attemptBudgetUsed: attemptCount,
    attemptBudgetRemaining: 8 - attemptCount,
    successfulAttemptsBySource: { canonical_link: 0, career_page_link: 0, career_page_redirect: 0, known_url_pattern: 0, ai_hint_validated: 0 },
    failedAttemptsBySource: { canonical_link: 0, career_page_link: 0, career_page_redirect: 0, known_url_pattern: 0, ai_hint_validated: 0 },
    aiCandidatesGenerated: 0,
    aiCandidatesValidated: 0,
    aiCandidatesSuccessful: 0,
    detectedProviderHint: null,
    attemptCount,
    ...overrides,
  };
}

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
      fetcher: mockFetchByPlatform,
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
      fetcher: mockFetchByPlatform,
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
      fetcher: mockFetchByPlatform,
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

  // ----------------------------------------------------------------------
  // Phase 3.0, Step 5 — the job_sources payload Company Scout writes for an
  // APPROVED/HIGH_PRIORITY company must be shaped exactly like a manually
  // added source (see ingest.functions.test.ts's "A. a Company Scout-shaped
  // source receives no special treatment" for the reverse proof — that the
  // ingestion side treats the two identically). This test proves the
  // WRITING side matches importJobsNow's actual read contract: it queries
  // job_sources WHERE status='active' and reads .name/.careers_url/.ats/.id
  // — every field it reads must be present and correctly shaped here.
  // Deliberately does NOT assert company_id — that field doesn't exist on
  // job_sources yet; adding it is Phase 3.1, not 3.0.
  // ----------------------------------------------------------------------
  it("Phase 3.0: an APPROVED/HIGH_PRIORITY company's job_sources payload is fully compatible with importJobsNow's ingestion contract", async () => {
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
      fetcher: mockFetchByPlatform,
    });

    expect(["APPROVED", "HIGH_PRIORITY"]).toContain(outcome.discovery_status);

    const jobSourcesInsert = supabase.calls.find((c) => c.table === "job_sources" && c.op === "insert");
    expect(jobSourcesInsert).toBeDefined();
    const payload = jobSourcesInsert!.payload;

    // Every field importJobsNow's handler actually reads off a job_sources
    // row (careers_url, name, ats, status, id — the last supplied by the DB
    // on insert) must be present and correctly typed.
    expect(payload.user_id).toBe("user-1");
    expect(payload.name).toBe("Acme Inc");
    expect(typeof payload.name).toBe("string");
    expect(payload.careers_url).toBe("https://boards.greenhouse.io/acmeinc");
    expect(payload.ats).toBe("Greenhouse");
    expect(["Greenhouse", "Lever", "Ashby", "Breezy"]).toContain(payload.ats);
    expect(payload.status).toBe("active");

    // Phase 3.1: the row is linked to the just-created company by id, not
    // guessed/fabricated — see outcome.job_source_company_id below.
    expect(payload.company_id).toBe(outcome.matched_existing_company_id);
    expect(payload.company_id).toBe(outcome.job_source_company_id);

    // The only field beyond the pre-Phase-3.1 shape is company_id — see the
    // architectural boundary test for the full key-set comparison against
    // addJobSource()'s manual-entry payload (which predates company_id and
    // deliberately still doesn't set it — a manually-added source has no
    // Company Scout-derived company to link to).
    expect(Object.keys(payload).sort()).toEqual(
      ["user_id", "name", "careers_url", "ats", "status", "notes", "company_id"].sort()
    );
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
      fetcher: mockFetchByPlatform,
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

    // D. Existing company linkage: the update uses the EXISTING company's id
    // — known immediately, no insert needed to learn it.
    // G. Source update: an existing job_source's company_id is (re)written
    // every time Company Scout revisits it — repairing any pre-Phase-3.1 row
    // whose company_id was previously null.
    expect(outcome.job_source_company_id).toBe("existing-company-1");
    expect(jobSourcesUpdate!.payload.company_id).toBe("existing-company-1");
  });

  it("E. Dry-run: the proposed company_id linkage is visible on the outcome for a matched existing company, with zero DB mutation", async () => {
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
        discovery_reason: "test fixture",
      },
      existingIndex,
      existingJobSourceUrls: new Set<string>(),
      priors: NEUTRAL_PRIORS,
      dryRun: true,
      remainingNewCompanySlots: 25,
      remainingNewSourceSlots: 10,
      fetcher: mockFetchByPlatform,
    });

    expect(outcome.job_source_company_id).toBe("existing-company-1"); // proposed linkage, visible before any write
    expect(outcome.job_source_action).toBe("would_add");
    expect(supabase.calls).toEqual([]); // zero DB mutation
  });

  it("E (new company). Dry-run for a brand-new company reports no company_id yet — a real id can't exist until the insert actually happens", async () => {
    mockFetchByPlatform.mockResolvedValue(strongJobSample());
    const supabase = createMockSupabase();
    const existingIndex = buildExistingCompanyIndex([]);

    const outcome = await processCandidate({
      supabase,
      userId: "user-1",
      candidate: {
        name: "Brand New Co",
        domain_guess: "brandnew.com",
        careers_url_guess: "https://boards.greenhouse.io/brandnew",
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
      fetcher: mockFetchByPlatform,
    });

    expect(outcome.outcome).toBe("would_create");
    expect(outcome.job_source_action).toBe("would_add");
    expect(outcome.job_source_company_id).toBeNull();
    expect(supabase.calls).toEqual([]);
  });

  it("F. Company persistence failure: if the companies insert fails, no job_sources row is ever created", async () => {
    mockFetchByPlatform.mockResolvedValue(strongJobSample());
    const supabase = createMockSupabase({
      companiesInsertResult: { data: null, error: { message: "simulated companies insert failure" } },
    });
    const existingIndex = buildExistingCompanyIndex([]);

    const outcome = await processCandidate({
      supabase,
      userId: "user-1",
      candidate: {
        name: "Doomed Co",
        domain_guess: "doomed.com",
        careers_url_guess: "https://boards.greenhouse.io/doomed",
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
      fetcher: mockFetchByPlatform,
    });

    expect(outcome.outcome).toBe("error");
    expect(outcome.error).toBe("simulated companies insert failure");
    expect(outcome.job_source_action).toBeNull();
    expect(outcome.job_source_company_id).toBeUndefined();
    const jobSourcesCalls = supabase.calls.filter((c: any) => c.table === "job_sources");
    expect(jobSourcesCalls).toEqual([]);
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
      fetcher: mockFetchByPlatform,
    });

    // The company row is still recorded (so it isn't re-discovered every run)
    // but it must never become an active job source. weakJobSample() is
    // EU-only, so this specific fixture lands on INACTIVE (us_excluded) —
    // asserted explicitly (Phase 3.0, Step 5) rather than left implicit.
    expect(outcome.discovery_status).toBe("INACTIVE");
    expect(outcome.job_source_action).toBe("skipped");
    expect(supabase.calls.some((c) => c.table === "job_sources")).toBe(false);
  });

  // ----------------------------------------------------------------------
  // Phase 3.0, Step 5 — the eligibleForSourcing gate in processCandidate()
  // is a simple two-value allowlist: only APPROVED/HIGH_PRIORITY ever reach
  // the job_sources upsert. Rather than hand-engineer job/score fixtures to
  // land exactly in the WATCHLIST/LOW_YIELD bands (fragile — the scoring
  // formula has many interacting factors), this proves the ALLOWLIST ITSELF
  // is correct at the pure scoring-status level via the same exported
  // statusForOpportunityScore() processCandidate() calls internally, then
  // cross-checks that only its two "eligible" outputs are the ones
  // processCandidate treats as sourcing-eligible (see the source-derived
  // eligibleForSourcing check in company-discovery.functions.ts).
  // ----------------------------------------------------------------------
  it("Phase 3.0: WATCHLIST, LOW_YIELD, and INACTIVE discovery statuses are all distinct from, and never equal to, APPROVED/HIGH_PRIORITY", () => {
    expect(statusForOpportunityScore(95, false)).toBe("HIGH_PRIORITY");
    expect(statusForOpportunityScore(80, false)).toBe("APPROVED");
    expect(statusForOpportunityScore(60, false)).toBe("WATCHLIST");
    expect(statusForOpportunityScore(30, false)).toBe("LOW_YIELD");
    expect(statusForOpportunityScore(95, true)).toBe("INACTIVE"); // us_excluded overrides even a top score

    const eligibleForSourcing = new Set(["APPROVED", "HIGH_PRIORITY"]);
    for (const status of ["WATCHLIST", "LOW_YIELD", "INACTIVE"]) {
      expect(eligibleForSourcing.has(status)).toBe(false);
    }
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
      fetcher: mockFetchByPlatform,
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
      fetcher: mockFetchByPlatform,
    });

    expect(outcome.outcome).toBe("rejected");
    expect(outcome.reject_reason).toBe("max_new_companies_validated_per_run_reached");
    expect(supabase.calls).toEqual([]);
  });
});

// ----------------------------------------------------------------------------
// Phase 2.6 addendum — ATS Resolver integration. processCandidate() accepts
// an optional, dependency-injected `atsResolver` (src/lib/ats-resolver.ts);
// this proves the wiring end-to-end without any Vitest module mocking of
// ats-resolver.ts itself — see ats-resolver.test.ts for the resolver's own
// unit tests (direct/career-page-link/pattern/AI resolution, safety caps,
// etc.), which use the same dependency-injection approach.
// ----------------------------------------------------------------------------

describe("production candidate prioritization", () => {
  it("prioritizes supported-ATS candidates when the candidate pool is oversupplied", () => {
    const candidates = [
      { name: "Unknown A", ats_provider_guess: null },
      { name: "Unknown B", ats_provider_guess: null },
      { name: "Greenhouse A", ats_provider_guess: "Greenhouse" },
      { name: "Ashby A", ats_provider_guess: "Ashby" },
      { name: "Lever A", ats_provider_guess: "Lever" },
      { name: "Breezy A", ats_provider_guess: "Breezy" },
    ];

    const hasSupportedAtsHint = (c: any) =>
      c.ats_provider_guess === "Greenhouse" ||
      c.ats_provider_guess === "Lever" ||
      c.ats_provider_guess === "Ashby" ||
      c.ats_provider_guess === "Breezy";

    const supported = candidates.filter(hasSupportedAtsHint);
    const exploratory = candidates.filter((c) => !hasSupportedAtsHint(c));

    const targetCandidateCount = 5;
    const exploratoryTarget = Math.max(
      1,
      Math.floor(targetCandidateCount * 0.2)
    );
    const supportedTarget =
      targetCandidateCount - exploratoryTarget;

    const selected = [
      ...supported.slice(0, supportedTarget),
      ...exploratory.slice(0, exploratoryTarget),
    ];

    expect(selected).toHaveLength(5);
    expect(selected.filter(hasSupportedAtsHint)).toHaveLength(4);
    expect(selected.filter((c) => !hasSupportedAtsHint(c))).toHaveLength(1);
  });

  it("preserves an exploratory candidate when Unknown-ATS inventory exists", () => {
    const supported = [
      { name: "Greenhouse A", ats_provider_guess: "Greenhouse" },
      { name: "Greenhouse B", ats_provider_guess: "Greenhouse" },
      { name: "Ashby A", ats_provider_guess: "Ashby" },
      { name: "Lever A", ats_provider_guess: "Lever" },
    ];

    const exploratory = [
      { name: "Unknown A", ats_provider_guess: null },
      { name: "Unknown B", ats_provider_guess: null },
    ];

    const targetCandidateCount = 4;

    const exploratoryTarget =
      targetCandidateCount > 0 && exploratory.length > 0
        ? Math.max(1, Math.floor(targetCandidateCount * 0.2))
        : 0;

    const supportedTarget =
      targetCandidateCount - exploratoryTarget;

    const selected = [
      ...supported.slice(0, supportedTarget),
      ...exploratory.slice(0, exploratoryTarget),
    ];

    expect(selected).toHaveLength(4);
    expect(
      selected.some((c) => c.ats_provider_guess == null)
    ).toBe(true);
  });
});

describe("processCandidate — ATS Resolver integration (Phase 2.6)", () => {
  it("promotes an Unknown-platform candidate to the normal pipeline once the injected resolver verifies a supported ATS endpoint", async () => {
    mockFetchByPlatform.mockResolvedValue(strongJobSample());
    const supabase = createMockSupabase();
    const existingIndex = buildExistingCompanyIndex([]);
    const fakeAtsResolver = vi.fn(async (): Promise<AtsResolutionResult> => fakeAtsResolution({
      resolved: true,
      resolutionStatus: "resolved",
      provider: "Greenhouse",
      careersUrl: "https://boards.greenhouse.io/zapier",
      slug: "zapier",
      confidence: "high",
      resolutionMethod: "career_page_link",
      attemptCount: 1,
      careerPageChecked: true,
      validatedJobCount: 5,
      attemptsBySource: { canonical_link: 0, career_page_link: 1, career_page_redirect: 0, known_url_pattern: 0, ai_hint_validated: 0 },
    }));

    const outcome = await processCandidate({
      supabase,
      userId: "user-1",
      candidate: {
        name: "Zapier",
        domain_guess: "zapier.com",
        careers_url_guess: "https://zapier.com/jobs", // generic page — detectAts() alone reports Unknown
        discovery_level: 4,
        discovery_source: "manual",
        discovery_reason: "test fixture",
      },
      existingIndex,
      existingJobSourceUrls: new Set<string>(),
      priors: NEUTRAL_PRIORS,
      dryRun: true,
      remainingNewCompanySlots: 25,
      remainingNewSourceSlots: 10,
      fetcher: mockFetchByPlatform,
      atsResolver: fakeAtsResolver,
    });

    expect(fakeAtsResolver).toHaveBeenCalledTimes(1);
    expect(outcome.ats_provider).toBe("Greenhouse");
    expect(outcome.careers_url).toBe("https://boards.greenhouse.io/zapier");
    expect(outcome.ats_resolution?.resolved).toBe(true);
    // Fell through into the exact same pipeline a directly-supported
    // candidate would use — real fetchByPlatform mock was called with the
    // RESOLVED (provider, slug), and scoring/eligibility ran normally.
    expect(mockFetchByPlatform).toHaveBeenCalledWith("Greenhouse", "zapier");
    expect(outcome.outcome).toBe("would_create");
    expect(supabase.calls).toEqual([]); // still a dry run — zero mutation
  });

  it("rejects as unsupported_ats:Unknown when the injected resolver cannot verify any supported ATS endpoint", async () => {
    const supabase = createMockSupabase();
    const existingIndex = buildExistingCompanyIndex([]);
    const fakeAtsResolver = vi.fn(async (): Promise<AtsResolutionResult> => fakeAtsResolution({
      resolved: false,
      resolutionStatus: "unresolved",
      provider: null,
      careersUrl: null,
      slug: null,
      confidence: "low",
      resolutionMethod: "unresolved",
      attemptCount: 8,
      careerPageChecked: true,
    }));

    const outcome = await processCandidate({
      supabase,
      userId: "user-1",
      candidate: {
        name: "Totally Unresolvable LLC",
        domain_guess: "unresolvable.com",
        careers_url_guess: "https://unresolvable.com/careers",
        discovery_level: 4,
        discovery_source: "manual",
        discovery_reason: "test fixture",
      },
      existingIndex,
      existingJobSourceUrls: new Set<string>(),
      priors: NEUTRAL_PRIORS,
      dryRun: true,
      remainingNewCompanySlots: 25,
      remainingNewSourceSlots: 10,
      atsResolver: fakeAtsResolver,
    });

    expect(fakeAtsResolver).toHaveBeenCalledTimes(1);
    expect(outcome.outcome).toBe("rejected");
    expect(outcome.reject_reason).toBe("unsupported_ats:Unknown");
    expect(supabase.calls).toEqual([]);
    expect(mockFetchByPlatform).not.toHaveBeenCalled();
  });

  it("does NOT invoke the resolver for explicitly-rejected/walled platforms (e.g. Workday) — only for Unknown", async () => {
    const supabase = createMockSupabase();
    const existingIndex = buildExistingCompanyIndex([]);
    const fakeAtsResolver = vi.fn(async (): Promise<AtsResolutionResult> => fakeAtsResolution({
      resolved: false, resolutionStatus: "unresolved", provider: null, careersUrl: null, slug: null,
      confidence: "low", resolutionMethod: "unresolved",
    }));

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
      atsResolver: fakeAtsResolver,
    });

    expect(fakeAtsResolver).not.toHaveBeenCalled();
    expect(outcome.outcome).toBe("rejected");
    expect(outcome.reject_reason).toBe("unsupported_ats:Workday");
  });

  it("Phase 2.6 v2: a resolver-detected unsupported provider (resolutionStatus: unsupported_provider) is rejected with that specific provider — never becomes a job source", async () => {
    const supabase = createMockSupabase();
    const existingIndex = buildExistingCompanyIndex([]);
    const fakeAtsResolver = vi.fn(async (): Promise<AtsResolutionResult> => fakeAtsResolution({
      resolved: false,
      resolutionStatus: "unsupported_provider",
      provider: null,
      careersUrl: null,
      slug: null,
      confidence: "low",
      resolutionMethod: "unresolved",
      attemptCount: 3,
      careerPageChecked: true,
      detectedUnsupportedProvider: "Workday",
    }));

    const outcome = await processCandidate({
      supabase,
      userId: "user-1",
      candidate: {
        name: "Legacy Careers Co",
        domain_guess: "legacycareers.com",
        // Generic careers page — detectAts() alone reports Unknown, so the
        // resolver runs and discovers the page links to Workday.
        careers_url_guess: "https://legacycareers.com/jobs",
        discovery_level: 4,
        discovery_source: "manual",
        discovery_reason: "test fixture",
      },
      existingIndex,
      existingJobSourceUrls: new Set<string>(),
      priors: NEUTRAL_PRIORS,
      dryRun: false,
      remainingNewCompanySlots: 25,
      remainingNewSourceSlots: 10,
      atsResolver: fakeAtsResolver,
    });

    expect(fakeAtsResolver).toHaveBeenCalledTimes(1);
    expect(outcome.outcome).toBe("rejected");
    // The specific detected provider is preserved, not just a generic Unknown.
    expect(outcome.reject_reason).toBe("unsupported_ats:Workday");
    expect(outcome.ats_resolution?.resolutionStatus).toBe("unsupported_provider");
    expect(outcome.ats_resolution?.detectedUnsupportedProvider).toBe("Workday");
    expect(supabase.calls).toEqual([]);
    expect(mockFetchByPlatform).not.toHaveBeenCalled();
  });

  it("Phase 2.6 v2.2: a resolver-detected stale/inactive company (resolutionStatus: stale_or_inactive_company) is rejected with that reason — never becomes a job source", async () => {
    const supabase = createMockSupabase();
    const existingIndex = buildExistingCompanyIndex([]);
    const fakeAtsResolver = vi.fn(async (): Promise<AtsResolutionResult> => fakeAtsResolution({
      resolved: false,
      resolutionStatus: "stale_or_inactive_company",
      provider: null,
      careersUrl: null,
      slug: null,
      confidence: "low",
      resolutionMethod: "unresolved",
      attemptCount: 6,
      careerPageChecked: true,
    }));

    const outcome = await processCandidate({
      supabase,
      userId: "user-1",
      candidate: {
        name: "Defunct Product Co",
        domain_guess: "defunctproduct.com",
        careers_url_guess: "https://defunctproduct.com/careers",
        discovery_level: 4,
        discovery_source: "manual",
        discovery_reason: "test fixture",
      },
      existingIndex,
      existingJobSourceUrls: new Set<string>(),
      priors: NEUTRAL_PRIORS,
      dryRun: false,
      remainingNewCompanySlots: 25,
      remainingNewSourceSlots: 10,
      atsResolver: fakeAtsResolver,
    });

    expect(fakeAtsResolver).toHaveBeenCalledTimes(1);
    expect(outcome.outcome).toBe("rejected");
    expect(outcome.reject_reason).toBe("stale_or_inactive_company");
    expect(outcome.ats_resolution?.resolutionStatus).toBe("stale_or_inactive_company");
    expect(outcome.job_source_action).toBeNull();
    expect(supabase.calls).toEqual([]);
    expect(mockFetchByPlatform).not.toHaveBeenCalled();
  });

  it("Phase 2.6 v2.2: a resolver finding no supported-ATS evidence at all (resolutionStatus: no_supported_ats_evidence) is rejected with that reason — never becomes a job source", async () => {
    const supabase = createMockSupabase();
    const existingIndex = buildExistingCompanyIndex([]);
    const fakeAtsResolver = vi.fn(async (): Promise<AtsResolutionResult> => fakeAtsResolution({
      resolved: false,
      resolutionStatus: "no_supported_ats_evidence",
      provider: null,
      careersUrl: null,
      slug: null,
      confidence: "low",
      resolutionMethod: "unresolved",
      attemptCount: 4,
      careerPageChecked: true,
    }));

    const outcome = await processCandidate({
      supabase,
      userId: "user-1",
      candidate: {
        name: "Enterprise Custom Stack Co",
        domain_guess: "enterprisecustom.com",
        careers_url_guess: "https://enterprisecustom.com/careers",
        discovery_level: 4,
        discovery_source: "manual",
        discovery_reason: "test fixture",
      },
      existingIndex,
      existingJobSourceUrls: new Set<string>(),
      priors: NEUTRAL_PRIORS,
      dryRun: false,
      remainingNewCompanySlots: 25,
      remainingNewSourceSlots: 10,
      atsResolver: fakeAtsResolver,
    });

    expect(fakeAtsResolver).toHaveBeenCalledTimes(1);
    expect(outcome.outcome).toBe("rejected");
    expect(outcome.reject_reason).toBe("no_supported_ats_evidence");
    expect(outcome.ats_resolution?.resolutionStatus).toBe("no_supported_ats_evidence");
    expect(outcome.job_source_action).toBeNull();
    expect(supabase.calls).toEqual([]);
    expect(mockFetchByPlatform).not.toHaveBeenCalled();
  });
});

describe("processCandidate — remote eligibility sampling", () => {
  it("prioritizes a US-remote job even when it appears after the first five ATS results", async () => {
    const buriedUsRemoteJob: NormJob = {
      external_id: "job-6",
      title: "Customer Success Manager",
      location: "Remote - US",
      description_html: "",
      description_text: "This is a Remote - US position. Must be based in the United States.",
      url: "https://boards.greenhouse.io/acme/jobs/6",
      posted_at: null,
      salary_min: 90000,
      salary_max: 110000,
      salary_estimated: false,
    };

    const firstFiveUnknown: NormJob[] = Array.from({ length: 5 }, (_, i) => ({
      external_id: `job-${i + 1}`,
      title: `Generic Role ${i + 1}`,
      location: "Office",
      description_html: "",
      description_text: "Join our growing team.",
      url: `https://boards.greenhouse.io/acme/jobs/${i + 1}`,
      posted_at: null,
      salary_min: 90000,
      salary_max: 110000,
      salary_estimated: false,
    }));

    mockFetchByPlatform.mockResolvedValue([
      ...firstFiveUnknown,
      buriedUsRemoteJob,
    ]);

    const supabase = createMockSupabase();
    const existingIndex = buildExistingCompanyIndex([]);

    const outcome = await processCandidate({
      supabase,
      userId: "user-1",
      candidate: {
        name: "Acme",
        domain_guess: "acme.com",
        careers_url_guess: "https://boards.greenhouse.io/acme",
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
      fetcher: mockFetchByPlatform,
    });

    expect(outcome.remote_eligibility_class).toBe("mixed_role_dependent");
    expect(outcome.outcome).toBe("would_create");
  });

  it("keeps a company unknown when no job contains US or remote eligibility evidence", async () => {
    const unknownJobs: NormJob[] = Array.from({ length: 8 }, (_, i) => ({
      external_id: `job-${i + 1}`,
      title: `Generic Role ${i + 1}`,
      location: "Office",
      description_html: "",
      description_text: "Join our growing team.",
      url: `https://boards.greenhouse.io/acme/jobs/${i + 1}`,
      posted_at: null,
      salary_min: 90000,
      salary_max: 110000,
      salary_estimated: false,
    }));

    mockFetchByPlatform.mockResolvedValue(unknownJobs);

    const supabase = createMockSupabase();
    const existingIndex = buildExistingCompanyIndex([]);

    const outcome = await processCandidate({
      supabase,
      userId: "user-1",
      candidate: {
        name: "Acme",
        domain_guess: "acme.com",
        careers_url_guess: "https://boards.greenhouse.io/acme",
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
      fetcher: mockFetchByPlatform,
    });

    expect(outcome.remote_eligibility_class).toBe("unknown");
  });
});
