import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { detectAts, parseSalary, stripHtml, hasAccessBlockers, isRemote, type SupportedAts } from "./ats-detect";
import { computeTrustScore, computeInterviewProbability, isReadyToApply, SUPPORTED_ATS, SALARY_FLOOR } from "./scoring";
import { detectScamFlags } from "./scam-signals";
import { projectsForRole } from "./portfolio";

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

    for (const src of sources) {
      const det = detectAts(src.careers_url);
      const counts = { found: 0, imported: 0, duplicate: 0, skipped: 0, rejected: 0, manual_review: 0 };
      const reasons: string[] = [];
      let success = true;
      let message = "";

      if (!det.supported || !det.slug) {
        success = false;
        message = det.reason || "Unsupported ATS";
        counts.rejected = 1;
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
            // Reject jobs with login/captcha/MFA language
            const blockers = hasAccessBlockers(j.description_text);
            if (blockers.length) { counts.rejected++; reasons.push(`reject:${j.title} (${blockers.join(",")})`); continue; }
            // Reject scam content
            const scam = detectScamFlags(j.description_text);
            if (scam.length) { counts.rejected++; reasons.push(`reject:${j.title} (scam)`); continue; }

            // Remote-only filter
            const remote = isRemote(j.description_text, j.location);
            if (!remote) { counts.skipped++; reasons.push(`skip:${j.title} (not remote)`); continue; }

            // Salary enrichment + confidence-aware gate
            const enrichment = (await import("./salary-estimator")).enrichSalary({
              title: j.title,
              description: j.description_text,
              remote: true,
              companyCategory: null,
              postedMin: j.salary_min,
              postedMax: j.salary_max,
            });
            if (enrichment.gate_status === "reject") {
              counts.skipped++;
              reasons.push(`skip:${j.title} (${enrichment.gate_reason})`);
              continue;
            }
            const toManualReview = enrichment.gate_status === "manual";

            // Dedupe
            const dedupe = dedupeHash(src.name, j.title, j.location, j.url);
            const { data: dup } = await supabase.from("job_listings")
              .select("id").eq("user_id", userId).eq("dedupe_hash", dedupe).maybeSingle();
            if (dup) { counts.duplicate++; continue; }

            const role = inferRoleCategory(j.title);
            const portfolio = projectsForRole(role).length > 0;
            const effectiveSalaryMin =
              enrichment.posted_min ?? enrichment.estimated_min ?? null;
            const interview = computeInterviewProbability({
              resume_match: 75,
              skills_match: 75,
              salary_min: effectiveSalaryMin,
              experience_fit: 80,
              remote: true,
              ats: det.platform,
              has_education_match: true,
              mba_relevant: false,
              portfolio_relevant: portfolio,
              profile_strength: 90,
              hiring_activity: 60,
            });
            const ready = !toManualReview && isReadyToApply({
              trust_score: 90,
              interview_probability: interview.score,
              salary_min: effectiveSalaryMin,
              remote: true,
              ats: det.platform,
            });

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
              salary_source: enrichment.source,
              salary_confidence: enrichment.confidence,
              salary_estimated_min: enrichment.estimated_min,
              salary_estimated_max: enrichment.estimated_max,
              salary_gate_status: enrichment.gate_status,
              salary_gate_reason: enrichment.gate_reason,
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
              ready_to_apply: ready,
              status: toManualReview ? "manual_review" : "new",
              blockers: toManualReview ? ["salary_needs_review"] : [],
            } as any);

            if (insErr) {
              if (insErr.code === "23505") { counts.duplicate++; continue; }
              counts.skipped++; reasons.push(`err:${j.title} ${insErr.message}`); continue;
            }
            if (toManualReview) counts.manual_review++;
            else counts.imported++;
          }

          await supabase.from("job_sources").update({
            last_imported_at: new Date().toISOString(),
            last_import_count: counts.imported + counts.manual_review,
          }).eq("id", src.id);
        } catch (e: any) {
          success = false;
          message = e?.message || "Fetch failed";
        }
      }

      // Aggregate
      (Object.keys(counts) as (keyof typeof counts)[]).forEach((k) => totals[k] += counts[k]);

      const { data: log } = await supabase.from("import_logs").insert({
        user_id: userId,
        source_id: src.id,
        source_url: src.careers_url,
        ats: det.platform,
        ...counts,
        success,
        message,
        details: { reasons: reasons.slice(0, 20) },
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

export const getSmartApplyDiagnostics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [srcRes, logsRes, jobsRes] = await Promise.all([
      supabase.from("job_sources").select("*").eq("user_id", userId),
      supabase.from("import_logs").select("*").eq("user_id", userId)
        .order("created_at", { ascending: false }).limit(20),
      supabase.from("job_listings").select("id", { count: "exact", head: true }).eq("user_id", userId),
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

    return {
      enabled_sources: active.length,
      total_sources: sources.length,
      source_names: active.map((s: any) => ({ name: s.name, ats: s.ats, status: s.status })),
      total_jobs_in_db: jobsRes.count ?? 0,
      last_run_at: lastRunTs ?? null,
      last_run: totals,
      top_rejection: topRejection,
    };
  });
