// ============================================================================
// Company Discovery Intelligence Layer — Phase 3.1: Scout → Ingest handoff.
//
// PROBLEM THIS SOLVES: Company Scout (processCandidate, runCompanyScout) can
// already write a valid, active job_sources row for an APPROVED/HIGH_PRIORITY
// company. The existing ingestion pipeline (runImportJobsPipeline, extracted
// from importJobsNow in this same phase) can already fetch/normalize/filter/
// dedupe/score jobs for any active job_sources row. Nothing connected the
// two — a freshly Scout-created source sat idle until a human clicked
// "Import" on /sources. This file is that controlled connection. It is NOT
// a scheduler: it runs once, synchronously, only when explicitly invoked.
//
// SAFETY MODEL — read this before changing anything:
//   - Default behavior is dry-run AND no-ingest. Both must be explicitly
//     overridden by the caller to do anything beyond a preview.
//   - Ingestion can ONLY ever happen when dry_run=false AND
//     ingest_after_scout=true AND at least one source has a REAL
//     job_sources.id. A dry-run Scout pass never produces real ids (nothing
//     was written), so this is structurally impossible to trigger in
//     dry-run even if a caller somehow also set ingest_after_scout=true —
//     there would be nothing with a real id to hand to the ingest pipeline.
//   - Only job_sources that (a) Company Scout itself just created or
//     updated THIS run, (b) are active, and (c) resolved to one of the 4
//     supported ATS providers are ever handed to ingestion — never "every
//     active source" (that's what runImportJobsPipeline's own default,
//     unscoped call already does, via /sources' existing Import button;
//     this handoff is deliberately narrower).
//   - Ingestion is performed by calling the EXACT SAME runImportJobsPipeline
//     function importJobsNow calls — imported directly, never reimplemented.
//     There is no second ingestion code path anywhere in this file.
//   - This file never imports from, or writes to, applications or
//     auto-review-scoring/smart-apply.functions — a job reaching
//     job_listings via this handoff is exactly as far as Company Scout is
//     ever allowed to reach. Everything past job_listings (evaluateAutoReview,
//     application creation) still requires the existing, separate Smart
//     Apply pipeline to run, exactly as it does for every other source.
//
// TESTABILITY: mirrors the same dependency-injection pattern Phase 3.1 used
// for importJobsNow → runImportJobsPipeline. runScoutAndIngestCore() takes
// `runScout`/`runIngest` as injectable params (both default to the real
// production functions) so tests can exercise the full handoff logic
// against fakes, with zero live Supabase/network/HTTP-context dependency.
//
// FRAMEWORK CONTRACT (Phase 3.1 final stabilization): the default `runScout`
// calls runCompanyScoutCore directly — the plain, injectable core extracted
// from the createServerFn-wrapped runCompanyScout — passing this function's
// own already-authenticated `supabase`/`userId` explicitly. It deliberately
// does NOT call runCompanyScout({ data: input }) (the createServerFn
// wrapper). Calling a createServerFn-wrapped function directly from a
// different file is not a same-process call this project can rely on: it
// depends on a build-time AST transform (@tanstack/start-plugin-core's
// handleCreateServerFn) that only fires for the function's own "provider
// file", and this project's vitest.config.ts deliberately does not apply
// that transform at all, so the same call in tests would run the
// createServerFn client-side middleware branch with an empty context,
// never reaching requireSupabaseAuth. Going straight to the core avoids
// this entirely — no implicit request-context propagation, no dependency
// on compiler internals.
// ============================================================================

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { runCompanyScoutCore, type ScoutRunResult, type CandidateOutcome } from "./company-discovery.functions";
import { runImportJobsPipeline, type RunImportJobsPipelineResult } from "./ingest.functions";

const SUPPORTED_ATS_PROVIDERS = ["Greenhouse", "Lever", "Ashby", "Breezy"] as const;

export interface ScoutIngestEligibleCandidate {
  name: string;
  ats_provider: string | null;
  job_source_action: CandidateOutcome["job_source_action"];
  job_source_id: string | null;
}

export interface RunScoutAndIngestParams {
  supabase: any;
  userId: string;
  // Default-safe: dry-run and no-ingest unless the caller explicitly opts
  // out of each independently.
  dryRun?: boolean;
  ingestAfterScout?: boolean;
  scoutInput?: {
    levels?: number[];
    max_candidates_evaluated?: number;
    max_new_companies_validated?: number;
    max_new_job_sources?: number;
  };
  // DI seams (Phase 3.1) — both default to the real production functions.
  // Tests inject fakes; production never overrides these.
  runScout?: (input: {
    dry_run: boolean;
    levels?: number[];
    max_candidates_evaluated?: number;
    max_new_companies_validated?: number;
    max_new_job_sources?: number;
  }) => Promise<ScoutRunResult>;
  runIngest?: typeof runImportJobsPipeline;
}

export interface RunScoutAndIngestResult {
  scout: ScoutRunResult;
  // Every candidate this run's job_source_action + resolved ATS made
  // eligible for ingestion — in dry-run these carry job_source_id: null
  // (nothing was written yet) and are reported by job_source_action
  // ("would_add"/"would_update") instead; in a live run they carry the
  // real id that was (or would be, if ingestion wasn't requested) handed
  // to the ingest pipeline.
  eligible_candidates: ScoutIngestEligibleCandidate[];
  // Populated ONLY when ingestion actually ran this call.
  ingest: RunImportJobsPipelineResult | null;
  // True only when ingestion was both requested AND had eligible sources
  // to act on but did NOT run (e.g. dry_run=true) — lets a caller
  // distinguish "nothing to ingest" from "declined to ingest".
  ingest_skipped_reason: "dry_run" | "not_requested" | "no_eligible_sources" | null;
}

function isSupportedAtsProvider(ats: string | null): ats is (typeof SUPPORTED_ATS_PROVIDERS)[number] {
  return !!ats && (SUPPORTED_ATS_PROVIDERS as readonly string[]).includes(ats);
}

// The plain, injectable core. See file header for the full safety model —
// this function is the enforcement point for every guarantee described
// there.
export async function runScoutAndIngestCore(params: RunScoutAndIngestParams): Promise<RunScoutAndIngestResult> {
  const dryRun = params.dryRun ?? true; // default-safe: dry-run unless explicitly disabled
  const ingestAfterScout = params.ingestAfterScout ?? false; // default-safe: explicit opt-in only
  const runScout = params.runScout ?? ((input) => runCompanyScoutCore({ supabase: params.supabase, userId: params.userId, data: input }));
  const runIngest = params.runIngest ?? runImportJobsPipeline;

  // ---- 1. Run Company Scout (the real, unmodified entrypoint) ----
  const scoutResult = await runScout({
    dry_run: dryRun,
    levels: params.scoutInput?.levels,
    max_candidates_evaluated: params.scoutInput?.max_candidates_evaluated,
    max_new_companies_validated: params.scoutInput?.max_new_companies_validated,
    max_new_job_sources: params.scoutInput?.max_new_job_sources,
  });

  // ---- 2. Collect only sources that were successfully created/updated,
  // active, and resolved to a supported ATS THIS run. Dry-run candidates
  // never have a real job_source_id (nothing was written) — they're still
  // reported via job_source_action ("would_add"/"would_update") so the
  // preview is meaningful, but can never feed step 3. ----
  const liveActions = new Set(["added", "updated"]);
  const dryRunActions = new Set(["would_add", "would_update"]);
  const relevantActions = dryRun ? dryRunActions : liveActions;

  const eligibleCandidates: ScoutIngestEligibleCandidate[] = scoutResult.candidates
    .filter((c) =>
      c.job_source_action != null &&
      relevantActions.has(c.job_source_action) &&
      isSupportedAtsProvider(c.ats_provider)
    )
    .map((c) => ({
      name: c.name,
      ats_provider: c.ats_provider,
      job_source_action: c.job_source_action,
      job_source_id: c.job_source_id ?? null,
    }));

  const eligibleSourceIds = eligibleCandidates
    .map((c) => c.job_source_id)
    .filter((id): id is string => !!id);

  // ---- 3. Optionally run the SAME extracted ingest pipeline, scoped to
  // exactly these sources. Every branch below that skips ingestion is
  // exhaustively reported via ingest_skipped_reason rather than silently
  // returning null. ----
  if (dryRun) {
    return { scout: scoutResult, eligible_candidates: eligibleCandidates, ingest: null, ingest_skipped_reason: "dry_run" };
  }
  if (!ingestAfterScout) {
    return { scout: scoutResult, eligible_candidates: eligibleCandidates, ingest: null, ingest_skipped_reason: "not_requested" };
  }
  if (eligibleSourceIds.length === 0) {
    return { scout: scoutResult, eligible_candidates: eligibleCandidates, ingest: null, ingest_skipped_reason: "no_eligible_sources" };
  }

  const ingestResult = await runIngest({
    supabase: params.supabase,
    userId: params.userId,
    sourceIds: eligibleSourceIds,
  });

  return { scout: scoutResult, eligible_candidates: eligibleCandidates, ingest: ingestResult, ingest_skipped_reason: null };
}

// Thin auth/context wrapper — translates the zod-validated request shape
// into runScoutAndIngestCore's params and delegates entirely. Both
// dry_run and ingest_after_scout default to their safe values at the
// schema level too, so an empty request body is a pure preview.
const RunScoutAndIngestInput = z.object({
  dry_run: z.boolean().default(true),
  ingest_after_scout: z.boolean().default(false),
  levels: z.array(z.number().int().min(1).max(6)).optional(),
  max_candidates_evaluated: z.number().int().min(1).max(100).optional(),
  max_new_companies_validated: z.number().int().min(1).max(25).optional(),
  max_new_job_sources: z.number().int().min(1).max(10).optional(),
});

export const runCompanyScoutAndIngest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => RunScoutAndIngestInput.parse(d))
  .handler(async ({ data, context }) => {
    return runScoutAndIngestCore({
      supabase: context.supabase,
      userId: context.userId,
      dryRun: data.dry_run,
      ingestAfterScout: data.ingest_after_scout,
      scoutInput: {
        levels: data.levels,
        max_candidates_evaluated: data.max_candidates_evaluated,
        max_new_companies_validated: data.max_new_companies_validated,
        max_new_job_sources: data.max_new_job_sources,
      },
    });
  });
