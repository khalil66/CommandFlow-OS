import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { detectAts, parseSalary, stripHtml, hasAccessBlockers, isRemote, type SupportedAts } from "./ats-detect";
import { mapSalarySource } from "./salary-estimator";
import { isOpenAiHealthy } from "./openai-validate.functions";
import { computeTrustScore, computeInterviewProbability, isReadyToApply, SUPPORTED_ATS, SALARY_FLOOR } from "./scoring";
import { detectScamFlags } from "./scam-signals";
import { projectsForRole } from "./portfolio";
import { evaluateResumeFit } from "./resume-fit";

interface NormJob {
  external_id: string;
  title: string;
  location: string | null;
  description_html: string;
  description_text: string;
  url: string;
  posted_at: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_estimated: boolean;
}

// ---------- ATS Fetchers ---------- //

async function fetchGreenhouse(slug: string): Promise<NormJob[]> {
  const r = await fetch(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`);
  if (!r.ok) throw new Error(`Greenhouse: ${r.status}`);
  const j = await r.json() as any;
  return (j.jobs || []).map((x: any) => {
    const text = stripHtml(x.content);
    const sal = parseSalary(text);
    return {
      external_id: String(x.id),
      title: x.title,
      location: x.location?.name ?? null,
      description_html: x.content || "",
      description_text: text,
      url: x.absolute_url,
      posted_at: x.updated_at || null,
      salary_min: sal.min,
      salary_max: sal.max,
      salary_estimated: sal.min == null,
    };
  });
}

async function fetchLever(slug: string): Promise<NormJob[]> {
  const r = await fetch(`https://api.lever.co/v0/postings/${slug}?mode=json`);
  if (!r.ok) throw new Error(`Lever: ${r.status}`);
  const arr = await r.json() as any[];
  return (arr || []).map((x: any) => {
    const text = stripHtml(x.descriptionPlain || x.description);
    const sal = x.salaryRange
      ? { min: x.salaryRange.min, max: x.salaryRange.max }
      : parseSalary(text);
    return {
      external_id: x.id,
      title: x.text,
      location: x.categories?.location ?? null,
      description_html: x.description || "",
      description_text: text,
      url: x.hostedUrl,
      posted_at: x.createdAt ? new Date(x.createdAt).toISOString() : null,
      salary_min: sal.min,
      salary_max: sal.max,
      salary_estimated: sal.min == null,
    };
  });
}

async function fetchAshby(slug: string): Promise<NormJob[]> {
  const r = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`);
  if (!r.ok) throw new Error(`Ashby: ${r.status}`);
  const j = await r.json() as any;
  return (j.jobs || []).map((x: any) => {
    const text = stripHtml(x.descriptionHtml || x.description);
    const comp = x.compensation?.compensationTierSummary || "";
    const sal = parseSalary(comp || text);
    return {
      external_id: x.id,
      title: x.title,
      location: x.location ?? null,
      description_html: x.descriptionHtml || "",
      description_text: text,
      url: x.jobUrl,
      posted_at: x.publishedAt || null,
      salary_min: sal.min,
      salary_max: sal.max,
      salary_estimated: sal.min == null,
    };
  });
}

async function fetchBreezy(slug: string): Promise<NormJob[]> {
  const r = await fetch(`https://${slug}.breezy.hr/json`);
  if (!r.ok) throw new Error(`Breezy: ${r.status}`);
  const arr = await r.json() as any[];
  return (arr || []).map((x: any) => {
    const text = stripHtml(x.description);
    const sal = parseSalary(text);
    return {
      external_id: x.id,
      title: x.name,
      location: [x.location?.city?.name, x.location?.country?.name].filter(Boolean).join(", ") || null,
      description_html: x.description || "",
      description_text: text,
      url: x.url,
      posted_at: x.published_date || null,
      salary_min: sal.min,
      salary_max: sal.max,
      salary_estimated: sal.min == null,
    };
  });
}

async function fetchByPlatform(platform: SupportedAts, slug: string): Promise<NormJob[]> {
  switch (platform) {
    case "Greenhouse": return fetchGreenhouse(slug);
    case "Lever":      return fetchLever(slug);
    case "Ashby":      return fetchAshby(slug);
    case "Breezy":     return fetchBreezy(slug);
  }
}

function dedupeHash(company: string, title: string, location: string | null, url: string): string {
  return `${company}|${title}|${location ?? ""}|${url}`.toLowerCase().replace(/\s+/g, " ").trim();
}

function inferRoleCategory(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("data")) return "Data Analyst";
  if (t.includes("business analyst")) return "Business Analyst";
  if (t.includes("operations") || t.includes("ops")) return "Operations Analyst";
  if (t.includes("project")) return "Project Manager";
  if (t.includes("product")) return "Product Operations Analyst";
  if (t.includes("customer success")) return "Customer Success Manager";
  if (t.includes("support")) return "Technical Support Engineer";
  if (t.includes("revenue")) return "Revenue Operations Analyst";
  if (t.includes("implement")) return "Implementation Specialist";
  return "Operations Analyst";
}

// ---------- CRUD: job_sources ---------- //

export const listJobSources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("job_sources").select("*").order("created_at", { ascending: false });
    return { sources: data || [] };
  });

export const addJobSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    name: z.string().min(1).max(200),
    careers_url: z.string().url(),
    notes: z.string().max(500).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const det = detectAts(data.careers_url);
    const { data: row, error } = await context.supabase.from("job_sources").insert({
      user_id: context.userId,
      name: data.name,
      careers_url: data.careers_url,
      ats: det.platform,
      status: det.supported ? "active" : "rejected",
      notes: data.notes ?? det.reason ?? null,
    }).select().single();
    if (error) throw new Error(error.message);
    return { source: row, detection: det };
  });

export const deleteJobSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("job_sources").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listImportLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("import_logs").select("*").order("created_at", { ascending: false }).limit(50);
    return { logs: data || [] };
  });

// ---------- IMPORT ---------- //

export const importJobsNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ source_id: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    let q = supabase.from("job_sources").select("*").eq("status", "active");
    if (data.source_id) q = q.eq("id", data.source_id);
    const { data: sources } = await q;
    if (!sources || sources.length === 0) {
      return { runs: [], totals: { found: 0, imported: 0, duplicate: 0, skipped: 0, rejected: 0, manual_review: 0 } };
    }

    const totals = { found: 0, imported: 0, duplicate: 0, skipped: 0, rejected: 0, manual_review: 0 };
    const runs: any[] = [];
    const STALE_DAYS = 14;
    const staleCutoffMs = Date.now() - STALE_DAYS * 86400000;

    for (const src of sources) {
      const det = detectAts(src.careers_url);
      const counts = { found: 0, imported: 0, duplicate: 0, skipped: 0, rejected: 0, manual_review: 0 };
      const reasons: string[] = [];
      const skipBreakdown: Record<string, number> = {};
      const manualBreakdown: Record<string, number> = {};
      const rejectBreakdown: Record<string, number> = {};
      const bumpSkip = (k: string) => { skipBreakdown[k] = (skipBreakdown[k] ?? 0) + 1; };
      const bumpManual = (k: string) => { manualBreakdown[k] = (manualBreakdown[k] ?? 0) + 1; };
      const bumpReject = (k: string) => { rejectBreakdown[k] = (rejectBreakdown[k] ?? 0) + 1; };
      let success = true;
      let message = "";

      if (!det.supported || !det.slug) {
        success = false;
        message = det.reason || "Unsupported ATS";
        counts.rejected = 1;
        bumpReject("unsupported_ats");
      } else {
        try {
          const jobs = await fetchByPlatform(det.platform as SupportedAts, det.slug);
          counts.found = jobs.length;

          // Ensure company row exists + run trust verification
          let companyId: string | null = null;
          {
            const { data: existing } = await supabase.from("companies")
              .select("id, trust_score, verification_status")
              .eq("user_id", userId).eq("name", src.name).maybeSingle();
            if (existing) {
              companyId = existing.id;
            } else {
              const trust = computeTrustScore({
                has_official_site: true,
                has_careers_page: true,
                has_linkedin: false,
                ats_domain_match: true,
                business_footprint_score: 60,
                news_signals_count: 1,
                description: src.notes,
              });
              const { data: co } = await supabase.from("companies").insert({
                user_id: userId,
                name: src.name,
                careers_url: src.careers_url,
                trust_score: trust.score,
                verification_status: trust.decision,
                red_flags: trust.red_flags,
                has_linkedin: false,
                hiring_activity: 60,
              }).select("id").single();
              companyId = co?.id ?? null;
            }
          }

          for (const j of jobs) {
            // ---- HARD REJECTS (do not insert) ----
            const blockers = hasAccessBlockers(j.description_text);
            if (blockers.length) {
              counts.rejected++; bumpReject("access_blocker");
              reasons.push(`reject:${j.title} (${blockers.join(",")})`); continue;
            }
            const scam = detectScamFlags(j.description_text);
            if (scam.length) { counts.rejected++; bumpReject("scam_flag"); continue; }

            const titleLc = j.title.toLowerCase();
            const descLc = j.description_text.toLowerCase();
            if (/\b(intern|internship|unpaid|commission[- ]only)\b/.test(titleLc) ||
                /\bcommission[- ]only\b/.test(descLc) || /\bunpaid\b/.test(descLc)) {
              counts.rejected++; bumpReject("internship_unpaid_commission"); continue;
            }

            const postedMs = j.posted_at ? new Date(j.posted_at).getTime() : null;
            if (postedMs != null && postedMs < staleCutoffMs) {
              counts.rejected++; bumpReject("stale_gt_14d"); continue;
            }

            // Dedupe (hard reject — already in DB)
            const dedupe = dedupeHash(src.name, j.title, j.location, j.url);
            const { data: dup } = await supabase.from("job_listings")
              .select("id").eq("user_id", userId).eq("dedupe_hash", dedupe).maybeSingle();
            if (dup) { counts.duplicate++; bumpReject("duplicate"); continue; }

            // ---- SOFT GATES (insert and route to Manual Review) ----
            const manualReasons: string[] = [];

            const remote = isRemote(j.description_text, j.location);
            if (!remote) manualReasons.push("not_remote");

            const enrichment = (await import("./salary-estimator")).enrichSalary({
              title: j.title,
              description: j.description_text,
              remote: true,
              companyCategory: null,
              companyName: src.name,
              location: j.location,
              postedMin: j.salary_min,
              postedMax: j.salary_max,
            });
            if (enrichment.gate_status === "reject") manualReasons.push("salary_below_floor");
            else if (enrichment.gate_status === "manual") manualReasons.push("salary_needs_review");
            if ((enrichment.confidence === "low" || enrichment.confidence === "unknown") &&
                !manualReasons.includes("salary_needs_review")) {
              manualReasons.push("low_salary_confidence");
            }

            if (postedMs == null) manualReasons.push("missing_posted_date");

            const role = inferRoleCategory(j.title);
            const portfolio = projectsForRole(role).length > 0;
            const roleMatched = role !== "Operations Analyst" || /operations|ops/.test(titleLc);
            if (!roleMatched) manualReasons.push("category_uncertain");

            // Resume ↔ role fit (years, seniority, domain, specialty blocks).
            const fit = evaluateResumeFit({
              title: j.title, description: j.description_text, role_category: role,
            });
            if (fit.realism === "unrealistic") manualReasons.push("unrealistic_career_fit");
            else if (fit.realism === "stretch") manualReasons.push("stretch_role_fit");
            if (fit.role_fit_tier === "weak") manualReasons.push("weak_role_fit");
            fit.blockers.forEach((b) => manualReasons.push(b));

            const effectiveSalaryMin =
              enrichment.posted_min ?? enrichment.estimated_min ?? null;
            const interview = computeInterviewProbability({
              resume_match: fit.resume_match, skills_match: fit.role_fit_score,
              salary_min: effectiveSalaryMin,
              experience_fit: Math.max(0, 100 - fit.seniority_gap * 20), remote,
              ats: det.platform,
              has_education_match: true, mba_relevant: false,
              portfolio_relevant: portfolio,
              profile_strength: 90, hiring_activity: 60,
            });
            const toManualReview = manualReasons.length > 0;
            const ready = !toManualReview && isReadyToApply({
              trust_score: 90,
              interview_probability: interview.score,
              salary_min: effectiveSalaryMin,
              remote, ats: det.platform,
            });

            // Map salary_source to a DB-allowed value (never let constraint kill an insert).
            const mappedSource = mapSalarySource(enrichment.source);
            if (mappedSource.mapped) {
              manualReasons.push(`mapped_salary_source:${mappedSource.original ?? "null"}`);
            }

            // OpenAI health -> packet generation gating
            const aiHealth = await isOpenAiHealthy();
            if (!aiHealth.ok) {
              manualReasons.push("invalid_openai_key");
              manualReasons.push("packet_generation_disabled");
            }

            const toManualReviewFinal = manualReasons.length > 0;
            const finalReady = !toManualReviewFinal && ready;

            const { error: insErr } = await supabase.from("job_listings").insert({
              user_id: userId,
              company_id: companyId,
              company_name: src.name,
              title: j.title,
              location: j.location,
              remote,
              salary_min: j.salary_min,
              salary_max: j.salary_max,
              salary_estimated: j.salary_estimated,
              salary_posted_min: enrichment.posted_min,
              salary_posted_max: enrichment.posted_max,
              salary_source: mappedSource.value,
              salary_confidence: enrichment.confidence,
              salary_estimated_min: enrichment.estimated_min,
              salary_estimated_max: enrichment.estimated_max,
              salary_gate_status: enrichment.gate_status,
              salary_gate_reason: enrichment.gate_reason,
              salary_evidence: enrichment.evidence,
              ats: det.platform,
              source_url: j.url,
              description: j.description_text,
              role_category: role,
              category: "saas" as any,
              dedupe_hash: dedupe,
              posted_at: j.posted_at,
              interview_probability: interview.score,
              resume_match: 75,
              legitimacy: 90,
              final_score: interview.score,
              ready_to_apply: finalReady,
              status: toManualReviewFinal ? "manual_review" : "new",
              blockers: manualReasons,
            } as any);

            if (insErr) {
              if (insErr.code === "23505") { counts.duplicate++; bumpReject("duplicate"); continue; }
              counts.skipped++; bumpSkip(`insert_error:${insErr.code ?? "unknown"}`);
              reasons.push(
                `insert_error code=${insErr.code ?? "?"} ` +
                `title="${j.title}" company="${src.name}" ` +
                `msg="${(insErr.message ?? "").slice(0, 240)}" ` +
                `details="${((insErr as any).details ?? "").toString().slice(0, 160)}"`
              );
              continue;
            }
            // Count every successful insert as imported (manual_review still tracked separately).
            counts.imported++;
            if (toManualReviewFinal) {
              counts.manual_review++;
              manualReasons.forEach(bumpManual);
            }
          }

          await supabase.from("job_sources").update({
            last_imported_at: new Date().toISOString(),
            last_import_count: counts.imported,
          }).eq("id", src.id);
        } catch (e: any) {
          success = false;
          message = e?.message || "Fetch failed";
        }
      }

      // Aggregate
      (Object.keys(counts) as (keyof typeof counts)[]).forEach((k) => totals[k] += counts[k]);

      if (!message && counts.found > 0 && counts.imported === 0 && counts.manual_review === 0) {
        message = "All fetched jobs were hard-rejected or duplicates";
      }

      const { data: log } = await supabase.from("import_logs").insert({
        user_id: userId,
        source_id: src.id,
        source_url: src.careers_url,
        ats: det.platform,
        ...counts,
        success,
        message,
        details: {
          reasons: reasons.slice(0, 20),
          skip_breakdown: skipBreakdown,
          manual_breakdown: manualBreakdown,
          reject_breakdown: rejectBreakdown,
        },
      }).select().single();
      runs.push(log);
    }

    return { runs, totals };
  });

export const detectAtsFromUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ url: z.string().url() }).parse(d))
  .handler(async ({ data }) => detectAts(data.url));

// ---------- Default seed sources ---------- //
const DEFAULT_SOURCES: Array<{ name: string; careers_url: string }> = [
  { name: "Stripe",     careers_url: "https://boards.greenhouse.io/stripe" },
  { name: "Airbnb",     careers_url: "https://boards.greenhouse.io/airbnb" },
  { name: "Dropbox",    careers_url: "https://boards.greenhouse.io/dropbox" },
  { name: "Plaid",      careers_url: "https://boards.greenhouse.io/plaid" },
  { name: "Brex",       careers_url: "https://boards.greenhouse.io/brex" },
  { name: "Ramp",       careers_url: "https://jobs.ashbyhq.com/ramp" },
  { name: "Linear",     careers_url: "https://jobs.ashbyhq.com/Linear" },
  { name: "OpenAI",     careers_url: "https://jobs.ashbyhq.com/openai" },
  { name: "PostHog",    careers_url: "https://jobs.ashbyhq.com/posthog" },
  { name: "Netflix",    careers_url: "https://jobs.lever.co/netflix" },
];

export const seedDefaultJobSources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: existing } = await supabase
      .from("job_sources").select("name").eq("user_id", userId);
    const have = new Set((existing ?? []).map((r: any) => r.name.toLowerCase()));

    const toInsert = DEFAULT_SOURCES
      .filter((s) => !have.has(s.name.toLowerCase()))
      .map((s) => {
        const det = detectAts(s.careers_url);
        return {
          user_id: userId,
          name: s.name,
          careers_url: s.careers_url,
          ats: det.platform,
          status: det.supported ? "active" : "rejected",
          notes: det.reason ?? null,
        };
      });

    if (toInsert.length === 0) {
      return { inserted: 0, skipped: DEFAULT_SOURCES.length, total: existing?.length ?? 0 };
    }
    const { data, error } = await supabase.from("job_sources").insert(toInsert as any).select();
    if (error) throw new Error(error.message);
    return {
      inserted: data?.length ?? 0,
      skipped: DEFAULT_SOURCES.length - toInsert.length,
      total: (existing?.length ?? 0) + (data?.length ?? 0),
    };
  });

export const testSourceFetch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ source_id: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let q = supabase.from("job_sources").select("*").eq("user_id", userId).eq("status", "active");
    if (data.source_id) q = q.eq("id", data.source_id);
    const { data: sources } = await q.limit(10);
    if (!sources || sources.length === 0) {
      return { ok: false, results: [], error: "No active sources found. Click 'Seed Default Sources'." };
    }
    const results: any[] = [];
    for (const src of sources) {
      const det = detectAts(src.careers_url);
      if (!det.supported || !det.slug) {
        results.push({ name: src.name, ats: det.platform, ok: false, count: 0, error: det.reason });
        continue;
      }
      try {
        const jobs = await fetchByPlatform(det.platform as SupportedAts, det.slug);
        results.push({ name: src.name, ats: det.platform, ok: true, count: jobs.length, sample: jobs[0]?.title ?? null });
      } catch (e: any) {
        results.push({ name: src.name, ats: det.platform, ok: false, count: 0, error: e?.message || String(e) });
      }
    }
    return { ok: true, results };
  });

// ---------- DEEP DEBUG ---------- //

/**
 * Runs ONE source end-to-end with a full per-step trace.
 * If `bypass_filters` is true: skips salary/freshness/category/remote/blocker gates
 * and imports up to 5 raw jobs to verify DB writes work.
 */
export const deepDebugSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      source_id: z.string().uuid().optional(),
      bypass_filters: z.boolean().optional(),
    }).parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const runtime = {
      location: "server_function",
      project_url: process.env.SUPABASE_URL ?? null,
      project_ref: (process.env.SUPABASE_URL ?? "").match(/https:\/\/([^.]+)/)?.[1] ?? null,
      node_env: typeof process !== "undefined" ? "server" : "browser",
    };

    // Pick source
    let q = supabase.from("job_sources").select("*").eq("user_id", userId).eq("status", "active");
    if (data.source_id) q = q.eq("id", data.source_id);
    const { data: sources, error: srcErr } = await q.limit(1);
    if (srcErr) return { ok: false, runtime, error: `source query failed: ${srcErr.message}` };
    const src = sources?.[0];
    if (!src) return { ok: false, runtime, error: "No active source found. Seed default sources first." };

    const trace: any = {
      source: { id: src.id, name: src.name, careers_url: src.careers_url, ats: src.ats },
      bypass_filters: !!data.bypass_filters,
      steps: [] as any[],
    };

    // Step 1: detect ATS
    const det = detectAts(src.careers_url);
    trace.steps.push({
      step: "detect_ats",
      ok: det.supported,
      platform: det.platform,
      slug: det.slug,
      reason: det.reason ?? null,
    });
    if (!det.supported || !det.slug) {
      return { ok: false, runtime, trace, error: det.reason ?? "Unsupported ATS" };
    }

    // Step 2: raw HTTP fetch — capture URL, status, byte size
    const urlByPlatform: Record<SupportedAts, string> = {
      Greenhouse: `https://boards-api.greenhouse.io/v1/boards/${det.slug}/jobs?content=true`,
      Lever:      `https://api.lever.co/v0/postings/${det.slug}?mode=json`,
      Ashby:      `https://api.ashbyhq.com/posting-api/job-board/${det.slug}?includeCompensation=true`,
      Breezy:     `https://${det.slug}.breezy.hr/json`,
    };
    const requestUrl = urlByPlatform[det.platform as SupportedAts];
    let httpStatus: number | null = null;
    let bodyText = "";
    let fetchOk = false;
    let fetchError: string | null = null;
    try {
      const r = await fetch(requestUrl);
      httpStatus = r.status;
      bodyText = await r.text();
      fetchOk = r.ok;
      if (!r.ok) fetchError = `HTTP ${r.status}`;
    } catch (e: any) {
      fetchError = e?.message || String(e);
    }
    trace.steps.push({
      step: "http_fetch",
      ok: fetchOk,
      request_url: requestUrl,
      http_status: httpStatus,
      bytes: bodyText.length,
      error: fetchError,
      failure_reason: !fetchOk
        ? (fetchError?.includes("CORS") ? "CORS blocked"
          : httpStatus === 404 ? "empty response / 404"
          : httpStatus === 0 ? "fetch failed (network)"
          : "fetch failed")
        : null,
    });
    if (!fetchOk) return { ok: false, runtime, trace, error: fetchError ?? "fetch failed" };

    // Step 3: parse
    let jobs: NormJob[] = [];
    let parseError: string | null = null;
    try {
      jobs = await fetchByPlatform(det.platform as SupportedAts, det.slug);
    } catch (e: any) {
      parseError = e?.message || String(e);
    }
    trace.steps.push({
      step: "parse",
      ok: parseError == null,
      jobs_returned: jobs.length,
      error: parseError,
      failure_reason: parseError ? "parser failed / schema mismatch" : (jobs.length === 0 ? "empty response" : null),
    });
    if (parseError) return { ok: false, runtime, trace, error: parseError };

    // Step 3.5: raw preview — first 3 jobs as fetched, BEFORE filters
    trace.raw_preview = jobs.slice(0, 3).map((j) => ({
      external_id: j.external_id,
      title: j.title,
      location: j.location,
      url: j.url,
      posted_at: j.posted_at,
      salary_min: j.salary_min,
      salary_max: j.salary_max,
      description_excerpt: (j.description_text || "").slice(0, 240),
    }));

    if (jobs.length === 0) {
      return { ok: false, runtime, trace, error: "empty response — 0 jobs returned" };
    }

    // Step 4: import
    const toProcess = data.bypass_filters ? jobs.slice(0, 5) : jobs;
    const filterCounts = { not_remote: 0, blockers: 0, scam: 0, salary_reject: 0 };
    const importCounts = { attempted: 0, inserted: 0, duplicate: 0, db_failed: 0, filtered: 0 };
    const insertErrors: string[] = [];

    // Ensure company exists
    let companyId: string | null = null;
    const { data: existingCo } = await supabase.from("companies")
      .select("id").eq("user_id", userId).eq("name", src.name).maybeSingle();
    if (existingCo) companyId = existingCo.id;
    else {
      const { data: co } = await supabase.from("companies").insert({
        user_id: userId, name: src.name, careers_url: src.careers_url,
        trust_score: 90, verification_status: "verified", red_flags: [], has_linkedin: false, hiring_activity: 60,
      }).select("id").single();
      companyId = co?.id ?? null;
    }

    for (const j of toProcess) {
      if (!data.bypass_filters) {
        const blockers = hasAccessBlockers(j.description_text);
        if (blockers.length) { filterCounts.blockers++; importCounts.filtered++; continue; }
        const scam = detectScamFlags(j.description_text);
        if (scam.length) { filterCounts.scam++; importCounts.filtered++; continue; }
        const remote = isRemote(j.description_text, j.location);
        if (!remote) { filterCounts.not_remote++; importCounts.filtered++; continue; }
      }
      importCounts.attempted++;
      const dedupe = dedupeHash(src.name, j.title, j.location, j.url);
      const { data: dup } = await supabase.from("job_listings")
        .select("id").eq("user_id", userId).eq("dedupe_hash", dedupe).maybeSingle();
      if (dup) { importCounts.duplicate++; continue; }

      const { error: insErr } = await supabase.from("job_listings").insert({
        user_id: userId,
        company_id: companyId,
        company_name: src.name,
        title: j.title,
        location: j.location,
        remote: true,
        salary_min: j.salary_min,
        salary_max: j.salary_max,
        salary_estimated: j.salary_estimated,
        salary_source: j.salary_min != null ? "posted_salary" : "missing",
        salary_confidence: j.salary_min != null ? "high" : "unknown",
        salary_gate_status: data.bypass_filters ? "manual" : (j.salary_min != null && j.salary_min >= 55000 ? "pass" : "manual"),
        salary_gate_reason: data.bypass_filters ? "bypass_filters debug import" : null,
        ats: det.platform,
        source_url: j.url,
        description: j.description_text,
        role_category: inferRoleCategory(j.title),
        category: "saas" as any,
        dedupe_hash: dedupe,
        posted_at: j.posted_at,
        interview_probability: 50,
        resume_match: 70,
        legitimacy: 90,
        final_score: 50,
        ready_to_apply: false,
        status: "manual_review",
        blockers: data.bypass_filters ? ["bypass_filters_debug"] : [],
      } as any);

      if (insErr) {
        if (insErr.code === "23505") { importCounts.duplicate++; continue; }
        importCounts.db_failed++;
        insertErrors.push(insErr.message);
      } else {
        importCounts.inserted++;
      }
    }

    trace.steps.push({
      step: "import",
      ok: importCounts.db_failed === 0,
      processed: toProcess.length,
      filtered: importCounts.filtered,
      filter_breakdown: filterCounts,
      attempted: importCounts.attempted,
      inserted: importCounts.inserted,
      duplicate: importCounts.duplicate,
      db_failed: importCounts.db_failed,
      insert_errors: insertErrors.slice(0, 5),
      failure_reason:
        importCounts.inserted === 0 && toProcess.length > 0
          ? (importCounts.filtered === toProcess.length ? "all jobs filtered before insert"
            : importCounts.db_failed > 0 ? "database insert failed"
            : importCounts.duplicate === toProcess.length ? "all duplicates"
            : null)
          : null,
    });

    // Step 5: DB write verification — count rows for this source now
    const { count: dbCount } = await supabase.from("job_listings")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("company_name", src.name);

    trace.steps.push({
      step: "db_verify",
      total_rows_for_source: dbCount ?? 0,
      ok: (dbCount ?? 0) > 0,
    });

    return { ok: true, runtime, trace };
  });

/**
 * Inserts ONE hardcoded mock verified job directly into job_listings.
 * If this row appears in diagnostics, the DB layer + RLS are healthy and any
 * "0 imports" issue is at the fetch / parse / filter layer.
 */
export const insertMockTestJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const stamp = Date.now();
    const row = {
      user_id: userId,
      company_name: "Mock Co (debug)",
      title: `Debug Verified Job ${stamp}`,
      location: "Remote",
      remote: true,
      salary_min: 95000,
      salary_max: 130000,
      salary_posted_min: 95000,
      salary_posted_max: 130000,
      salary_estimated: false,
      salary_source: "posted_salary",
      salary_confidence: "high",
      salary_gate_status: "pass",
      salary_gate_reason: "Mock test job ($95k–$130k)",
      salary_evidence: ["mock_debug_insert"],
      ats: "Greenhouse",
      source_url: `https://example.com/debug/${stamp}`,
      description: "Mock job inserted from deep-debug panel to verify DB write path.",
      role_category: "Operations Analyst",
      category: "saas" as any,
      dedupe_hash: `mock-debug-${stamp}`,
      posted_at: new Date().toISOString(),
      interview_probability: 80,
      resume_match: 85,
      legitimacy: 95,
      final_score: 82,
      ready_to_apply: true,
      status: "new",
      blockers: [],
    };
    const { data, error } = await supabase.from("job_listings").insert(row as any).select("id").single();
    if (error) return { ok: false, error: error.message, code: error.code, project_ref: (process.env.SUPABASE_URL ?? "").match(/https:\/\/([^.]+)/)?.[1] ?? null };
    return { ok: true, id: data.id, project_ref: (process.env.SUPABASE_URL ?? "").match(/https:\/\/([^.]+)/)?.[1] ?? null };
  });


export const getSmartApplyDiagnostics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [srcRes, logsRes, jobsRes, salaryRes] = await Promise.all([
      supabase.from("job_sources").select("*").eq("user_id", userId),
      supabase.from("import_logs").select("*").eq("user_id", userId)
        .order("created_at", { ascending: false }).limit(20),
      supabase.from("job_listings").select("id", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("job_listings")
        .select("salary_source, salary_confidence, salary_gate_status")
        .eq("user_id", userId).limit(1000),
    ]);
    const sources = srcRes.data ?? [];
    const active = sources.filter((s: any) => s.status === "active");
    const logs = logsRes.data ?? [];

    // Aggregate from most recent run set (same created_at second window)
    const lastRunTs = logs[0]?.created_at;
    const lastRun = logs.filter((l: any) =>
      lastRunTs && Math.abs(new Date(l.created_at).getTime() - new Date(lastRunTs).getTime()) < 60_000
    );
    const totals = lastRun.reduce(
      (acc: any, l: any) => {
        acc.found += l.found ?? 0;
        acc.imported += l.imported ?? 0;
        acc.manual_review += l.manual_review ?? 0;
        acc.duplicate += l.duplicate ?? 0;
        acc.rejected += l.rejected ?? 0;
        acc.skipped += l.skipped ?? 0;
        if (!l.success && l.message) acc.errors.push(`${l.ats}: ${l.message}`);
        for (const r of (l.details?.reasons ?? [])) acc.reasons.push(r);
        return acc;
      },
      { found: 0, imported: 0, manual_review: 0, duplicate: 0, rejected: 0, skipped: 0, errors: [] as string[], reasons: [] as string[] }
    );

    // Top rejection reason
    const reasonCounts = new Map<string, number>();
    for (const r of totals.reasons) {
      const key = r.replace(/^[^:]+:/, "").replace(/\s*\([^)]*\)\s*$/, "").trim().slice(0, 80);
      const cat = r.split(":")[0];
      const k = `${cat}: ${key}`;
      reasonCounts.set(k, (reasonCounts.get(k) ?? 0) + 1);
    }
    const topRejection = [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([reason, count]) => ({ reason, count }));

    // Salary enrichment breakdown
    const salaryRows = salaryRes.data ?? [];
    const salaryBreakdown = {
      total: salaryRows.length,
      posted_pass: salaryRows.filter((r: any) => r.salary_source === "posted_salary" && r.salary_gate_status === "pass").length,
      estimated_pass: salaryRows.filter((r: any) => r.salary_source !== "posted_salary" && r.salary_source !== "missing" && r.salary_gate_status === "pass").length,
      manual_low_confidence: salaryRows.filter((r: any) => r.salary_gate_status === "manual").length,
      rejected_below_floor: salaryRows.filter((r: any) => r.salary_gate_status === "reject").length,
      missing: salaryRows.filter((r: any) => r.salary_source === "missing").length,
    };

    return {
      enabled_sources: active.length,
      total_sources: sources.length,
      source_names: active.map((s: any) => ({ id: s.id, name: s.name, ats: s.ats, status: s.status })),
      total_jobs_in_db: jobsRes.count ?? 0,
      last_run_at: lastRunTs ?? null,
      last_run: totals,
      top_rejection: topRejection,
      salary: salaryBreakdown,
    };
  });
