#!/usr/bin/env -S bun run
// ============================================================================
// Phase 2.5 — Company Scout Dry-Run CLI
//
// WHY THIS SCRIPT EXISTS: this sandbox has no network path to any live
// Supabase project, and no network path to Greenhouse/Lever/Ashby/Breezy's
// public APIs (see the Phase 2.5 report, §1 — every host is blocked at the
// proxy level except github.com and registry.npmjs.org, and npmjs itself
// 403s). Dry Runs A/B/C (§5 of the Phase 2.5 authorization) therefore could
// NOT be executed against real, live discovery data from this environment.
// This script is the mechanism to run them for real, in an environment that
// DOES have network + Supabase access — run it there, not here.
//
// This script calls the REAL, unmodified, committed Phase 2 functions
// (processCandidate, refreshExistingCompany from company-discovery.functions.ts;
// generateCandidateCompanies / generateSimilarCompanies from
// company-discovery-ai.ts) directly against a real Supabase client — it does
// NOT go through the createServerFn/HTTP/auth-middleware layer (same
// rationale as the committed unit tests: that layer is plumbing, not Company
// Scout logic, and this is a CLI, not a browser request).
//
// SAFETY: dryRun is hardcoded to `true` and is NOT a CLI flag. Per the
// Phase 2.5 authorization ("Company Scout must remain in dryRun = true for
// all Phase 2.5 validation runs"), this script cannot be used to perform a
// live run — that would require a deliberate code change, which is a
// visible, reviewable diff, not a flag someone can pass by accident.
//
// Usage (once `bun install` succeeds in a networked environment):
//   export SUPABASE_URL=...
//   export SUPABASE_SERVICE_ROLE_KEY=...     # service role, so RLS doesn't
//                                             # block a scoped, explicit
//                                             # user_id filter — treat this
//                                             # key with the same care as
//                                             # any other production secret
//   export OPENAI_API_KEY=...                # only needed for --use-ai
//   bun run phase2_5-dry-run-cli.ts \
//     --user-id <uuid> \
//     --run dry-run-a \                      # dry-run-a | dry-run-b | dry-run-c
//     --candidates-file ./candidates-a.json \ # optional: manual candidate list
//     --use-ai                                # optional: also pull AI-suggested
//                                              # candidates for levels 2/4/5/6
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import {
  buildExistingCompanyIndex,
  clampSafetyCaps,
  evaluateExpansionMode,
  rebalanceForExpansion,
  allocateDiscoveryBudget,
  DEFAULT_DISCOVERY_MIX,
  NEUTRAL_PRIORS,
  type PopulationPriors,
  type ExpansionLevel,
} from "../src/lib/company-discovery";
import {
  processCandidate,
  refreshExistingCompany,
  type CandidateOutcome,
} from "../src/lib/company-discovery.functions";
import { generateCandidateCompanies } from "../src/lib/company-discovery-ai";
// generateSimilarCompanies (Level 3) is not wired into this CLI yet — Levels
// 2/4/5/6 (broad AI-suggested candidates) are covered via --use-ai above.
// Level 3 (similarity-derived candidates from a specific seed company) would
// need a --seed-company-id flag; add it if Dry Run B/C review calls for
// exercising that path specifically.

// ---- run presets, exactly matching Phase 2.5 §5 -----------------------------
const RUN_PRESETS: Record<string, { label: string; caps: { maxCandidatesEvaluatedPerRun: number; maxNewCompaniesValidatedPerRun: number; maxNewJobSourcesPerRun: number }; forceExpansionMode: boolean }> = {
  "dry-run-a": { label: "Dry Run A — Existing ecosystem", caps: { maxCandidatesEvaluatedPerRun: 25, maxNewCompaniesValidatedPerRun: 10, maxNewJobSourcesPerRun: 5 }, forceExpansionMode: false },
  "dry-run-b": { label: "Dry Run B — Broader discovery", caps: { maxCandidatesEvaluatedPerRun: 50, maxNewCompaniesValidatedPerRun: 15, maxNewJobSourcesPerRun: 7 }, forceExpansionMode: false },
  "dry-run-c": { label: "Dry Run C — Expansion mode", caps: { maxCandidatesEvaluatedPerRun: 100, maxNewCompaniesValidatedPerRun: 25, maxNewJobSourcesPerRun: 10 }, forceExpansionMode: true },
};

const DEFAULT_SOURCES_NAMES = new Set(["stripe", "airbnb", "dropbox", "plaid", "brex", "ramp", "linear", "openai", "posthog", "netflix"]);

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return {
    userId: get("--user-id"),
    run: get("--run") ?? "dry-run-a",
    candidatesFile: get("--candidates-file"),
    useAi: args.includes("--use-ai"),
  };
}

async function main() {
  const { userId, run, candidatesFile, useAi } = parseArgs();
  if (!userId) {
    console.error("Usage: bun run phase2_5-dry-run-cli.ts --user-id <uuid> --run dry-run-a|dry-run-b|dry-run-c [--candidates-file path.json] [--use-ai]");
    process.exit(1);
  }
  const preset = RUN_PRESETS[run];
  if (!preset) {
    console.error(`Unknown --run "${run}". Expected one of: ${Object.keys(RUN_PRESETS).join(", ")}`);
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  console.log(`\n${"=".repeat(78)}\n${preset.label}\nSafety caps: ${JSON.stringify(preset.caps)}\nDRY RUN: true (hardcoded — see header comment)\n${"=".repeat(78)}\n`);

  const startedAt = Date.now();
  const caps = clampSafetyCaps(preset.caps);

  // ---- load existing state for this user -----------------------------------
  const { data: existingCompaniesRaw, error: coErr } = await supabase
    .from("companies")
    .select("id, domain, ats_provider, ats_company_slug, careers_url, name, application_count, response_count, interview_count, avg_job_quality, discovery_status, company_opportunity_score, careers_url, last_job_seen_at")
    .eq("user_id", userId);
  if (coErr) { console.error("Failed to load companies:", coErr.message); process.exit(1); }
  const existingCompanies = existingCompaniesRaw ?? [];

  const { data: existingSourcesRaw, error: srcErr } = await supabase
    .from("job_sources").select("careers_url").eq("user_id", userId);
  if (srcErr) { console.error("Failed to load job_sources:", srcErr.message); process.exit(1); }
  const existingJobSourceUrls = new Set<string>(
    (existingSourcesRaw ?? []).map((r: any) => r.careers_url).filter(Boolean)
  );

  const existingIndex = buildExistingCompanyIndex(existingCompanies as any);

  // population priors, computed the same way computePopulationPriors() does
  // internally (that function isn't exported — replicated here rather than
  // modifying committed Phase 2 files for a CLI-only need).
  const historyRows = existingCompanies.filter((c: any) => (c.application_count ?? 0) >= 3);
  const priors: PopulationPriors = historyRows.length
    ? {
        medianAvgJobQuality: median(historyRows.map((r: any) => r.avg_job_quality).filter((v: any) => v != null)) ?? NEUTRAL_PRIORS.medianAvgJobQuality,
        medianResponseRate: median(historyRows.map((r: any) => (r.response_count / r.application_count) * 100)) ?? NEUTRAL_PRIORS.medianResponseRate,
        medianInterviewRate: median(historyRows.map((r: any) => (r.interview_count / r.application_count) * 100)) ?? NEUTRAL_PRIORS.medianInterviewRate,
      }
    : NEUTRAL_PRIORS;

  // ---- expansion mode (forced on for Dry Run C per §5) ---------------------
  const expansionEval = preset.forceExpansionMode
    ? { active: true, reasons: ["Forced on for Dry Run C per Phase 2.5 §5"] }
    : evaluateExpansionMode({
        uniqueCompaniesDiscoveredLast7d: 0, uniqueCompaniesDiscoveredPrior7d: 0,
        topFiveCompanyShareOfEligibleJobs: 0, sourcingVolumeTrend: "flat",
      }); // NOTE: real signals require the same queries as baseline_sourcing_concentration.sql §8 — wire in for a non-forced evaluation.
  const mix = expansionEval.active ? rebalanceForExpansion(DEFAULT_DISCOVERY_MIX) : DEFAULT_DISCOVERY_MIX;
  const budget = allocateDiscoveryBudget(caps.maxCandidatesEvaluatedPerRun, mix);
  console.log(`Expansion mode: ${expansionEval.active} (${expansionEval.reasons.join("; ") || "n/a"})`);
  console.log(`Discovery budget allocation: ${JSON.stringify(budget)}\n`);

  // ---- Level 1: refresh existing companies ----------------------------------
  const refreshCandidates = existingCompanies.filter((c: any) =>
    ["APPROVED", "HIGH_PRIORITY", "WATCHLIST"].includes(c.discovery_status)
  ).slice(0, budget.existingHighPerforming + budget.staleUnvisited);

  const outcomes: CandidateOutcome[] = [];
  for (const company of refreshCandidates) {
    try {
      const outcome = await refreshExistingCompany({ supabase, userId, company, priors, dryRun: true });
      outcomes.push(outcome);
    } catch (e: any) {
      console.error(`  [isolated failure] ${company.name}: ${e?.message ?? e}`);
    }
  }
  console.log(`Level 1 (refresh): ${refreshCandidates.length} companies processed.\n`);

  // ---- Levels 2-6: new candidates -------------------------------------------
  type RawCandidate = { name: string; domain_guess: string | null; careers_url_guess: string | null; discovery_level: ExpansionLevel; discovery_source: string; discovery_reason: string };
  let candidates: RawCandidate[] = [];

  if (candidatesFile) {
    const fs = await import("node:fs/promises");
    const raw = JSON.parse(await fs.readFile(candidatesFile, "utf-8"));
    candidates = raw.map((c: any) => ({
      name: c.name, domain_guess: c.domain_guess ?? null, careers_url_guess: c.careers_url_guess ?? null,
      discovery_level: c.discovery_level ?? 2, discovery_source: c.discovery_source ?? "manual", discovery_reason: c.discovery_reason ?? "manual candidate file",
    }));
    console.log(`Loaded ${candidates.length} candidates from ${candidatesFile}.\n`);
  }

  if (useAi) {
    if (!process.env.OPENAI_API_KEY) {
      console.error("  [skipped] --use-ai requested but OPENAI_API_KEY is not set — AI candidate generation skipped (matches production failure-isolation behavior).");
    } else {
      try {
        const excludeNames = existingCompanies.map((c: any) => c.name).filter(Boolean);
        const aiResult = await generateCandidateCompanies({
          supabase, userId, apiKey: process.env.OPENAI_API_KEY!,
          brief: "SaaS and technology companies with US-remote-eligible roles in operations, business analysis, customer success, or program/project coordination — the target job categories for this tool.",
          excludeNames,
          limit: Math.max(0, budget.newlyDiscovered),
        });
        for (const c of (aiResult?.candidates ?? [])) {
          candidates.push({
            name: c.name, domain_guess: c.domain_guess, careers_url_guess: c.careers_url_guess,
            discovery_level: 2, discovery_source: "ai_candidate_generation", discovery_reason: `${c.reasoning} (AI confidence: ${c.confidence})`,
          });
        }
        console.log(`AI candidate generation: ${aiResult?.candidates?.length ?? 0} candidates added.\n`);
      } catch (e: any) {
        console.error(`  [isolated failure] AI candidate generation: ${e?.message ?? e}`);
      }
    }
  }

  if (candidates.length === 0) {
    console.log("No new-candidate source provided (--candidates-file / --use-ai) — only Level 1 refresh ran. This is expected for a first smoke-test invocation; provide one of those flags for Levels 2-6.\n");
  }

  candidates = candidates.slice(0, caps.maxCandidatesEvaluatedPerRun - refreshCandidates.length);

  let remainingNewCompanySlots = caps.maxNewCompaniesValidatedPerRun;
  let remainingNewSourceSlots = caps.maxNewJobSourcesPerRun;

  for (const candidate of candidates) {
    try {
      const outcome = await processCandidate({
        supabase, userId, candidate, existingIndex, existingJobSourceUrls, priors,
        dryRun: true, // HARDCODED — see header comment
        remainingNewCompanySlots, remainingNewSourceSlots,
      });
      outcomes.push(outcome);
      if (outcome.outcome === "would_create" && !outcome.matched_existing_company_id) remainingNewCompanySlots--;
      if (outcome.job_source_action === "would_add") remainingNewSourceSlots--;
    } catch (e: any) {
      console.error(`  [isolated failure] ${candidate.name}: ${e?.message ?? e}`);
    }
  }

  // ---- report -----------------------------------------------------------
  const durationMs = Date.now() - startedAt;
  const newCandidateOutcomes = outcomes.filter((o) => o.discovery_level !== 1);
  const validated = outcomes.filter((o) => o.discovery_status === "APPROVED" || o.discovery_status === "HIGH_PRIORITY");
  const rejected = outcomes.filter((o) => o.outcome === "rejected" || o.outcome === "error");
  const newSources = outcomes.filter((o) => o.job_source_action === "would_add");

  const escapedFromSeed = newCandidateOutcomes.filter((o) => !DEFAULT_SOURCES_NAMES.has((o.name || "").toLowerCase().trim()));
  const escapeRatePctOfValidated = newCandidateOutcomes.length
    ? Math.round((100 * newCandidateOutcomes.filter((o) => escapedFromSeed.includes(o) && (o.discovery_status === "APPROVED" || o.discovery_status === "HIGH_PRIORITY")).length) /
        Math.max(1, newCandidateOutcomes.filter((o) => o.discovery_status === "APPROVED" || o.discovery_status === "HIGH_PRIORITY").length))
    : null;
  const escapeRatePctOfNewSources = newSources.length
    ? Math.round((100 * newSources.filter((o) => !DEFAULT_SOURCES_NAMES.has((o.name || "").toLowerCase().trim())).length) / newSources.length)
    : null;

  const report = {
    run: run,
    label: preset.label,
    dry_run: true,
    safety_caps: caps,
    expansion_mode: expansionEval,
    discovery_mix_used: mix,
    duration_ms: durationMs,
    candidates_evaluated: outcomes.length,
    unique_companies_discovered: newCandidateOutcomes.length,
    duplicate_companies_matched: newCandidateOutcomes.filter((o) => o.matched_existing_company_id).length,
    newly_discovered_companies: newCandidateOutcomes.filter((o) => !o.matched_existing_company_id).length,
    validated_companies: validated.length,
    rejected_companies: rejected.length,
    rejection_reasons: rejected.reduce((acc: Record<string, number>, o) => {
      const k = o.reject_reason ?? o.error ?? "unknown"; acc[k] = (acc[k] ?? 0) + 1; return acc;
    }, {}),
    us_remote_confirmed: outcomes.filter((o) => o.remote_eligibility_class === "us_confirmed").length,
    us_remote_probable: outcomes.filter((o) => o.remote_eligibility_class === "global_us_eligible" || o.remote_eligibility_class === "north_america").length,
    us_remote_unknown: outcomes.filter((o) => o.remote_eligibility_class === "unknown" || o.remote_eligibility_class === "mixed_role_dependent").length,
    us_remote_excluded: outcomes.filter((o) => o.remote_eligibility_class === "us_excluded").length,
    proposed_new_job_sources: newSources.length,
    proposed_source_updates: outcomes.filter((o) => o.job_source_action === "would_update").length,
    average_opportunity_score: outcomes.length
      ? Math.round((outcomes.reduce((a, o) => a + (o.opportunity_score ?? 0), 0) / outcomes.length) * 10) / 10
      : null,
    ats_mix: outcomes.reduce((acc: Record<string, number>, o) => {
      const k = o.ats_provider ?? "none"; acc[k] = (acc[k] ?? 0) + 1; return acc;
    }, {}),
    original_seed_escape: {
      new_candidates_from_original_seed: newCandidateOutcomes.length - escapedFromSeed.length,
      new_candidates_genuinely_new: escapedFromSeed.length,
      pct_of_validated_candidates_that_are_new: escapeRatePctOfValidated,
      pct_of_proposed_new_sources_that_are_new: escapeRatePctOfNewSources,
      meets_70pct_target: escapeRatePctOfNewSources != null ? escapeRatePctOfNewSources >= 70 : null,
    },
    candidates: outcomes,
  };

  console.log(JSON.stringify(report, null, 2));

  const fs = await import("node:fs/promises");
  const outPath = `./phase2_5-${run}-result.json`;
  await fs.writeFile(outPath, JSON.stringify(report, null, 2));
  console.log(`\nFull report written to ${outPath}`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
