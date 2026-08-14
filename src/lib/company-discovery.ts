// ============================================================================
// Company Discovery Intelligence Layer — Phase 2: Company Scout (pure logic)
//
// No DB access, no auth, no network calls in this file — everything here is a
// deterministic, unit-testable function. Server orchestration (Supabase reads/
// writes, HTTP validation calls) lives in company-discovery.functions.ts. AI-
// assisted candidate generation lives in company-discovery-ai.ts, kept
// separate per the "AI only where it adds value" requirement — nothing in
// this file calls an LLM.
//
// This module NEVER touches AUTO_THRESHOLDS, evaluateAutoReview(), scoring.ts,
// or any job-level decision. Its only output is a 0-100 *company* opportunity
// score used for SOURCING PRIORITIZATION — it has no path to job-level Auto
// Apply logic.
// ============================================================================

import type { SupportedAts } from "./ats-detect";

// ----------------------------------------------------------------------------
// Discovery lifecycle status — mirrors the company_discovery_status enum
// added in Phase 1 (supabase/migrations/20260814032621_...). Kept as a
// TypeScript union here (not re-derived from generated types.ts, since the
// Phase 1 migration hasn't been applied to the live Supabase project yet —
// see the note at the top of company-discovery.functions.ts).
// ----------------------------------------------------------------------------
export type CompanyDiscoveryStatus =
  | "NEW" | "DISCOVERED" | "VALIDATING" | "APPROVED" | "HIGH_PRIORITY"
  | "WATCHLIST" | "LOW_YIELD" | "COOLDOWN" | "BLOCKED" | "INACTIVE";

export type DiscoverySourceTag = "seed" | "ats_pattern" | "similarity" | "manual" | "random_exploration";

export type ExpansionLevel = 1 | 2 | 3 | 4 | 5 | 6;

// ----------------------------------------------------------------------------
// Safety caps (point 24). Configurable — these are defaults, the orchestrator
// accepts overrides via its input schema, clamped to these ceilings so a
// caller can tighten but never loosen them past the hard ceiling below.
// ----------------------------------------------------------------------------
export const DISCOVERY_SAFETY_CAP_CEILINGS = {
  maxCandidatesEvaluatedPerRun: 100,
  maxNewCompaniesValidatedPerRun: 25,
  maxNewJobSourcesPerRun: 10,
} as const;

export const DEFAULT_DISCOVERY_SAFETY_CAPS = {
  maxCandidatesEvaluatedPerRun: 100,
  maxNewCompaniesValidatedPerRun: 25,
  maxNewJobSourcesPerRun: 10,
} as const;

export interface SafetyCapOverrides {
  maxCandidatesEvaluatedPerRun?: number;
  maxNewCompaniesValidatedPerRun?: number;
  maxNewJobSourcesPerRun?: number;
}

// NOTE: input is deliberately typed as plain optional `number`s, NOT derived
// from `typeof DEFAULT_DISCOVERY_SAFETY_CAPS` (which — because that object is
// declared `as const` — would narrow each field to its single literal default
// value, e.g. `100 | undefined` instead of `number | undefined`. That would
// reject any real caller-supplied override, including the zod-validated
// `data.max_candidates_evaluated` the orchestrator passes in.)
export function clampSafetyCaps(input: SafetyCapOverrides) {
  return {
    maxCandidatesEvaluatedPerRun: Math.max(
      1,
      Math.min(
        input.maxCandidatesEvaluatedPerRun ?? DEFAULT_DISCOVERY_SAFETY_CAPS.maxCandidatesEvaluatedPerRun,
        DISCOVERY_SAFETY_CAP_CEILINGS.maxCandidatesEvaluatedPerRun
      )
    ),
    maxNewCompaniesValidatedPerRun: Math.max(
      1,
      Math.min(
        input.maxNewCompaniesValidatedPerRun ?? DEFAULT_DISCOVERY_SAFETY_CAPS.maxNewCompaniesValidatedPerRun,
        DISCOVERY_SAFETY_CAP_CEILINGS.maxNewCompaniesValidatedPerRun
      )
    ),
    maxNewJobSourcesPerRun: Math.max(
      1,
      Math.min(
        input.maxNewJobSourcesPerRun ?? DEFAULT_DISCOVERY_SAFETY_CAPS.maxNewJobSourcesPerRun,
        DISCOVERY_SAFETY_CAP_CEILINGS.maxNewJobSourcesPerRun
      )
    ),
  };
}

// ----------------------------------------------------------------------------
// Source refresh priority (point 14) — how often a company should be
// rechecked based on its current discovery_status.
// ----------------------------------------------------------------------------
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const REFRESH_INTERVAL_MS: Record<CompanyDiscoveryStatus, number> = {
  HIGH_PRIORITY: 18 * HOUR,     // 12-24h band, midpoint
  APPROVED: 2 * DAY,            // 1-3 day band, midpoint
  DISCOVERED: 2 * DAY,
  VALIDATING: 2 * DAY,
  WATCHLIST: 5 * DAY,           // 3-7 day band, midpoint
  LOW_YIELD: 14 * DAY,
  COOLDOWN: 3 * DAY,
  BLOCKED: 30 * DAY,            // effectively never auto-revisited; human-gated anyway
  INACTIVE: 30 * DAY,
  NEW: 0,                       // never checked yet — always eligible for a first check
};

export function isStaleForRefresh(
  status: CompanyDiscoveryStatus,
  lastCheckedAt: string | null,
  nowMs: number
): boolean {
  if (!lastCheckedAt) return true;
  const interval = REFRESH_INTERVAL_MS[status] ?? DAY;
  return nowMs - new Date(lastCheckedAt).getTime() >= interval;
}

// ----------------------------------------------------------------------------
// Normalization (point 6 / point 7) — deterministic, no AI.
// ----------------------------------------------------------------------------

/** Lowercased, protocol/www-stripped, path-stripped host. Returns null if unparseable. */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let raw = input.trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
  host = host.replace(/^www\./, "");
  return host || null;
}

/** Canonical careers URL for dedup comparison: lowercased host+path, no trailing slash, no query/hash. */
export function canonicalizeCareersUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    return `${host}${path}`.toLowerCase();
  } catch {
    return null;
  }
}

/** Normalized company name for fallback dedup matching (point 7.4): lowercase, strip punctuation/suffixes. */
export function normalizeCompanyName(name: string | null | undefined): string | null {
  if (!name) return null;
  const cleaned = name
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\b(inc|incorporated|corp|corporation|co|ltd|llc|plc|gmbh|sa|ag)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return cleaned || null;
}

// ----------------------------------------------------------------------------
// Deduplication (point 7) — check order: domain → ATS provider+slug →
// canonical careers URL → normalized name. Pure matching against an
// in-memory index the orchestrator builds once per run (avoids N queries).
// ----------------------------------------------------------------------------

export interface ExistingCompanyIndexEntry {
  id: string;
  domain: string | null;
  ats_provider: string | null;
  ats_company_slug: string | null;
  careers_url: string | null;
  name: string;
}

export interface ExistingCompanyIndex {
  byDomain: Map<string, ExistingCompanyIndexEntry>;
  byAtsSlug: Map<string, ExistingCompanyIndexEntry>;      // key: `${provider}::${slug}`
  byCareersUrl: Map<string, ExistingCompanyIndexEntry>;
  byName: Map<string, ExistingCompanyIndexEntry>;
}

export function buildExistingCompanyIndex(rows: ExistingCompanyIndexEntry[]): ExistingCompanyIndex {
  const byDomain = new Map<string, ExistingCompanyIndexEntry>();
  const byAtsSlug = new Map<string, ExistingCompanyIndexEntry>();
  const byCareersUrl = new Map<string, ExistingCompanyIndexEntry>();
  const byName = new Map<string, ExistingCompanyIndexEntry>();

  for (const row of rows) {
    const d = normalizeDomain(row.domain);
    if (d && !byDomain.has(d)) byDomain.set(d, row);

    if (row.ats_provider && row.ats_company_slug) {
      const k = `${row.ats_provider.toLowerCase()}::${row.ats_company_slug.toLowerCase()}`;
      if (!byAtsSlug.has(k)) byAtsSlug.set(k, row);
    }

    const cu = canonicalizeCareersUrl(row.careers_url);
    if (cu && !byCareersUrl.has(cu)) byCareersUrl.set(cu, row);

    const n = normalizeCompanyName(row.name);
    if (n && !byName.has(n)) byName.set(n, row);
  }

  return { byDomain, byAtsSlug, byCareersUrl, byName };
}

export interface CandidateForDedupe {
  domain?: string | null;
  ats_provider?: string | null;
  ats_company_slug?: string | null;
  careers_url?: string | null;
  name: string;
}

export type DedupeMatchReason = "domain" | "ats_slug" | "careers_url" | "name" | null;

export interface DedupeMatchResult {
  matched: ExistingCompanyIndexEntry | null;
  matchedBy: DedupeMatchReason;
}

/** Returns the first match found, checked in the exact priority order Phase 2 requires. */
export function findExistingCompanyMatch(
  candidate: CandidateForDedupe,
  index: ExistingCompanyIndex
): DedupeMatchResult {
  const d = normalizeDomain(candidate.domain);
  if (d) {
    const hit = index.byDomain.get(d);
    if (hit) return { matched: hit, matchedBy: "domain" };
  }

  if (candidate.ats_provider && candidate.ats_company_slug) {
    const k = `${candidate.ats_provider.toLowerCase()}::${candidate.ats_company_slug.toLowerCase()}`;
    const hit = index.byAtsSlug.get(k);
    if (hit) return { matched: hit, matchedBy: "ats_slug" };
  }

  const cu = canonicalizeCareersUrl(candidate.careers_url);
  if (cu) {
    const hit = index.byCareersUrl.get(cu);
    if (hit) return { matched: hit, matchedBy: "careers_url" };
  }

  const n = normalizeCompanyName(candidate.name);
  if (n) {
    const hit = index.byName.get(n);
    if (hit) return { matched: hit, matchedBy: "name" };
  }

  return { matched: null, matchedBy: null };
}

// ----------------------------------------------------------------------------
// U.S.-remote eligibility classification (point 9 / point 19 / point 26).
// Deterministic, regex-based — no AI. The AI fallback (company-discovery-ai.ts)
// is only ever consulted when this returns "unknown" with low confidence, and
// even then, only a HIGH-confidence result (from either path) may set a
// us_remote_allowed=true style boolean. This function only classifies; it
// does not decide company approval on its own.
// ----------------------------------------------------------------------------

export type RemoteEligibilityClass =
  | "us_confirmed"           // explicit "Remote - US" / "must be based in the United States" etc.
  | "global_us_eligible"     // worldwide/global AND an explicit US-eligibility statement
  | "north_america"          // "Remote - North America" / "US and Canada"
  | "mixed_role_dependent"   // some text suggests it varies by role — treat as unconfirmed for scoring, non-excluding
  | "us_excluded"            // explicit non-US-only restriction (EU only, UK only, etc.)
  | "unknown";                // no clear signal either way

export interface RemoteEligibilityResult {
  eligibilityClass: RemoteEligibilityClass;
  confidence: "high" | "medium" | "low";
  evidence: string[];
  /**
   * True ONLY when eligibilityClass confirms a path for a US-located worker
   * AND confidence is "high". This is the single source of truth other code
   * should read — never branch on eligibilityClass alone for a yes/no
   * decision, since "low-confidence... must NOT be treated as confirmed".
   */
  usEligibleConfirmed: boolean;
}

const US_EXCLUDE_PATTERNS: RegExp[] = [
  /\b(eu|europe|european union)\s*[- ]?\s*(only|based|residents?)\b/i,
  /\bmust be (based|located|resident)\s+in\s+(the\s+)?(eu|europe|uk|united kingdom|canada|australia)\b/i,
  /\bremote\s*[-–—:]?\s*(uk|united kingdom)\s*(only)?\b/i,
  /\b(no|not)\s+(open|available|eligible)\s+(to|for)\s+(us|u\.s\.|united states)\s*(applicants|candidates|residents)?\b/i,
  /\bexcludes?\s+(the\s+)?(us|u\.s\.|united states)\b/i,
  /\bcanada\s*[- ]?\s*only\b/i,
  /\bapac\s*[- ]?\s*only\b/i,
  /\bindia\s*[- ]?\s*only\b/i,
];

const US_CONFIRM_PATTERNS: RegExp[] = [
  /\bremote\s*[-–—:]?\s*(us|u\.s\.|usa|united states)\b/i,
  /\bmust be (based|located)\s+in\s+(the\s+)?(us|u\.s\.|united states)\b/i,
  /\bauthorized to work in the (us|u\.s\.|united states)\b/i,
  /\bus[- ]based\s*(only|required)?\b/i,
  /\b(open|available)\s+to\s+(us|u\.s\.|united states)\s*(applicants|candidates|residents)?\b/i,
];

const NORTH_AMERICA_PATTERNS: RegExp[] = [
  /\bremote\s*[-–—:]?\s*(north america|na)\b/i,
  /\b(us|u\.s\.)\s+(and|or|\/)\s+canada\b/i,
  /\bcanada\s+(and|or|\/)\s+(us|u\.s\.)\b/i,
];

const GLOBAL_PATTERNS: RegExp[] = [
  /\bremote\s*[-–—:]?\s*(worldwide|global|anywhere)\b/i,
  /\bwork from anywhere\b/i,
];

const ROLE_DEPENDENT_PATTERNS: RegExp[] = [
  /\bdepend(s|ing)?\s+on\s+(the\s+)?role\b/i,
  /\bvaries\s+by\s+(role|location|position)\b/i,
  /\bsee\s+(the\s+)?(job|role|posting)\s+for\s+eligib\w*\s+location/i,
];

export function classifyRemoteEligibility(text: string | null | undefined): RemoteEligibilityResult {
  const blob = (text ?? "").toLowerCase();

  // Exclusion patterns win first — an explicit "EU only" should never be
  // overridden by an unrelated "remote" mention elsewhere in the same text.
  for (const re of US_EXCLUDE_PATTERNS) {
    if (re.test(blob)) {
      return {
        eligibilityClass: "us_excluded",
        confidence: "high",
        evidence: [re.source],
        usEligibleConfirmed: false,
      };
    }
  }

  const usConfirmHit = US_CONFIRM_PATTERNS.find((re) => re.test(blob));
  const globalHit = GLOBAL_PATTERNS.find((re) => re.test(blob));

  if (usConfirmHit && globalHit) {
    return {
      eligibilityClass: "global_us_eligible",
      confidence: "high",
      evidence: [usConfirmHit.source, globalHit.source],
      usEligibleConfirmed: true,
    };
  }
  if (usConfirmHit) {
    return {
      eligibilityClass: "us_confirmed",
      confidence: "high",
      evidence: [usConfirmHit.source],
      usEligibleConfirmed: true,
    };
  }

  const naHit = NORTH_AMERICA_PATTERNS.find((re) => re.test(blob));
  if (naHit) {
    return {
      eligibilityClass: "north_america",
      confidence: "high",
      evidence: [naHit.source],
      usEligibleConfirmed: true,
    };
  }

  // Global/worldwide with NO explicit US statement: per spec, a company being
  // globally distributed does NOT automatically confirm US eligibility.
  if (globalHit) {
    return {
      eligibilityClass: "unknown",
      confidence: "low",
      evidence: [globalHit.source, "worldwide/global with no explicit US-eligibility statement"],
      usEligibleConfirmed: false,
    };
  }

  const roleDepHit = ROLE_DEPENDENT_PATTERNS.find((re) => re.test(blob));
  if (roleDepHit) {
    return {
      eligibilityClass: "mixed_role_dependent",
      confidence: "medium",
      evidence: [roleDepHit.source],
      usEligibleConfirmed: false,
    };
  }

  return {
    eligibilityClass: "unknown",
    confidence: "low",
    evidence: [],
    usEligibleConfirmed: false,
  };
}

/**
 * Aggregates several per-job eligibility reads into one company-level signal.
 * A company is not permanently rejected because one role is geo-restricted
 * (point 9) — but a source is deprioritized when checks are CONSISTENTLY
 * non-US-eligible across the sample.
 */
export function aggregateCompanyRemoteEligibility(
  perJobResults: RemoteEligibilityResult[]
): { companyClass: RemoteEligibilityClass; confidence: "high" | "medium" | "low"; shouldDeprioritize: boolean } {
  if (perJobResults.length === 0) {
    return { companyClass: "unknown", confidence: "low", shouldDeprioritize: false };
  }
  const confirmedCount = perJobResults.filter((r) => r.usEligibleConfirmed).length;
  const excludedCount = perJobResults.filter((r) => r.eligibilityClass === "us_excluded").length;

  if (confirmedCount > 0) {
    // At least one confirmed-eligible role exists — company is not rejected,
    // even if other roles sampled were excluded (mixed/role-dependent reality).
    const allConfirmed = confirmedCount === perJobResults.length;
    return {
      companyClass: allConfirmed ? perJobResults[0].eligibilityClass : "mixed_role_dependent",
      confidence: allConfirmed ? "high" : "medium",
      shouldDeprioritize: false,
    };
  }
  if (excludedCount === perJobResults.length) {
    // Every sampled role was consistently non-US-eligible.
    return { companyClass: "us_excluded", confidence: "high", shouldDeprioritize: true };
  }
  return { companyClass: "unknown", confidence: "low", shouldDeprioritize: false };
}

// ----------------------------------------------------------------------------
// Role-relevance analysis (point 10). Broad keyword matching against the 18
// production role categories — deliberately separate from ingest.functions.ts's
// private inferRoleCategory() (which assigns ONE category to a single job title
// for storage). This is a discovery-time RELEVANCE filter over a sample of an
// employer's postings, answering "does this employer hire into our categories
// at all", not "what is this exact job's category".
// ----------------------------------------------------------------------------

export const PRODUCTION_ROLE_CATEGORIES = [
  "Data Analyst", "Business Analyst", "Operations Analyst", "Operations",
  "Customer Success", "Customer Support", "Technical Support", "Support Operations",
  "Product Operations", "Project Management", "Program Coordination", "Operations Coordination",
  "SaaS Operations", "Technical Operations", "Product Analyst", "Implementation",
  "Customer Experience", "Business Operations",
] as const;

const ROLE_KEYWORDS: Record<(typeof PRODUCTION_ROLE_CATEGORIES)[number], RegExp> = {
  "Data Analyst": /\bdata\s+analyst\b/i,
  "Business Analyst": /\bbusiness\s+analyst\b/i,
  "Operations Analyst": /\boperations?\s+analyst\b/i,
  "Operations": /\boperations?\b/i,
  "Customer Success": /\bcustomer\s+success\b/i,
  "Customer Support": /\bcustomer\s+support\b/i,
  "Technical Support": /\btechnical\s+support\b/i,
  "Support Operations": /\bsupport\s+operations?\b/i,
  "Product Operations": /\bproduct\s+operations?\b/i,
  "Project Management": /\bproject\s+manage(r|ment)\b/i,
  "Program Coordination": /\bprogram\s+coordinat/i,
  "Operations Coordination": /\boperations?\s+coordinat/i,
  "SaaS Operations": /\bsaas\s+operations?\b/i,
  "Technical Operations": /\btechnical\s+operations?\b/i,
  "Product Analyst": /\bproduct\s+analyst\b/i,
  "Implementation": /\bimplementation\b/i,
  "Customer Experience": /\bcustomer\s+experience\b/i,
  "Business Operations": /\bbusiness\s+operations?\b/i,
};

export interface RoleRelevanceResult {
  relevant: boolean;
  matchedCategories: string[];
  matchRate: number; // fraction of sampled titles that matched at least one category
}

export function evaluateRoleRelevance(jobTitles: string[]): RoleRelevanceResult {
  if (jobTitles.length === 0) return { relevant: false, matchedCategories: [], matchRate: 0 };

  const matched = new Set<string>();
  let matchingTitles = 0;
  for (const title of jobTitles) {
    let titleMatched = false;
    for (const category of PRODUCTION_ROLE_CATEGORIES) {
      if (ROLE_KEYWORDS[category].test(title)) {
        matched.add(category);
        titleMatched = true;
      }
    }
    if (titleMatched) matchingTitles++;
  }
  const matchRate = matchingTitles / jobTitles.length;
  return {
    relevant: matched.size > 0,
    matchedCategories: Array.from(matched),
    matchRate,
  };
}

// ----------------------------------------------------------------------------
// ATS validation (point 8 / point 26).
// ----------------------------------------------------------------------------

export const DISCOVERY_SUPPORTED_ATS: SupportedAts[] = ["Greenhouse", "Lever", "Ashby", "Breezy"];

export function isDiscoverySupportedAts(platform: string | null | undefined): platform is SupportedAts {
  return !!platform && (DISCOVERY_SUPPORTED_ATS as string[]).includes(platform);
}

// ----------------------------------------------------------------------------
// Company Opportunity Score (point 11). 0-100, cold-start-safe. Uses the
// ACTUAL Phase 1 companies columns (see supabase/migrations/20260814032621_...).
// This score is for SOURCING PRIORITIZATION ONLY — it has no path into
// job-level Auto Apply thresholds.
// ----------------------------------------------------------------------------

export interface OpportunityScoreInputs {
  // 20% — relevant role availability
  roleRelevance: RoleRelevanceResult | null;
  // 15% — US-remote compatibility
  remoteEligibility: { eligibilityClass: RemoteEligibilityClass; confidence: "high" | "medium" | "low" } | null;
  // 15% — compensation quality: fraction of sampled postings meeting/exceeding SALARY_FLOOR (0-1), or null if unknown
  compensationQualityRatio: number | null;
  // 10% — hiring activity: eligible_job_count on the company row
  eligibleJobCount: number | null;
  // 10% — growth signal: 0-100 if available (from AI/company size trend), else null for neutral prior
  growthSignal: number | null;
  // 10% — historical CommandFlow job quality: avg_job_quality column
  avgJobQuality: number | null;
  applicationCount: number; // companies.application_count — gates whether history-dependent factors are trusted
  // 5% — response rate: response_count / application_count
  responseCount: number;
  // 5% — interview conversion: interview_count / application_count
  interviewCount: number;
  // 5% — ATS/source reliability: 0-100, e.g. from ats_source_performance view; null → neutral
  atsReliability: number | null;
  // 5% — career page freshness: days since last_job_seen_at; null → neutral
  daysSinceLastJobSeen: number | null;
}

export interface PopulationPriors {
  medianAvgJobQuality: number;   // 0-100
  medianResponseRate: number;    // 0-100 (as a percentage, not a fraction)
  medianInterviewRate: number;   // 0-100
}

export const NEUTRAL_PRIORS: PopulationPriors = {
  medianAvgJobQuality: 65,
  medianResponseRate: 20,
  medianInterviewRate: 8,
};

const OPPORTUNITY_WEIGHTS = {
  roleAvailability: 0.20,
  usRemoteCompat: 0.15,
  compensationQuality: 0.15,
  hiringActivity: 0.10,
  companyGrowth: 0.10,
  historicalJobQuality: 0.10,
  responseRate: 0.05,
  interviewConversion: 0.05,
  atsReliability: 0.05,
  careerPageFreshness: 0.05,
} as const;

// Sanity check the weights sum to 1.0 — a unit test asserts this too, but
// failing loudly here at import time catches a future edit immediately.
const _weightSum = Object.values(OPPORTUNITY_WEIGHTS).reduce((a, b) => a + b, 0);
if (Math.abs(_weightSum - 1) > 1e-9) {
  throw new Error(`OPPORTUNITY_WEIGHTS must sum to 1.0, got ${_weightSum}`);
}

export interface OpportunityScoreResult {
  score: number; // 0-100
  breakdown: Record<keyof typeof OPPORTUNITY_WEIGHTS, number>;
  usedNeutralPriorsFor: string[]; // which factors fell back to population medians (cold-start)
}

const HISTORY_MIN_APPLICATIONS = 3;

export function computeCompanyOpportunityScore(
  i: OpportunityScoreInputs,
  priors: PopulationPriors = NEUTRAL_PRIORS
): OpportunityScoreResult {
  const usedNeutralPriorsFor: string[] = [];
  const clamp = (n: number) => Math.max(0, Math.min(100, n));

  const roleAvailability = i.roleRelevance
    ? clamp(i.roleRelevance.matchRate * 100)
    : (usedNeutralPriorsFor.push("roleAvailability"), 40);

  const usRemoteCompat = (() => {
    if (!i.remoteEligibility) { usedNeutralPriorsFor.push("usRemoteCompat"); return 40; }
    const { eligibilityClass, confidence } = i.remoteEligibility;
    if (eligibilityClass === "us_excluded") return 0;
    if (confidence !== "high") { usedNeutralPriorsFor.push("usRemoteCompat"); return 40; }
    if (eligibilityClass === "us_confirmed") return 100;
    if (eligibilityClass === "global_us_eligible") return 90;
    if (eligibilityClass === "north_america") return 80;
    if (eligibilityClass === "mixed_role_dependent") return 50;
    usedNeutralPriorsFor.push("usRemoteCompat");
    return 40;
  })();

  const compensationQuality = i.compensationQualityRatio != null
    ? clamp(i.compensationQualityRatio * 100)
    : (usedNeutralPriorsFor.push("compensationQuality"), 50);

  const hiringActivity = i.eligibleJobCount != null
    ? clamp(Math.log2(i.eligibleJobCount + 1) * 25) // diminishing returns; 1 job≈25, 3≈50, 7≈75, 15+≈100
    : (usedNeutralPriorsFor.push("hiringActivity"), 40);

  const companyGrowth = i.growthSignal != null
    ? clamp(i.growthSignal)
    : (usedNeutralPriorsFor.push("companyGrowth"), 50);

  const hasHistory = i.applicationCount >= HISTORY_MIN_APPLICATIONS;

  const historicalJobQuality = hasHistory && i.avgJobQuality != null
    ? clamp(i.avgJobQuality)
    : (usedNeutralPriorsFor.push("historicalJobQuality"), priors.medianAvgJobQuality);

  const responseRate = hasHistory
    ? clamp((i.responseCount / i.applicationCount) * 100)
    : (usedNeutralPriorsFor.push("responseRate"), priors.medianResponseRate);

  const interviewConversion = hasHistory
    ? clamp((i.interviewCount / i.applicationCount) * 100)
    : (usedNeutralPriorsFor.push("interviewConversion"), priors.medianInterviewRate);

  const atsReliability = i.atsReliability != null
    ? clamp(i.atsReliability)
    : (usedNeutralPriorsFor.push("atsReliability"), 70); // neutral-high: only 4 known-good ATS are ever discovery-eligible

  const careerPageFreshness = i.daysSinceLastJobSeen != null
    ? clamp(100 - i.daysSinceLastJobSeen * 3) // fresh (0d)=100, ~33d=0
    : (usedNeutralPriorsFor.push("careerPageFreshness"), 50);

  const breakdown = {
    roleAvailability: roleAvailability * OPPORTUNITY_WEIGHTS.roleAvailability,
    usRemoteCompat: usRemoteCompat * OPPORTUNITY_WEIGHTS.usRemoteCompat,
    compensationQuality: compensationQuality * OPPORTUNITY_WEIGHTS.compensationQuality,
    hiringActivity: hiringActivity * OPPORTUNITY_WEIGHTS.hiringActivity,
    companyGrowth: companyGrowth * OPPORTUNITY_WEIGHTS.companyGrowth,
    historicalJobQuality: historicalJobQuality * OPPORTUNITY_WEIGHTS.historicalJobQuality,
    responseRate: responseRate * OPPORTUNITY_WEIGHTS.responseRate,
    interviewConversion: interviewConversion * OPPORTUNITY_WEIGHTS.interviewConversion,
    atsReliability: atsReliability * OPPORTUNITY_WEIGHTS.atsReliability,
    careerPageFreshness: careerPageFreshness * OPPORTUNITY_WEIGHTS.careerPageFreshness,
  };

  const score = clamp(Object.values(breakdown).reduce((a, b) => a + b, 0));
  return { score: Math.round(score * 100) / 100, breakdown, usedNeutralPriorsFor };
}

/** Maps a score to a discovery_status band — used after scoring, before dedup/upsert. */
export function statusForOpportunityScore(score: number, usExcluded: boolean): CompanyDiscoveryStatus {
  if (usExcluded) return "INACTIVE";
  if (score >= 90) return "HIGH_PRIORITY";
  if (score >= 75) return "APPROVED";
  if (score >= 55) return "WATCHLIST";
  return "LOW_YIELD";
}

// ----------------------------------------------------------------------------
// Exploration vs. exploitation — DISCOVERY ONLY (point 15). This allocates
// where Company Scout spends discovery effort. It has no output that reaches
// Auto Apply / application selection.
// ----------------------------------------------------------------------------

export interface DiscoveryMixShares {
  existingHighPerforming: number;
  staleUnvisited: number;
  newlyDiscovered: number;
  similarityDerived: number;
  randomExploration: number;
}

export const DEFAULT_DISCOVERY_MIX: DiscoveryMixShares = {
  existingHighPerforming: 0.30,
  staleUnvisited: 0.25,
  newlyDiscovered: 0.25,
  similarityDerived: 0.10,
  randomExploration: 0.10,
};

const _mixSum = Object.values(DEFAULT_DISCOVERY_MIX).reduce((a, b) => a + b, 0);
if (Math.abs(_mixSum - 1) > 1e-9) {
  throw new Error(`DEFAULT_DISCOVERY_MIX must sum to 1.0, got ${_mixSum}`);
}

export function allocateDiscoveryBudget(totalSlots: number, mix: DiscoveryMixShares = DEFAULT_DISCOVERY_MIX) {
  const raw = {
    existingHighPerforming: Math.round(totalSlots * mix.existingHighPerforming),
    staleUnvisited: Math.round(totalSlots * mix.staleUnvisited),
    newlyDiscovered: Math.round(totalSlots * mix.newlyDiscovered),
    similarityDerived: Math.round(totalSlots * mix.similarityDerived),
    randomExploration: Math.round(totalSlots * mix.randomExploration),
  };
  // Rounding can drift the total by ±1-2; reconcile against newlyDiscovered
  // (the largest flexible bucket) so the sum exactly equals totalSlots.
  const drift = totalSlots - Object.values(raw).reduce((a, b) => a + b, 0);
  raw.newlyDiscovered = Math.max(0, raw.newlyDiscovered + drift);
  return raw;
}

// ----------------------------------------------------------------------------
// Expansion Mode — DISCOVERY ONLY (point 16). Must never weaken job quality,
// salary, remote-eligibility, or safety thresholds — this function only ever
// returns a discovery-mix rebalance, never touches those constants.
// ----------------------------------------------------------------------------

export interface ExpansionModeSignals {
  uniqueCompaniesDiscoveredLast7d: number;
  uniqueCompaniesDiscoveredPrior7d: number; // the 7d window before that, for trend comparison
  topFiveCompanyShareOfEligibleJobs: number; // 0-1
  sourcingVolumeTrend: "increasing" | "flat" | "declining";
}

export interface ExpansionModeEvaluation {
  active: boolean;
  reasons: string[];
}

export function evaluateExpansionMode(signals: ExpansionModeSignals): ExpansionModeEvaluation {
  const reasons: string[] = [];
  if (signals.topFiveCompanyShareOfEligibleJobs > 0.30) {
    reasons.push(
      `Top-5 companies account for ${(signals.topFiveCompanyShareOfEligibleJobs * 100).toFixed(0)}% of eligible jobs (>30% threshold)`
    );
  }
  if (signals.uniqueCompaniesDiscoveredLast7d < signals.uniqueCompaniesDiscoveredPrior7d) {
    reasons.push(
      `Unique companies discovered fell from ${signals.uniqueCompaniesDiscoveredPrior7d} to ${signals.uniqueCompaniesDiscoveredLast7d} week-over-week`
    );
  }
  if (signals.sourcingVolumeTrend === "declining") {
    reasons.push("Sourcing volume trend is declining");
  }
  return { active: reasons.length > 0, reasons };
}

/** Shifts effort toward exploration when Expansion Mode is active — discovery mix only. */
export function rebalanceForExpansion(mix: DiscoveryMixShares = DEFAULT_DISCOVERY_MIX): DiscoveryMixShares {
  const rebalanced: DiscoveryMixShares = {
    existingHighPerforming: mix.existingHighPerforming * 0.6,
    staleUnvisited: mix.staleUnvisited * 1.1,
    newlyDiscovered: mix.newlyDiscovered * 1.3,
    similarityDerived: mix.similarityDerived * 1.2,
    randomExploration: mix.randomExploration * 1.4,
  };
  const total = Object.values(rebalanced).reduce((a, b) => a + b, 0);
  return {
    existingHighPerforming: rebalanced.existingHighPerforming / total,
    staleUnvisited: rebalanced.staleUnvisited / total,
    newlyDiscovered: rebalanced.newlyDiscovered / total,
    similarityDerived: rebalanced.similarityDerived / total,
    randomExploration: rebalanced.randomExploration / total,
  };
}

/** Enforces the ≥25% exploration floor from the reconciled architecture. */
export function enforceExplorationFloor(mix: DiscoveryMixShares, floor = 0.25): DiscoveryMixShares {
  const explorationShare = mix.newlyDiscovered + mix.randomExploration;
  if (explorationShare >= floor) return mix;
  const deficit = floor - explorationShare;
  const takeFromExisting = Math.min(mix.existingHighPerforming, deficit);
  return {
    ...mix,
    existingHighPerforming: mix.existingHighPerforming - takeFromExisting,
    newlyDiscovered: mix.newlyDiscovered + takeFromExisting,
  };
}
