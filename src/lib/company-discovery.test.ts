// ============================================================================
// Company Discovery Intelligence Layer — Phase 2 unit tests (pure logic).
//
// Covers the minimum test surface required by the Phase 2 authorization:
//   - Dedup:      same domain not inserted twice, same ATS tenant not
//                 inserted twice, capitalization normalizes correctly
//   - Eligibility: US-remote accepted, worldwide+US accepted, EU-only
//                 rejected, UK-only rejected, ambiguous remains unconfirmed
//   - ATS:        supported providers accepted, malformed input rejected,
//                 unsupported provider never treated as discovery-eligible
//   - Scoring:     new company gets neutral historical priors, a strong
//                 relevant employer scores higher than an irrelevant one,
//                 the opportunity score has no path to job-level scoring
//   - Discovery mix / expansion mode sanity checks
//
// Run with: bun run test  (vitest)
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  normalizeDomain,
  canonicalizeCareersUrl,
  normalizeCompanyName,
  buildExistingCompanyIndex,
  findExistingCompanyMatch,
  classifyRemoteEligibility,
  aggregateCompanyRemoteEligibility,
  isDiscoverySupportedAts,
  DISCOVERY_SUPPORTED_ATS,
  computeCompanyOpportunityScore,
  statusForOpportunityScore,
  evaluateRoleRelevance,
  NEUTRAL_PRIORS,
  DEFAULT_DISCOVERY_MIX,
  allocateDiscoveryBudget,
  evaluateExpansionMode,
  rebalanceForExpansion,
  enforceExplorationFloor,
  clampSafetyCaps,
  DISCOVERY_SAFETY_CAP_CEILINGS,
  type ExistingCompanyIndexEntry,
} from "./company-discovery";

// ----------------------------------------------------------------------------
// Normalization
// ----------------------------------------------------------------------------

describe("normalizeDomain", () => {
  it("strips protocol, www, and path", () => {
    expect(normalizeDomain("https://www.Acme.com/careers")).toBe("acme.com");
    expect(normalizeDomain("acme.com")).toBe("acme.com");
    expect(normalizeDomain("HTTP://ACME.COM")).toBe("acme.com");
  });

  it("returns null for empty/unparseable input", () => {
    expect(normalizeDomain(null)).toBeNull();
    expect(normalizeDomain(undefined)).toBeNull();
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("   ")).toBeNull();
  });
});

describe("normalizeCompanyName", () => {
  it("normalizes capitalization and strips common suffixes/punctuation", () => {
    expect(normalizeCompanyName("Acme, Inc.")).toBe("acme");
    expect(normalizeCompanyName("ACME INC")).toBe("acme");
    expect(normalizeCompanyName("Acme Corp.")).toBe("acme");
    expect(normalizeCompanyName("acme")).toBe("acme");
  });
});

// ----------------------------------------------------------------------------
// Dedup
// ----------------------------------------------------------------------------

describe("dedup: findExistingCompanyMatch", () => {
  const existing: ExistingCompanyIndexEntry[] = [
    {
      id: "company-1",
      domain: "acme.com",
      ats_provider: "Greenhouse",
      ats_company_slug: "acmeinc",
      careers_url: "https://boards.greenhouse.io/acmeinc",
      name: "Acme Inc",
    },
  ];
  const index = buildExistingCompanyIndex(existing);

  it("matches an exact-domain candidate and does not create a duplicate", () => {
    const result = findExistingCompanyMatch(
      { domain: "acme.com", name: "Acme (new listing)" },
      index
    );
    expect(result.matched?.id).toBe("company-1");
    expect(result.matchedBy).toBe("domain");
  });

  it("matches on domain even with different case/protocol/www (same company, not a duplicate)", () => {
    const result = findExistingCompanyMatch(
      { domain: "HTTPS://WWW.ACME.COM/jobs", name: "Acme" },
      index
    );
    expect(result.matched?.id).toBe("company-1");
    expect(result.matchedBy).toBe("domain");
  });

  it("matches on ATS provider+slug when domain differs (same tenant, not a duplicate)", () => {
    const result = findExistingCompanyMatch(
      {
        domain: "acme-careers.example.com", // deliberately different domain
        ats_provider: "greenhouse", // different case than stored value
        ats_company_slug: "ACMEINC", // different case than stored value
        name: "Acme",
      },
      index
    );
    expect(result.matched?.id).toBe("company-1");
    expect(result.matchedBy).toBe("ats_slug");
  });

  it("matches on canonical careers URL when domain/ats differ", () => {
    const result = findExistingCompanyMatch(
      {
        domain: "unrelated-domain.com",
        careers_url: "https://boards.greenhouse.io/acmeinc/",
        name: "Something Else",
      },
      index
    );
    expect(result.matched?.id).toBe("company-1");
    expect(result.matchedBy).toBe("careers_url");
  });

  it("falls back to normalized-name matching when capitalization/punctuation differ", () => {
    const result = findExistingCompanyMatch(
      { name: "ACME, INC." },
      index
    );
    expect(result.matched?.id).toBe("company-1");
    expect(result.matchedBy).toBe("name");
  });

  it("returns no match for a genuinely different company", () => {
    const result = findExistingCompanyMatch(
      {
        domain: "totallydifferent.com",
        ats_provider: "Lever",
        ats_company_slug: "totallydifferent",
        careers_url: "https://jobs.lever.co/totallydifferent",
        name: "Totally Different Co",
      },
      index
    );
    expect(result.matched).toBeNull();
    expect(result.matchedBy).toBeNull();
  });

  it("buildExistingCompanyIndex keeps only the first row per key (no duplicate index entries)", () => {
    const dupeRows: ExistingCompanyIndexEntry[] = [
      { id: "a", domain: "dupe.com", ats_provider: null, ats_company_slug: null, careers_url: null, name: "Dupe A" },
      { id: "b", domain: "dupe.com", ats_provider: null, ats_company_slug: null, careers_url: null, name: "Dupe B" },
    ];
    const idx = buildExistingCompanyIndex(dupeRows);
    expect(idx.byDomain.get("dupe.com")?.id).toBe("a");
    expect(idx.byDomain.size).toBe(1);
  });
});

// ----------------------------------------------------------------------------
// Eligibility
// ----------------------------------------------------------------------------

describe("classifyRemoteEligibility", () => {
  it("accepts explicit US-remote text", () => {
    const r = classifyRemoteEligibility("This is a Remote - US position. Must be based in the United States.");
    expect(r.eligibilityClass).toBe("us_confirmed");
    expect(r.confidence).toBe("high");
    expect(r.usEligibleConfirmed).toBe(true);
  });

  it("accepts worldwide/global text ONLY when paired with an explicit US-eligibility statement", () => {
    const r = classifyRemoteEligibility("Remote - Worldwide. Open to US applicants.");
    expect(r.eligibilityClass).toBe("global_us_eligible");
    expect(r.usEligibleConfirmed).toBe(true);
  });

  it("does NOT confirm eligibility for worldwide/global text with no explicit US statement", () => {
    const r = classifyRemoteEligibility("Remote - Worldwide. Work from anywhere in the world.");
    expect(r.usEligibleConfirmed).toBe(false);
    expect(r.eligibilityClass).toBe("unknown");
    expect(r.confidence).toBe("low");
  });

  it("rejects EU-only text", () => {
    const r = classifyRemoteEligibility("This role is EU-only. Candidates must be based in Europe.");
    expect(r.eligibilityClass).toBe("us_excluded");
    expect(r.usEligibleConfirmed).toBe(false);
    expect(r.confidence).toBe("high");
  });

  it("rejects UK-only text", () => {
    const r = classifyRemoteEligibility("Remote - UK only. Must be located in the United Kingdom.");
    expect(r.eligibilityClass).toBe("us_excluded");
    expect(r.usEligibleConfirmed).toBe(false);
  });

  it("leaves genuinely ambiguous text unconfirmed rather than guessing", () => {
    const r = classifyRemoteEligibility("Join our growing team and make an impact!");
    expect(r.eligibilityClass).toBe("unknown");
    expect(r.usEligibleConfirmed).toBe(false);
    expect(r.confidence).toBe("low");
  });

  it("marks role-dependent text as mixed/unconfirmed, not excluded", () => {
    const r = classifyRemoteEligibility("Eligibility varies by role — see the job posting for details.");
    expect(r.eligibilityClass).toBe("mixed_role_dependent");
    expect(r.usEligibleConfirmed).toBe(false);
  });

  it("exclusion patterns win even if US-sounding text appears elsewhere in the same blob", () => {
    const r = classifyRemoteEligibility(
      "We are a remote-first company. This specific requisition is EU-only and excludes the US."
    );
    expect(r.eligibilityClass).toBe("us_excluded");
    expect(r.usEligibleConfirmed).toBe(false);
  });
});

describe("aggregateCompanyRemoteEligibility", () => {
  it("does not permanently reject a company for one restricted role among otherwise-eligible roles", () => {
    const results = [
      classifyRemoteEligibility("Remote - US only."),
      classifyRemoteEligibility("Remote - US only."),
      classifyRemoteEligibility("This role is EU-only."),
    ];
    const agg = aggregateCompanyRemoteEligibility(results);
    expect(agg.shouldDeprioritize).toBe(false);
  });

  it("deprioritizes when checks are consistently non-US-eligible across the sample", () => {
    const results = [
      classifyRemoteEligibility("This role is EU-only."),
      classifyRemoteEligibility("Remote - UK only."),
      classifyRemoteEligibility("Canada-only position."),
    ];
    const agg = aggregateCompanyRemoteEligibility(results);
    expect(agg.shouldDeprioritize).toBe(true);
    expect(agg.companyClass).toBe("us_excluded");
  });

  it("returns unknown/low-confidence for an empty sample rather than guessing", () => {
    const agg = aggregateCompanyRemoteEligibility([]);
    expect(agg.companyClass).toBe("unknown");
    expect(agg.confidence).toBe("low");
    expect(agg.shouldDeprioritize).toBe(false);
  });
});

// ----------------------------------------------------------------------------
// ATS
// ----------------------------------------------------------------------------

describe("isDiscoverySupportedAts", () => {
  it("accepts the four supported ATS providers", () => {
    for (const p of DISCOVERY_SUPPORTED_ATS) {
      expect(isDiscoverySupportedAts(p)).toBe(true);
    }
  });

  it("rejects malformed/empty input", () => {
    expect(isDiscoverySupportedAts(null)).toBe(false);
    expect(isDiscoverySupportedAts(undefined)).toBe(false);
    expect(isDiscoverySupportedAts("")).toBe(false);
  });

  it("never treats an unsupported provider as discovery-eligible", () => {
    expect(isDiscoverySupportedAts("Workday")).toBe(false);
    expect(isDiscoverySupportedAts("Taleo")).toBe(false);
    expect(isDiscoverySupportedAts("iCIMS")).toBe(false);
    // Workable is a known SUPPORTED_ATS in scoring.ts (no fetcher exists yet)
    // but Company Scout's discovery set is intentionally narrower — confirms
    // Phase 2 did not silently widen the ATS surface.
    expect(isDiscoverySupportedAts("Workable")).toBe(false);
  });
});

// ----------------------------------------------------------------------------
// Scoring
// ----------------------------------------------------------------------------

describe("computeCompanyOpportunityScore", () => {
  it("uses population-median priors for a new company with no application history", () => {
    const result = computeCompanyOpportunityScore(
      {
        roleRelevance: null,
        remoteEligibility: null,
        compensationQualityRatio: null,
        eligibleJobCount: null,
        growthSignal: null,
        avgJobQuality: null,
        applicationCount: 0,
        responseCount: 0,
        interviewCount: 0,
        atsReliability: null,
        daysSinceLastJobSeen: null,
      },
      { medianAvgJobQuality: 72, medianResponseRate: 25, medianInterviewRate: 10 }
    );
    expect(result.usedNeutralPriorsFor).toContain("historicalJobQuality");
    expect(result.usedNeutralPriorsFor).toContain("responseRate");
    expect(result.usedNeutralPriorsFor).toContain("interviewConversion");
    // Confirms the supplied priors (not hardcoded neutral constants) were
    // actually used for the history-dependent factors.
    expect(result.breakdown.historicalJobQuality).toBeCloseTo(72 * 0.10, 5);
  });

  it("falls back to NEUTRAL_PRIORS when no priors argument is supplied", () => {
    const result = computeCompanyOpportunityScore({
      roleRelevance: null,
      remoteEligibility: null,
      compensationQualityRatio: null,
      eligibleJobCount: null,
      growthSignal: null,
      avgJobQuality: null,
      applicationCount: 0,
      responseCount: 0,
      interviewCount: 0,
      atsReliability: null,
      daysSinceLastJobSeen: null,
    });
    expect(result.breakdown.historicalJobQuality).toBeCloseTo(NEUTRAL_PRIORS.medianAvgJobQuality * 0.10, 5);
  });

  it("scores a strong, relevant, US-eligible employer higher than an irrelevant, excluded one", () => {
    const strongRelevantEmployer = computeCompanyOpportunityScore({
      roleRelevance: evaluateRoleRelevance([
        "Senior Business Analyst",
        "Customer Success Manager",
        "Operations Coordinator",
      ]),
      remoteEligibility: { eligibilityClass: "us_confirmed", confidence: "high" },
      compensationQualityRatio: 0.9,
      eligibleJobCount: 12,
      growthSignal: 80,
      avgJobQuality: 88,
      applicationCount: 10,
      responseCount: 4,
      interviewCount: 2,
      atsReliability: 95,
      daysSinceLastJobSeen: 1,
    });

    const weakIrrelevantEmployer = computeCompanyOpportunityScore({
      roleRelevance: evaluateRoleRelevance(["Senior Backend Engineer", "DevOps Lead"]),
      remoteEligibility: { eligibilityClass: "us_excluded", confidence: "high" },
      compensationQualityRatio: 0.1,
      eligibleJobCount: 0,
      growthSignal: 10,
      avgJobQuality: 30,
      applicationCount: 10,
      responseCount: 0,
      interviewCount: 0,
      atsReliability: 20,
      daysSinceLastJobSeen: 60,
    });

    expect(strongRelevantEmployer.score).toBeGreaterThan(weakIrrelevantEmployer.score);
  });

  it("never produces a score outside 0-100", () => {
    const result = computeCompanyOpportunityScore({
      roleRelevance: evaluateRoleRelevance(["Business Analyst"]),
      remoteEligibility: { eligibilityClass: "us_confirmed", confidence: "high" },
      compensationQualityRatio: 1,
      eligibleJobCount: 1000,
      growthSignal: 100,
      avgJobQuality: 100,
      applicationCount: 50,
      responseCount: 50,
      interviewCount: 50,
      atsReliability: 100,
      daysSinceLastJobSeen: 0,
    });
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("has no output field that touches job-level scoring — result shape is score/breakdown/usedNeutralPriorsFor only", () => {
    const result = computeCompanyOpportunityScore({
      roleRelevance: null,
      remoteEligibility: null,
      compensationQualityRatio: null,
      eligibleJobCount: null,
      growthSignal: null,
      avgJobQuality: null,
      applicationCount: 0,
      responseCount: 0,
      interviewCount: 0,
      atsReliability: null,
      daysSinceLastJobSeen: null,
    });
    expect(Object.keys(result).sort()).toEqual(["breakdown", "score", "usedNeutralPriorsFor"]);
  });
});

describe("statusForOpportunityScore", () => {
  it("maps score bands to the correct discovery status", () => {
    expect(statusForOpportunityScore(95, false)).toBe("HIGH_PRIORITY");
    expect(statusForOpportunityScore(80, false)).toBe("APPROVED");
    expect(statusForOpportunityScore(60, false)).toBe("WATCHLIST");
    expect(statusForOpportunityScore(10, false)).toBe("LOW_YIELD");
  });

  it("always returns INACTIVE for a US-excluded company regardless of score", () => {
    expect(statusForOpportunityScore(99, true)).toBe("INACTIVE");
  });
});

// ----------------------------------------------------------------------------
// Discovery mix / expansion mode / safety caps sanity
// ----------------------------------------------------------------------------

describe("allocateDiscoveryBudget", () => {
  it("allocates exactly totalSlots across the mix, correcting rounding drift", () => {
    for (const total of [1, 3, 7, 10, 37, 100]) {
      const alloc = allocateDiscoveryBudget(total, DEFAULT_DISCOVERY_MIX);
      const sum = Object.values(alloc).reduce((a, b) => a + b, 0);
      expect(sum).toBe(total);
    }
  });
});

describe("evaluateExpansionMode / rebalanceForExpansion / enforceExplorationFloor", () => {
  it("activates when top-5 concentration exceeds 30%", () => {
    const evalResult = evaluateExpansionMode({
      uniqueCompaniesDiscoveredLast7d: 10,
      uniqueCompaniesDiscoveredPrior7d: 10,
      topFiveCompanyShareOfEligibleJobs: 0.45,
      sourcingVolumeTrend: "flat",
    });
    expect(evalResult.active).toBe(true);
    expect(evalResult.reasons.length).toBeGreaterThan(0);
  });

  it("does not activate when signals are all healthy", () => {
    const evalResult = evaluateExpansionMode({
      uniqueCompaniesDiscoveredLast7d: 12,
      uniqueCompaniesDiscoveredPrior7d: 10,
      topFiveCompanyShareOfEligibleJobs: 0.15,
      sourcingVolumeTrend: "increasing",
    });
    expect(evalResult.active).toBe(false);
  });

  it("rebalanceForExpansion still sums to 1.0", () => {
    const rebalanced = rebalanceForExpansion(DEFAULT_DISCOVERY_MIX);
    const sum = Object.values(rebalanced).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 9);
  });

  it("enforceExplorationFloor guarantees at least the floor share, still summing to 1.0", () => {
    const skewed = { existingHighPerforming: 0.8, staleUnvisited: 0.1, newlyDiscovered: 0.05, similarityDerived: 0.03, randomExploration: 0.02 };
    const fixed = enforceExplorationFloor(skewed, 0.25);
    expect(fixed.newlyDiscovered + fixed.randomExploration).toBeGreaterThanOrEqual(0.25 - 1e-9);
    const sum = Object.values(fixed).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 9);
  });
});

describe("clampSafetyCaps", () => {
  it("never allows a caller to exceed the hard ceilings", () => {
    const clamped = clampSafetyCaps({
      maxCandidatesEvaluatedPerRun: 999999,
      maxNewCompaniesValidatedPerRun: 999999,
      maxNewJobSourcesPerRun: 999999,
    });
    expect(clamped.maxCandidatesEvaluatedPerRun).toBe(DISCOVERY_SAFETY_CAP_CEILINGS.maxCandidatesEvaluatedPerRun);
    expect(clamped.maxNewCompaniesValidatedPerRun).toBe(DISCOVERY_SAFETY_CAP_CEILINGS.maxNewCompaniesValidatedPerRun);
    expect(clamped.maxNewJobSourcesPerRun).toBe(DISCOVERY_SAFETY_CAP_CEILINGS.maxNewJobSourcesPerRun);
  });

  it("enforces a minimum of 1 even if a caller passes 0 or negative", () => {
    const clamped = clampSafetyCaps({ maxCandidatesEvaluatedPerRun: 0, maxNewCompaniesValidatedPerRun: -5 });
    expect(clamped.maxCandidatesEvaluatedPerRun).toBeGreaterThanOrEqual(1);
    expect(clamped.maxNewCompaniesValidatedPerRun).toBeGreaterThanOrEqual(1);
  });
});

// ----------------------------------------------------------------------------
// Role relevance
// ----------------------------------------------------------------------------

describe("evaluateRoleRelevance", () => {
  it("flags an employer hiring into production role categories as relevant", () => {
    const r = evaluateRoleRelevance(["Business Analyst", "Software Engineer", "Customer Success Manager"]);
    expect(r.relevant).toBe(true);
    expect(r.matchedCategories).toContain("Business Analyst");
    expect(r.matchedCategories).toContain("Customer Success");
  });

  it("flags an employer with no matching postings as not relevant", () => {
    const r = evaluateRoleRelevance(["Senior Backend Engineer", "iOS Developer", "Sales Executive"]);
    expect(r.relevant).toBe(false);
    expect(r.matchedCategories).toEqual([]);
  });

  it("returns not-relevant for an empty sample rather than throwing", () => {
    const r = evaluateRoleRelevance([]);
    expect(r.relevant).toBe(false);
    expect(r.matchRate).toBe(0);
  });
});
