// ============================================================================
// Company Discovery Intelligence Layer — Phase 2: Company Scout orchestrator.
//
// KNOWN LIMITATION / TODO (see Phase 2 report "Known limitations"): the Phase 1
// schema migration (supabase/migrations/20260814032621_...) has not yet been
// applied to the live Supabase project, so src/integrations/supabase/types.ts
// (generated via `supabase gen types`) does not yet include the new columns/
// tables this file reads and writes (companies.discovery_status,
// companies.company_opportunity_score, company_similarity, discovery_runs,
// etc). Exactly like the existing codebase already does in several places
// (e.g. ingest.functions.ts's `(settings as any)?.relaxed_mode`, `category:
// "saas" as any`), this file uses `as any` at the Supabase call sites that
// touch those new objects. Once Phase 1 is applied to the live project, run
// `supabase gen types typescript` to regenerate types.ts and these casts can
// be narrowed/removed — no runtime behavior changes when that happens.
//
// SCOPE: Company Scout discovers, validates, scores, and (when not dry-run
// and under safety caps) upserts companies + job_sources. It NEVER touches
// applications, never calls evaluateAutoReview()/AUTO_THRESHOLDS, never
// imports jobs itself (importJobsNow in ingest.functions.ts is untouched and
// unaware this file exists), and never submits anything.
// ============================================================================

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { detectAts, type SupportedAts } from "./ats-detect";
import { fetchByPlatform, type NormJob } from "./ingest.functions";
import { computeTrustScore, SALARY_FLOOR } from "./scoring";
import {
  resolveCompanyAts,
  buildDefaultAtsResolverDeps,
  type AtsResolutionResult,
  type ResolveCompanyAtsInput,
} from "./ats-resolver";
import {
  type CompanyDiscoveryStatus,
  type ExpansionLevel,
  DEFAULT_DISCOVERY_SAFETY_CAPS,
  clampSafetyCaps,
  isStaleForRefresh,
  normalizeDomain,
  canonicalizeCareersUrl,
  normalizeCompanyName,
  buildExistingCompanyIndex,
  findExistingCompanyMatch,
  type ExistingCompanyIndexEntry,
  classifyRemoteEligibility,
  aggregateCompanyRemoteEligibility,
  evaluateRoleRelevance,
  isProductionRoleTitle,
  isDiscoverySupportedAts,
  computeCompanyOpportunityScore,
  statusForOpportunityScore,
  type PopulationPriors,
  NEUTRAL_PRIORS,
  allocateDiscoveryBudget,
  evaluateExpansionMode,
  rebalanceForExpansion,
  enforceExplorationFloor,
  DEFAULT_DISCOVERY_MIX,
} from "./company-discovery";
import { generateCandidateCompanies, generateSimilarCompanies } from "./company-discovery-ai";

// ----------------------------------------------------------------------------
// Per-candidate result shape returned to the caller (dry-run preview AND live
// run summary use the same shape — dry-run just never actually mutates).
// ----------------------------------------------------------------------------
// Exported for unit testing (company-discovery.functions.test.ts) — lets tests
// exercise the real pipeline logic against a hand-built mock Supabase client
// without going through the createServerFn/HTTP/auth-middleware machinery.
export interface CandidateOutcome {
  name: string;
  domain: string | null;
  careers_url: string | null;
  ats_provider: string | null;
  discovery_level: ExpansionLevel | null;
  stage_reached: string;
  outcome: "would_create" | "would_update" | "created" | "updated" | "refreshed" | "rejected" | "error";
  discovery_status: CompanyDiscoveryStatus | null;
  opportunity_score: number | null;
  opportunity_breakdown?: Record<string, number> | null;
  opportunity_neutral_priors?: string[] | null;
  remote_eligibility_class: string | null;
  matched_existing_company_id: string | null;
  matched_by: string | null;
  job_source_action: "would_add" | "would_update" | "added" | "updated" | "skipped" | null;
  reject_reason: string | null;
  error: string | null;
  ats_resolution?: AtsResolutionResult | null;
}

interface ScoutRunResult {
  run_id: string;
  dry_run: boolean;
  levels_run: ExpansionLevel[];
  safety_caps: ReturnType<typeof clampSafetyCaps>;
  discovery_mix_used: typeof DEFAULT_DISCOVERY_MIX;
  expansion_mode: { active: boolean; reasons: string[] };
  companies_evaluated: number;
  companies_discovered: number;   // new candidates surfaced (levels 2-6)
  companies_validated: number;    // reached APPROVED or HIGH_PRIORITY
  companies_rejected: number;
  sources_added: number;
  sources_refreshed: number;
  errors: Array<{ candidate: string; stage: string; message: string }>;
  candidates: CandidateOutcome[];
  duration_ms: number;
}

const RunScoutInput = z.object({
  dry_run: z.boolean().default(true),
  levels: z.array(z.number().int().min(1).max(6)).optional(),
  ats_provider: z.enum(["Greenhouse", "Lever", "Ashby", "Breezy"]).optional(),
  max_candidates_evaluated: z.number().int().min(1).max(100).optional(),
  max_new_companies_validated: z.number().int().min(1).max(25).optional(),
  max_new_job_sources: z.number().int().min(1).max(10).optional(),
});

const SAMPLE_JOBS_PER_CANDIDATE = 5;

function dedupeRawCandidates<T extends {
  name: string;
  domain_guess: string | null;
  careers_url_guess: string | null;
}>(items: T[]): T[] {
  const seenDomains = new Set<string>();
  const seenUrls = new Set<string>();
  const seenNames = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const domain = normalizeDomain(item.domain_guess);
    const url = canonicalizeCareersUrl(item.careers_url_guess);
    const name = normalizeCompanyName(item.name);

    const duplicate =
      (domain != null && seenDomains.has(domain)) ||
      (url != null && seenUrls.has(url)) ||
      (name != null && seenNames.has(name));

    if (duplicate) continue;

    if (domain) seenDomains.add(domain);
    if (url) seenUrls.add(url);
    if (name) seenNames.add(name);

    result.push(item);
  }

  return result;
}

function remoteEligibilitySampleScore(job: NormJob): number {
  // Sampling should be location-first. Full job descriptions frequently
  // contain US legal/pay/equal-opportunity boilerplate even for roles whose
  // actual location is Italy, India, Germany, etc.
  const location = `${job.location ?? ""}`.toLowerCase();
  const description = `${job.description_text ?? ""}`.toLowerCase();

  let score = 0;

  // Strongest evidence: the posting's structured/display location itself.
  if (/\bremote\b/.test(location)) score += 5;

  if (/\b(united states|u\.s\.|usa|us-based|u\.s\.-based)\b/i.test(location)) {
    score += 12;
  }

  if (/\bnorth america\b/i.test(location)) {
    score += 10;
  }

  if (/\bremote[-,\s]*(us|usa|united states)\b/i.test(location)) {
    score += 15;
  }

  // Global/worldwide location wording can be useful, but is weaker than
  // explicit US/North-America evidence.
  if (/\b(worldwide|global)\b/i.test(location)) {
    score += 4;
  }

  // Description evidence is deliberately weak. It can break ties but cannot
  // overpower an explicitly foreign structured location.
  const explicitlyForeignLocation =
    /\b(italy|india|germany|ireland|spain|france|brazil|mexico|australia|united kingdom|uk|uae|ksa|austria|netherlands|poland|japan)\b/i.test(
      location
    ) &&
    !/\b(united states|u\.s\.|usa|north america)\b/i.test(location);

  if (!explicitlyForeignLocation) {
    if (/\bremote\b/i.test(description)) score += 1;
    if (/\bnorth america\b/i.test(description)) score += 2;
    if (
      /\b(remote[-,\s]*(us|usa|united states)|must be based in the united states|us-based|u\.s\.-based)\b/i.test(
        description
      )
    ) {
      score += 3;
    }
  }

  return score;
}

function selectRemoteEligibilitySample(
  jobs: NormJob[],
  limit = SAMPLE_JOBS_PER_CANDIDATE
): NormJob[] {
  return [...jobs]
    .map((job, index) => ({
      job,
      index,
      score: remoteEligibilitySampleScore(job),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((x) => x.job);
}

/**
 * Company-level remote evidence should inspect the complete ATS feed.
 *
 * This does NOT weaken job-level eligibility. It only answers whether the
 * employer has at least one explicitly confirmed US-compatible hiring path.
 *
 * Individual jobs must still pass their own eligibility checks before
 * application / Auto Apply.
 */
function analyzeCompanyRemoteEligibility(jobs: NormJob[]) {
  const results = jobs.map((job) =>
    classifyRemoteEligibility(
      `${job.location ?? ""} ${job.description_text ?? ""}`
    )
  );

  return aggregateCompanyRemoteEligibility(results);
}

// ----------------------------------------------------------------------------
// Population priors — cold-start-safe medians from the user's own history.
// Falls back to NEUTRAL_PRIORS when there isn't enough data yet.
// ----------------------------------------------------------------------------
function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function computePopulationPriors(supabase: any, userId: string): Promise<PopulationPriors> {
  const { data } = await supabase
    .from("companies")
    .select("avg_job_quality, response_count, interview_count, application_count")
    .eq("user_id", userId)
    .gte("application_count", 3);
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return NEUTRAL_PRIORS;

  const qualities = rows.map((r) => r.avg_job_quality).filter((v) => v != null);
  const responseRates = rows.map((r) => (r.response_count / r.application_count) * 100);
  const interviewRates = rows.map((r) => (r.interview_count / r.application_count) * 100);

  return {
    medianAvgJobQuality: median(qualities) ?? NEUTRAL_PRIORS.medianAvgJobQuality,
    medianResponseRate: median(responseRates) ?? NEUTRAL_PRIORS.medianResponseRate,
    medianInterviewRate: median(interviewRates) ?? NEUTRAL_PRIORS.medianInterviewRate,
  };
}

// ----------------------------------------------------------------------------
// Candidate processing pipeline (DISCOVERY already happened by the time this
// runs — this function is NORMALIZATION through JOB_SOURCE UPSERT for one
// candidate). Wrapped by the caller in try/catch for failure isolation.
//
// Exported for unit testing (company-discovery.functions.test.ts) — lets
// tests exercise the real pipeline logic against a hand-built mock Supabase
// client without going through the createServerFn/HTTP/auth-middleware
// machinery.
// ----------------------------------------------------------------------------
export async function processCandidate(params: {
  supabase: any;
  userId: string;
  candidate: {
    name: string;
    domain_guess: string | null;
    careers_url_guess: string | null;
    discovery_level: ExpansionLevel;
    discovery_source: string;
    discovery_reason: string;
    ats_provider_guess?: string | null;
    ats_url_guess?: string | null;
    ats_slug_guess?: string | null;
  };
  existingIndex: ReturnType<typeof buildExistingCompanyIndex>;
  existingJobSourceUrls: Set<string>;
  priors: PopulationPriors;
  dryRun: boolean;
  remainingNewCompanySlots: number;
  remainingNewSourceSlots: number;
  fetcher?: typeof fetchByPlatform;
  atsResolver?: (input: ResolveCompanyAtsInput) => Promise<AtsResolutionResult>;
}): Promise<CandidateOutcome> {
  const { supabase, userId, candidate, existingIndex, existingJobSourceUrls, priors, dryRun } = params;
  const fetcher = params.fetcher ?? fetchByPlatform;

  const outcome: CandidateOutcome = {
    name: candidate.name,
    domain: null,
    careers_url: null,
    ats_provider: null,
    discovery_level: candidate.discovery_level,
    stage_reached: "normalization",
    outcome: "rejected",
    discovery_status: null,
    opportunity_score: null,
    remote_eligibility_class: null,
    matched_existing_company_id: null,
    matched_by: null,
    job_source_action: null,
    reject_reason: null,
    error: null,
  };

  // ---- NORMALIZATION ----
  const domain = normalizeDomain(candidate.domain_guess);
  let careersUrl = candidate.careers_url_guess?.trim() || null;
  outcome.domain = domain;
  outcome.careers_url = careersUrl;

  if (!careersUrl) {
    outcome.stage_reached = "domain_validation";
    outcome.reject_reason = "no_careers_url_candidate";
    return outcome;
  }

  // ---- DOMAIN VALIDATION + ATS DETECTION ----
  outcome.stage_reached = "ats_detection";
  let det = detectAts(careersUrl);

  if (!det.supported || !det.slug || !isDiscoverySupportedAts(det.platform)) {
    if (det.platform === "Unknown") {
      outcome.stage_reached = "ats_resolution";

      const resolveAts =
        params.atsResolver ??
        ((resolverInput: ResolveCompanyAtsInput) =>
          resolveCompanyAts(
            resolverInput,
            buildDefaultAtsResolverDeps({
              supabase,
              userId,
              apiKey: process.env.OPENAI_API_KEY ?? null,
            })
          ));

      const resolution = await resolveAts({
        companyName: candidate.name,
        domain,
        careersUrl,
        aiGuess: {
          ats_provider_guess: candidate.ats_provider_guess ?? null,
          ats_url_guess: candidate.ats_url_guess ?? null,
          ats_slug_guess: candidate.ats_slug_guess ?? null,
        },
      });

      outcome.ats_resolution = resolution;

      if (
        resolution.resolved &&
        resolution.provider &&
        resolution.slug &&
        resolution.careersUrl
      ) {
        det = {
          supported: true,
          platform: resolution.provider,
          slug: resolution.slug,
        };
        careersUrl = resolution.careersUrl;
        outcome.careers_url = careersUrl;
      } else {
        // Preserve the resolver's more specific finding (Phase 2.6 v2.2)
        // rather than always reporting the generic "Unknown" it started
        // from: a recognized-but-unsupported ATS keeps the specific
        // provider name; a careers page that redirected to a dead end, or
        // one that was fetched but showed no ATS evidence at all, gets its
        // own honest reject reason instead of being lumped in with every
        // other Unknown.
        outcome.reject_reason =
          resolution.resolutionStatus === "unsupported_provider"
            ? `unsupported_ats:${resolution.detectedUnsupportedProvider ?? det.platform}`
            : resolution.resolutionStatus === "stale_or_inactive_company"
            ? "stale_or_inactive_company"
            : resolution.resolutionStatus === "no_supported_ats_evidence"
            ? "no_supported_ats_evidence"
            : `unsupported_ats:${det.platform}`;
        return outcome;
      }
    } else {
      outcome.reject_reason = `unsupported_ats:${det.platform}`;
      return outcome;
    }
  }

  outcome.ats_provider = det.platform;
  const atsSlug: string = det.slug!;

  // Live-fetch a sample of postings — doubles as "career endpoint responds
  // correctly" validation (point 8) and the data source for remote-eligibility
  // + role-relevance analysis.
  let jobs: NormJob[] = [];
  try {
    jobs = await fetcher(det.platform as SupportedAts, atsSlug);
  } catch (e: any) {
    outcome.stage_reached = "domain_validation";
    outcome.reject_reason = `endpoint_unreachable: ${(e?.message || String(e)).slice(0, 160)}`;
    return outcome;
  }
  if (jobs.length === 0) {
    outcome.stage_reached = "domain_validation";
    outcome.reject_reason = "endpoint_returned_zero_jobs";
    return outcome;
  }

  const sample = selectRemoteEligibilitySample(jobs);

  // ---- REMOTE-ELIGIBILITY ANALYSIS ----
  outcome.stage_reached = "remote_eligibility";
  // Company-level eligibility scans the complete ATS feed so a valid
  // US hiring path is not missed merely because it fell outside the small
  // prioritized sample.
  const aggregate = analyzeCompanyRemoteEligibility(jobs);
  outcome.remote_eligibility_class = aggregate.companyClass;
  const usExcluded = aggregate.companyClass === "us_excluded";
  const companyUsRemoteCapable =
    aggregate.confidence === "high" &&
    (
      aggregate.companyClass === "us_confirmed" ||
      aggregate.companyClass === "global_us_eligible" ||
      aggregate.companyClass === "north_america" ||
      aggregate.companyClass === "mixed_role_dependent"
    );

  // ---- ROLE-RELEVANCE ANALYSIS ----
  outcome.stage_reached = "role_relevance";
  const roleRelevance = evaluateRoleRelevance(jobs.map((j) => j.title));

  // ---- COMPANY OPPORTUNITY SCORING ----
  outcome.stage_reached = "opportunity_scoring";
  // Compensation is evaluated only across jobs that:
  //   1. match CommandFlow's target role categories, and
  //   2. expose usable salary information.
  //
  // Remote-eligibility sampling is intentionally separate; a five-job remote
  // evidence sample should not determine company compensation quality.
  const relevantSalaryJobs = jobs.filter(
    (j) =>
      isProductionRoleTitle(j.title) &&
      j.salary_min != null
  );

  const compensationHits = relevantSalaryJobs.filter(
    (j) => (j.salary_min ?? 0) >= SALARY_FLOOR
  ).length;
  const scoreResult = computeCompanyOpportunityScore(
    {
      roleRelevance,
      remoteEligibility: { eligibilityClass: aggregate.companyClass, confidence: aggregate.confidence },
      compensationQualityRatio:
        relevantSalaryJobs.length
          ? compensationHits / relevantSalaryJobs.length
          : null,
      // Hiring activity should represent opportunities relevant to the
      // CommandFlow target-role universe, not the employer's entire ATS feed.
      eligibleJobCount: roleRelevance.matchedJobCount,
      growthSignal: null, // neutral prior — no AI growth-signal call in this phase; see Known Limitations
      avgJobQuality: null,
      applicationCount: 0, // brand-new candidate — always cold-start
      responseCount: 0,
      interviewCount: 0,
      atsReliability: null,
      daysSinceLastJobSeen: 0,
    },
    priors
  );
  outcome.opportunity_score = scoreResult.score;
  outcome.opportunity_breakdown = scoreResult.breakdown;
  outcome.opportunity_neutral_priors = scoreResult.usedNeutralPriorsFor;
  const discoveryStatus = statusForOpportunityScore(scoreResult.score, usExcluded);
  outcome.discovery_status = discoveryStatus;

  // ---- DEDUPLICATION ----
  outcome.stage_reached = "deduplication";
  const match = findExistingCompanyMatch(
    { domain, ats_provider: det.platform, ats_company_slug: atsSlug, careers_url: careersUrl, name: candidate.name },
    existingIndex
  );
  if (match.matched) {
    outcome.matched_existing_company_id = match.matched.id;
    outcome.matched_by = match.matchedBy;
  }

  // ---- COMPANY UPSERT ----
  outcome.stage_reached = "company_upsert";
  const isNewCompany = !match.matched;
  if (isNewCompany && params.remainingNewCompanySlots <= 0) {
    outcome.reject_reason = "max_new_companies_validated_per_run_reached";
    return outcome;
  }

  const trust = computeTrustScore({
    has_official_site: !!domain,
    has_careers_page: true,
    has_linkedin: false,
    ats_domain_match: true,
    business_footprint_score: 50,
    news_signals_count: 0,
    description: candidate.discovery_reason,
  });

  const companyPayload: Record<string, unknown> = {
    ats_provider: det.platform,
    ats_company_slug: atsSlug,
    us_remote_allowed: companyUsRemoteCapable,
    global_remote_allowed:
      aggregate.confidence === "high" &&
      aggregate.companyClass === "global_us_eligible",
    north_america_remote_allowed:
      aggregate.confidence === "high" &&
      aggregate.companyClass === "north_america",
    career_page_active: true,
    last_job_seen_at: new Date().toISOString(),
    last_checked_at: new Date().toISOString(),
    eligible_job_count: roleRelevance.matchedJobCount,
    company_opportunity_score: scoreResult.score,
    discovery_status: discoveryStatus,
    discovery_source: candidate.discovery_source,
    discovery_reason: candidate.discovery_reason,
  };

  if (dryRun) {
    outcome.outcome = isNewCompany ? "would_create" : "would_update";
  } else if (isNewCompany) {
    const { data: co, error } = await supabase
      .from("companies")
      .insert({
        user_id: userId,
        name: candidate.name,
        domain,
        careers_url: careersUrl,
        trust_score: trust.score,
        verification_status: trust.decision,
        red_flags: trust.red_flags,
        has_linkedin: false,
        hiring_activity: Math.round(scoreResult.breakdown.hiringActivity / 0.10),
        first_discovered_at: new Date().toISOString(),
        ...companyPayload,
      } as any)
      .select("id")
      .single();
    if (error) {
      outcome.error = error.message;
      outcome.outcome = "error";
      return outcome;
    }
    outcome.matched_existing_company_id = co?.id ?? null;
    outcome.outcome = "created";
  } else {
    const { error } = await supabase
      .from("companies")
      .update(companyPayload as any)
      .eq("id", match.matched!.id);
    if (error) {
      outcome.error = error.message;
      outcome.outcome = "error";
      return outcome;
    }
    outcome.outcome = "updated";
  }

  // ---- JOB_SOURCE UPSERT ----
  // Only for validated, non-excluded, sufficiently-strong companies, and only
  // when caps allow. INACTIVE (us_excluded) or LOW_YIELD companies are
  // recorded in `companies` (so we don't keep re-discovering them every run)
  // but never become an active job_sources row.
  const eligibleForSourcing = discoveryStatus === "APPROVED" || discoveryStatus === "HIGH_PRIORITY";
  if (!eligibleForSourcing) {
    outcome.job_source_action = "skipped";
    return outcome;
  }

  const canonicalUrl = canonicalizeCareersUrl(careersUrl);
  const sourceAlreadyExists = canonicalUrl ? existingJobSourceUrls.has(canonicalUrl) : false;

  if (!sourceAlreadyExists && params.remainingNewSourceSlots <= 0) {
    outcome.job_source_action = "skipped"; // company still validated/scored; just not sourced THIS run
    return outcome;
  }

  outcome.stage_reached = "job_source_upsert";
  if (dryRun) {
    outcome.job_source_action = sourceAlreadyExists ? "would_update" : "would_add";
    return outcome;
  }

  if (sourceAlreadyExists) {
    await supabase
      .from("job_sources")
      .update({ status: "active", ats: det.platform })
      .eq("user_id", userId)
      .eq("careers_url", careersUrl);
    outcome.job_source_action = "updated";
  } else {
    const { error: srcErr } = await supabase.from("job_sources").insert({
      user_id: userId,
      name: candidate.name,
      careers_url: careersUrl,
      ats: det.platform,
      status: "active",
      notes: `Discovered by Company Scout · level ${candidate.discovery_level} · ${candidate.discovery_source} · ${new Date().toISOString().slice(0, 10)}`,
    } as any);
    if (srcErr) {
      outcome.error = srcErr.message;
    } else {
      outcome.job_source_action = "added";
      existingJobSourceUrls.add(canonicalUrl!);
    }
  }

  return outcome;
}

// ----------------------------------------------------------------------------
// Level 1 — refresh an existing, stale, already-approved-or-watchlisted
// company. Cheaper than the full new-candidate pipeline: reuses the
// company's own careers_url, re-samples postings, recomputes eligibility/
// relevance/score, and updates the row (or previews the update if dry-run).
//
// Exported for unit testing (company-discovery.functions.test.ts), same
// rationale as processCandidate above.
// ----------------------------------------------------------------------------
export async function refreshExistingCompany(params: {
  supabase: any;
  userId: string;
  company: any; // full companies row
  priors: PopulationPriors;
  dryRun: boolean;
  fetcher?: typeof fetchByPlatform;
}): Promise<CandidateOutcome> {
  const { supabase, userId, company, priors, dryRun } = params;
  const fetcher = params.fetcher ?? fetchByPlatform;
  const outcome: CandidateOutcome = {
    name: company.name,
    domain: company.domain ?? null,
    careers_url: company.careers_url ?? null,
    ats_provider: company.ats_provider ?? null,
    discovery_level: 1,
    stage_reached: "domain_validation",
    outcome: "rejected",
    discovery_status: company.discovery_status ?? null,
    opportunity_score: company.company_opportunity_score ?? null,
    remote_eligibility_class: null,
    matched_existing_company_id: company.id,
    matched_by: "existing_refresh",
    job_source_action: null,
    reject_reason: null,
    error: null,
  };

  if (!company.careers_url) {
    outcome.reject_reason = "no_careers_url_on_existing_row";
    return outcome;
  }
  const det = detectAts(company.careers_url);
  if (!det.supported || !det.slug || !isDiscoverySupportedAts(det.platform)) {
    outcome.reject_reason = `unsupported_ats:${det.platform}`;
    return outcome;
  }
  outcome.ats_provider = det.platform;

  let jobs: NormJob[] = [];
  try {
    jobs = await fetcher(det.platform as SupportedAts, det.slug);
  } catch (e: any) {
    outcome.reject_reason = `endpoint_unreachable: ${(e?.message || String(e)).slice(0, 160)}`;
    return outcome;
  }

  const sample = selectRemoteEligibilitySample(jobs);
  // Refresh path uses the same full-feed company-level evidence scan.
  const aggregate = analyzeCompanyRemoteEligibility(jobs);
  outcome.remote_eligibility_class = aggregate.companyClass;
  const usExcluded = aggregate.companyClass === "us_excluded";
  const companyUsRemoteCapable =
    aggregate.confidence === "high" &&
    (
      aggregate.companyClass === "us_confirmed" ||
      aggregate.companyClass === "global_us_eligible" ||
      aggregate.companyClass === "north_america" ||
      aggregate.companyClass === "mixed_role_dependent"
    );
  const roleRelevance = evaluateRoleRelevance(jobs.map((j) => j.title));
  // Compensation is evaluated only across jobs that:
  //   1. match CommandFlow's target role categories, and
  //   2. expose usable salary information.
  //
  // Remote-eligibility sampling is intentionally separate; a five-job remote
  // evidence sample should not determine company compensation quality.
  const relevantSalaryJobs = jobs.filter(
    (j) =>
      isProductionRoleTitle(j.title) &&
      j.salary_min != null
  );

  const compensationHits = relevantSalaryJobs.filter(
    (j) => (j.salary_min ?? 0) >= SALARY_FLOOR
  ).length;

  const scoreResult = computeCompanyOpportunityScore(
    {
      roleRelevance,
      remoteEligibility: { eligibilityClass: aggregate.companyClass, confidence: aggregate.confidence },
      compensationQualityRatio:
        relevantSalaryJobs.length
          ? compensationHits / relevantSalaryJobs.length
          : null,
      // Hiring activity should represent opportunities relevant to the
      // CommandFlow target-role universe, not the employer's entire ATS feed.
      eligibleJobCount: roleRelevance.matchedJobCount,
      growthSignal: null,
      avgJobQuality: company.avg_job_quality ?? null,
      applicationCount: company.application_count ?? 0,
      responseCount: company.response_count ?? 0,
      interviewCount: company.interview_count ?? 0,
      atsReliability: null,
      daysSinceLastJobSeen: 0,
    },
    priors
  );
  outcome.opportunity_score = scoreResult.score;
  outcome.opportunity_breakdown = scoreResult.breakdown;
  outcome.opportunity_neutral_priors = scoreResult.usedNeutralPriorsFor;
  const discoveryStatus = statusForOpportunityScore(scoreResult.score, usExcluded);
  outcome.discovery_status = discoveryStatus;

  const updatePayload = {
    eligible_job_count: roleRelevance.matchedJobCount,
    company_opportunity_score: scoreResult.score,
    discovery_status: discoveryStatus,
    us_remote_allowed: companyUsRemoteCapable,
    global_remote_allowed:
      aggregate.confidence === "high" &&
      aggregate.companyClass === "global_us_eligible",
    north_america_remote_allowed:
      aggregate.confidence === "high" &&
      aggregate.companyClass === "north_america",
    last_checked_at: new Date().toISOString(),
    last_job_seen_at: jobs.length > 0 ? new Date().toISOString() : company.last_job_seen_at,
  };

  if (dryRun) {
    outcome.outcome = "would_update";
    return outcome;
  }

  const { error } = await supabase.from("companies").update(updatePayload as any).eq("id", company.id);
  if (error) {
    outcome.error = error.message;
    outcome.outcome = "error";
    return outcome;
  }
  outcome.outcome = "refreshed";
  return outcome;
}

// ----------------------------------------------------------------------------
// Main orchestrator.
// ----------------------------------------------------------------------------
export const runCompanyScout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => RunScoutInput.parse(d))
  .handler(async ({ data, context }): Promise<ScoutRunResult> => {
    const { supabase, userId } = context;
    const startedAt = Date.now();
    const dryRun = data.dry_run;
    const caps = clampSafetyCaps({
      maxCandidatesEvaluatedPerRun: data.max_candidates_evaluated,
      maxNewCompaniesValidatedPerRun: data.max_new_companies_validated,
      maxNewJobSourcesPerRun: data.max_new_job_sources,
    });

    console.log(`[company-scout] run started · dry_run=${dryRun} · caps=${JSON.stringify(caps)}`);

    const errors: ScoutRunResult["errors"] = [];
    const candidateOutcomes: CandidateOutcome[] = [];

    // ---- Load context needed across the whole run ----
    const [{ data: existingCompaniesRaw }, { data: existingSourcesRaw }] = await Promise.all([
      supabase
        .from("companies")
        .select("id, name, domain, careers_url, ats_provider, ats_company_slug, discovery_status, last_checked_at, company_opportunity_score, avg_job_quality, application_count, response_count, interview_count")
        .eq("user_id", userId),
      supabase.from("job_sources").select("careers_url").eq("user_id", userId),
    ]);
    const existingCompanies = (existingCompaniesRaw ?? []) as any[];
    const existingIndex = buildExistingCompanyIndex(
      existingCompanies.map(
        (c): ExistingCompanyIndexEntry => ({
          id: c.id,
          domain: c.domain,
          ats_provider: c.ats_provider ?? null,
          ats_company_slug: c.ats_company_slug ?? null,
          careers_url: c.careers_url,
          name: c.name,
        })
      )
    );
    const existingJobSourceUrls = new Set(
      ((existingSourcesRaw ?? []) as any[])
        .map((s) => canonicalizeCareersUrl(s.careers_url))
        .filter((v): v is string => !!v)
    );

    const priors = await computePopulationPriors(supabase, userId);

    // ---- Expansion Mode evaluation (discovery-only; see company-discovery.ts) ----
    const staleApprovedCount = existingCompanies.filter(
      (c) => (c.discovery_status === "APPROVED" || c.discovery_status === "HIGH_PRIORITY") &&
        isStaleForRefresh(c.discovery_status, c.last_checked_at, Date.now())
    ).length;
    const expansionSignals = {
      uniqueCompaniesDiscoveredLast7d: existingCompanies.filter(
        (c) => c.discovery_status && new Date(c.last_checked_at ?? 0).getTime() > Date.now() - 7 * 86400000
      ).length,
      uniqueCompaniesDiscoveredPrior7d: 0, // no historical snapshot to compare against yet in Phase 2 — see Known Limitations
      topFiveCompanyShareOfEligibleJobs: 0, // requires job-level company attribution history; not computed in Phase 2 — see Known Limitations
      sourcingVolumeTrend: staleApprovedCount > 5 ? ("declining" as const) : ("flat" as const),
    };
    const expansionEval = evaluateExpansionMode(expansionSignals);
    let mix = expansionEval.active ? rebalanceForExpansion(DEFAULT_DISCOVERY_MIX) : DEFAULT_DISCOVERY_MIX;
    mix = enforceExplorationFloor(mix);

    // Best-effort: record Expansion Mode state on user_settings (informational
    // only — nothing in Phase 2 or earlier phases reads this to change
    // application behavior; that wiring is explicitly out of scope here).
    try {
      await supabase
        .from("user_settings")
        .update({
          expansion_mode_active: expansionEval.active,
          expansion_mode_triggered_at: expansionEval.active ? new Date().toISOString() : null,
        } as any)
        .eq("user_id", userId);
    } catch {
      /* best-effort */
    }

    const budget = allocateDiscoveryBudget(caps.maxCandidatesEvaluatedPerRun, mix);
    const levelsRequested = data.levels as ExpansionLevel[] | undefined;

    let remainingCandidateBudget = caps.maxCandidatesEvaluatedPerRun;
    let remainingNewCompanySlots = caps.maxNewCompaniesValidatedPerRun;
    let remainingNewSourceSlots = caps.maxNewJobSourcesPerRun;
    let sourcesAdded = 0;
    let sourcesRefreshed = 0;
    const levelsRun = new Set<ExpansionLevel>();

    // ---- LEVEL 1 — refresh existing approved/high-priority/watchlist companies ----
    if (!levelsRequested || levelsRequested.includes(1)) {
      const staleCompanies = existingCompanies
        .filter(
          (c) =>
            ["APPROVED", "HIGH_PRIORITY", "WATCHLIST", "LOW_YIELD"].includes(c.discovery_status) &&
            isStaleForRefresh(c.discovery_status, c.last_checked_at, Date.now())
        )
        .slice(0, Math.min(budget.existingHighPerforming + budget.staleUnvisited, remainingCandidateBudget));

      for (const company of staleCompanies) {
        if (remainingCandidateBudget <= 0) break;
        levelsRun.add(1);
        try {
          const result = await refreshExistingCompany({ supabase, userId, company, priors, dryRun });
          candidateOutcomes.push(result);
          if (result.outcome === "refreshed") sourcesRefreshed++;
        } catch (e: any) {
          errors.push({ candidate: company.name, stage: "level1_refresh", message: (e?.message || String(e)).slice(0, 300) });
        }
        remainingCandidateBudget--;
      }
    }

    // ---- Gather AI-suggested new candidates for levels 2/4/5/6, and level 3 (similarity) ----
    const apiKey = process.env.OPENAI_API_KEY;
    const newCandidateSlots = Math.min(
      budget.newlyDiscovered + budget.similarityDerived + budget.randomExploration,
      remainingCandidateBudget
    );

    type RawCandidate = {
      name: string; domain_guess: string | null; careers_url_guess: string | null; level: ExpansionLevel;
      source: string; reason: string;
      similarToCompanyId?: string; similarToCompanyName?: string; similarSharedAttributes?: Record<string, unknown>;
      ats_provider_guess?: string | null;
      ats_url_guess?: string | null;
      ats_slug_guess?: string | null;
    };
    let rawCandidates: RawCandidate[] = [];

    if (!apiKey) {
      errors.push({ candidate: "(all AI-derived levels)", stage: "discovery", message: "OPENAI_API_KEY not configured — levels 2, 3, 4, 5, 6 skipped this run; Level 1 refresh still ran." });
    } else if (newCandidateSlots > 0) {
      const excludeNames = existingCompanies.map((c) => c.name);
      const briefsByLevel: Array<{ level: ExpansionLevel; brief: string; source: string }> = [
        { level: 2, brief: `Companies using Greenhouse, Lever, Ashby, or Breezy for hiring, that regularly post Operations, Customer Success, Support, or Business/Data Analyst roles, US remote eligible.`, source: "ats_pattern" },
        { level: 4, brief: `SaaS, AI, enterprise software, fintech, healthcare technology, logistics/supply-chain technology, cybersecurity, cloud infrastructure, e-commerce, customer-experience technology, or B2B technology companies hiring US-remote Operations/Customer Success/Business roles.`, source: "manual" },
        { level: 5, brief: `Companies headquartered outside the United States (Canada, UK, Europe, Australia, or elsewhere) that explicitly permit US-based remote workers for Operations, Customer Success, or Support roles.`, source: "manual" },
        { level: 6, brief: `Series A-D startups, recently-funded, or growth-stage remote-first companies (not large well-known tech companies) hiring for Operations, Customer Success, Support, or Business Operations roles, US remote.`, source: "random_exploration" },
      ];
      // Skip levels not requested (if the caller narrowed `levels`).
      const activeBriefs = briefsByLevel.filter((b) => !levelsRequested || levelsRequested.includes(b.level));
      const perLevelSlots = Math.max(1, Math.floor(newCandidateSlots / Math.max(1, activeBriefs.length)));

      for (const b of activeBriefs) {
        try {
          const result = await generateCandidateCompanies({
            supabase,
            userId,
            apiKey,
            brief: b.brief,
            excludeNames,
            // Oversample the discovery pool so ATS-aware prioritization has
            // enough inventory to choose from. Evaluation safety caps remain
            // unchanged; this only increases candidate possibilities.
            limit: Math.min(
              25,
              Math.max(
                perLevelSlots,
                Math.ceil(perLevelSlots * 2)
              )
            ),
          });
          levelsRun.add(b.level);
          for (const c of result.candidates) {
            rawCandidates.push({
              name: c.name, domain_guess: c.domain_guess, careers_url_guess: c.careers_url_guess,
              level: b.level, source: b.source,
              reason: `Discovered via level ${b.level} (${b.source}): ${c.reasoning}`.slice(0, 500),
              ats_provider_guess: c.ats_provider_guess ?? null,
              ats_url_guess: c.ats_url_guess ?? null,
              ats_slug_guess: c.ats_slug_guess ?? null,
            });
          }
        } catch (e: any) {
          errors.push({ candidate: `(level ${b.level} discovery)`, stage: "ai_candidate_generation", message: (e?.message || String(e)).slice(0, 300) });
        }
      }

      // ---- LEVEL 3 — similarity expansion, seeded from top existing performers ----
      if (!levelsRequested || levelsRequested.includes(3)) {
        const topPerformers = existingCompanies
          .filter((c) => (c.company_opportunity_score ?? 0) >= 85)
          .sort((a, b) => (b.company_opportunity_score ?? 0) - (a.company_opportunity_score ?? 0))
          .slice(0, 2);
        for (const source of topPerformers) {
          try {
            const simResult = await generateSimilarCompanies({
              supabase, userId, apiKey,
              sourceCompany: {
                name: source.name, industry: null, company_size_estimate: null,
                ats_provider: source.ats_provider ?? null, remote_policy_summary: null,
              },
              limit: Math.max(1, Math.floor(budget.similarityDerived)),
            });
            levelsRun.add(3);
            for (const c of simResult.candidates) {
              rawCandidates.push({
                name: c.name, domain_guess: c.domain_guess, careers_url_guess: c.careers_url_guess,
                level: 3, source: "similarity",
                reason: `Similar to ${source.name} (opportunity score ${source.company_opportunity_score}): ${c.reasoning}`.slice(0, 500),
                similarToCompanyId: source.id, similarToCompanyName: source.name,
                similarSharedAttributes: simResult.sharedAttributes,
                ats_provider_guess: c.ats_provider_guess ?? null,
                ats_url_guess: c.ats_url_guess ?? null,
                ats_slug_guess: c.ats_slug_guess ?? null,
              });
            }
          } catch (e: any) {
            errors.push({ candidate: `(similar to ${source.name})`, stage: "ai_similarity_generation", message: (e?.message || String(e)).slice(0, 300) });
          }
        }
      }
    }

    // ------------------------------------------------------------------------
    // Candidate-pool prioritization.
    //
    // AI discovery is intentionally broader than the number of companies we
    // can evaluate in one run. Prefer candidates carrying a supported-ATS hint
    // while preserving an exploration lane for Unknown ATS companies.
    //
    // IMPORTANT:
    // These ATS fields remain UNTRUSTED hints. processCandidate() / the ATS
    // resolver still independently verifies the endpoint before a company can
    // become an active source.
    // ------------------------------------------------------------------------
    const dedupedRawCandidates = dedupeRawCandidates(rawCandidates);

    const hasSupportedAtsHint = (c: RawCandidate) =>
      c.ats_provider_guess === "Greenhouse" ||
      c.ats_provider_guess === "Lever" ||
      c.ats_provider_guess === "Ashby" ||
      c.ats_provider_guess === "Breezy";

    const supportedCandidates = dedupedRawCandidates.filter(hasSupportedAtsHint);
    const exploratoryCandidates = dedupedRawCandidates.filter(
      (c) => !hasSupportedAtsHint(c)
    );

    const targetCandidateCount = Math.max(0, newCandidateSlots);

    // Preserve approximately 20% of evaluation capacity for long-tail
    // discovery. At least one exploratory candidate survives whenever there
    // is candidate capacity and exploratory inventory exists.
    const exploratoryTarget =
      targetCandidateCount > 0 && exploratoryCandidates.length > 0
        ? Math.max(1, Math.floor(targetCandidateCount * 0.2))
        : 0;

    const supportedTarget = Math.max(
      0,
      targetCandidateCount - exploratoryTarget
    );

    const selectedRawCandidates: RawCandidate[] = [
      ...supportedCandidates.slice(0, supportedTarget),
      ...exploratoryCandidates.slice(0, exploratoryTarget),
    ];

    // Backfill if either bucket could not fill its allocation. This guarantees
    // we do not waste available evaluation capacity simply because one side of
    // the supported/exploratory split was undersupplied.
    const selectedKeys = new Set(
      selectedRawCandidates.map(
        (c) =>
          normalizeDomain(c.domain_guess) ??
          canonicalizeCareersUrl(c.careers_url_guess) ??
          normalizeCompanyName(c.name) ??
          c.name.toLowerCase().trim()
      )
    );

    for (const candidate of dedupedRawCandidates) {
      if (selectedRawCandidates.length >= targetCandidateCount) break;

      const key =
        normalizeDomain(candidate.domain_guess) ??
        canonicalizeCareersUrl(candidate.careers_url_guess) ??
        normalizeCompanyName(candidate.name) ??
        candidate.name.toLowerCase().trim();

      if (selectedKeys.has(key)) continue;

      selectedRawCandidates.push(candidate);
      selectedKeys.add(key);
    }

    rawCandidates = selectedRawCandidates;

    // ---- Process each new candidate through NORMALIZATION → JOB_SOURCE UPSERT ----
    for (const rc of rawCandidates) {
      if (remainingCandidateBudget <= 0) break;
      remainingCandidateBudget--;
      try {
        const result = await processCandidate({
          supabase, userId,
          candidate: {
            name: rc.name,
            domain_guess: rc.domain_guess,
            careers_url_guess: rc.careers_url_guess,
            discovery_level: rc.level,
            discovery_source: rc.source,
            discovery_reason: rc.reason,
            ats_provider_guess: rc.ats_provider_guess,
            ats_url_guess: rc.ats_url_guess,
            ats_slug_guess: rc.ats_slug_guess,
          },
          existingIndex, existingJobSourceUrls, priors, dryRun,
          remainingNewCompanySlots, remainingNewSourceSlots,
        });
        candidateOutcomes.push(result);
        if (result.outcome === "created" || result.outcome === "would_create") {
          remainingNewCompanySlots--;
        }
        if (result.job_source_action === "added" || result.job_source_action === "would_add") {
          remainingNewSourceSlots--;
          sourcesAdded += result.job_source_action === "added" ? 1 : 0;
        }

        // Level 3 (similarity) — record the discovery-graph edge now that we
        // know the candidate's resulting company id. Best-effort; a failure
        // here never fails the candidate itself (failure isolation, point 25).
        if (!dryRun && rc.similarToCompanyId && result.matched_existing_company_id && rc.level === 3) {
          try {
            await (supabase as any).from("company_similarity").insert({
              user_id: userId,
              company_id_a: rc.similarToCompanyId,
              company_id_b: result.matched_existing_company_id,
              similarity_score: result.opportunity_score ?? 50,
              shared_attributes: rc.similarSharedAttributes ?? {},
            } as any);
          } catch (e: any) {
            errors.push({ candidate: rc.name, stage: "company_similarity_insert", message: (e?.message || String(e)).slice(0, 300) });
          }
        }
      } catch (e: any) {
        errors.push({ candidate: rc.name, stage: "process_candidate", message: (e?.message || String(e)).slice(0, 300) });
        candidateOutcomes.push({
          name: rc.name, domain: null, careers_url: rc.careers_url_guess, ats_provider: null,
          discovery_level: rc.level, stage_reached: "unknown", outcome: "error",
          discovery_status: null, opportunity_score: null, remote_eligibility_class: null,
          matched_existing_company_id: null, matched_by: null, job_source_action: null,
          reject_reason: null, error: (e?.message || String(e)).slice(0, 300),
        });
      }
    }

    // ---- Summarize + write discovery_runs (audit log; written even for dry runs) ----
    const companiesValidated = candidateOutcomes.filter(
      (c) => c.discovery_status === "APPROVED" || c.discovery_status === "HIGH_PRIORITY"
    ).length;
    const companiesRejected = candidateOutcomes.filter((c) => c.outcome === "rejected").length;
    const companiesDiscovered = candidateOutcomes.filter((c) => c.discovery_level !== 1).length;

    const runNotes = {
      mode: dryRun ? "dry_run" : "live",
      caps,
      discovery_mix_used: mix,
      expansion_mode: expansionEval,
      error_count: errors.length,
      // Deliberately no API keys, tokens, or raw prompts here — just structured, reviewable counts.
    };

    const { data: runRow, error: runErr } = await (supabase as any)
      .from("discovery_runs")
      .insert({
        user_id: userId,
        run_started_at: new Date(startedAt).toISOString(),
        run_finished_at: new Date().toISOString(),
        expansion_level: levelsRun.size === 1 ? [...levelsRun][0] : null,
        triggered_by: "manual",
        ats_provider: data.ats_provider ?? null,
        companies_found: candidateOutcomes.length,
        companies_approved: companiesValidated,
        companies_rejected: companiesRejected,
        notes: JSON.stringify(runNotes),
      } as any)
      .select("id")
      .single();
    if (runErr) {
      errors.push({ candidate: "(run log)", stage: "discovery_runs_insert", message: runErr.message });
    }

    console.log(
      `[company-scout] run finished · dry_run=${dryRun} · evaluated=${candidateOutcomes.length} · validated=${companiesValidated} · rejected=${companiesRejected} · sources_added=${sourcesAdded} · errors=${errors.length} · ${Date.now() - startedAt}ms`
    );

    return {
      run_id: String(runRow?.id ?? "unknown"),
      dry_run: dryRun,
      levels_run: [...levelsRun].sort(),
      safety_caps: caps,
      discovery_mix_used: mix,
      expansion_mode: expansionEval,
      companies_evaluated: candidateOutcomes.length,
      companies_discovered: companiesDiscovered,
      companies_validated: companiesValidated,
      companies_rejected: companiesRejected,
      sources_added: sourcesAdded,
      sources_refreshed: sourcesRefreshed,
      errors,
      candidates: candidateOutcomes,
      duration_ms: Date.now() - startedAt,
    };
  });

// ----------------------------------------------------------------------------
// Inspection endpoints (point 22: "allows inspection of discoveries"). No UI
// is built in Phase 2 — these are plain read endpoints a developer/admin can
// call directly (e.g. from a REPL, curl with an auth token, or a future
// Phase 4 page) to review what Company Scout has found.
// ----------------------------------------------------------------------------
export const listDiscoveredCompanies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ status: z.string().optional(), limit: z.number().int().min(1).max(200).default(50) }).parse(d ?? {})
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("companies")
      .select("id, name, domain, careers_url, ats_provider, discovery_status, company_opportunity_score, discovery_source, discovery_reason, first_discovered_at, last_checked_at, us_remote_allowed, global_remote_allowed, north_america_remote_allowed")
      .order("company_opportunity_score", { ascending: false, nullsFirst: false })
      .limit(data.limit);
    if (data.status) q = (q as any).eq("discovery_status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { companies: rows ?? [] };
  });

export const getDiscoveryRunHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ limit: z.number().int().min(1).max(100).default(20) }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await (context.supabase as any)
      .from("discovery_runs")
      .select("*")
      .order("run_started_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return { runs: rows ?? [] };
  });
