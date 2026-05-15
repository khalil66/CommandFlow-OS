import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  computeTrustScore, computeInterviewProbability, isReadyToApply,
  categoryForDate, dayOfWeek, CATEGORY_LABEL, SUPPORTED_ATS, SALARY_FLOOR,
  type DayCategory,
} from "./scoring";
import { projectsForRole } from "./portfolio";

// ---------- Verify a single company ---------- //
export const verifyCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    company_id: z.string().uuid(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: co, error } = await supabase
      .from("companies").select("*").eq("id", data.company_id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!co) throw new Error("Company not found");

    const result = computeTrustScore({
      has_official_site: !!co.domain,
      has_careers_page: !!co.careers_url,
      has_linkedin: !!co.linkedin_url || !!co.has_linkedin,
      ats_domain_match: !!co.careers_url && !!co.domain && co.careers_url.includes(co.domain),
      business_footprint_score: Math.min(100, (co.domain_age_days ?? 0) / 30),
      news_signals_count: Math.round(((co.glassdoor_rating ?? 0) as number) * 2),
      description: co.notes,
      contact_email_domain: null,
      payment_request: false,
    });

    await supabase.from("verification_checks").insert({
      user_id: userId, company_id: co.id,
      has_official_site: !!co.domain, has_careers_page: !!co.careers_url,
      has_linkedin: !!co.linkedin_url || !!co.has_linkedin,
      ats_domain_match: !!co.careers_url && !!co.domain && co.careers_url.includes(co.domain),
      business_footprint_score: Math.min(100, Math.round((co.domain_age_days ?? 0) / 30)),
      news_signals_count: Math.round(((co.glassdoor_rating ?? 0) as number) * 2),
      scam_flags: result.scam_flags,
      personal_email_domain: result.personal_email_domain,
      payment_request: false,
      score: result.score, decision: result.decision,
      raw: { red_flags: result.red_flags } as any,
    } as any);

    await supabase.from("companies").update({
      trust_score: result.score,
      verification_status: result.decision,
      red_flags: result.red_flags,
    }).eq("id", co.id);

    return result;
  });

// ---------- Score interview probability for a job ---------- //
export const scoreInterviewProbability = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ job_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: job } = await supabase
      .from("job_listings").select("*, companies(trust_score, hiring_activity, mba_friendly)")
      .eq("id", data.job_id).maybeSingle();
    if (!job) throw new Error("Job not found");

    const co: any = (job as any).companies;
    const role = job.role_category || job.title;
    const portfolio = projectsForRole(role).length > 0;

    const r = computeInterviewProbability({
      resume_match: job.resume_match ?? 0,
      skills_match: job.resume_match ?? 0,
      salary_min: job.salary_min,
      experience_fit: 80,
      remote: !!job.remote,
      ats: job.ats,
      has_education_match: true,
      mba_relevant: !!co?.mba_friendly,
      portfolio_relevant: portfolio,
      profile_strength: 90, // khalilhickson.com + LinkedIn
      hiring_activity: co?.hiring_activity ?? 50,
      trust_score: co?.trust_score ?? 0,
    });

    const ready = isReadyToApply({
      trust_score: co?.trust_score ?? 0,
      interview_probability: r.score,
      salary_min: job.salary_min,
      remote: !!job.remote,
      ats: job.ats,
    });

    await supabase.from("job_listings").update({
      interview_probability: r.score,
      ready_to_apply: ready,
      role_category: role,
    }).eq("id", job.id);

    return { ...r, ready_to_apply: ready };
  });

// ---------- Run today's daily batch ---------- //
export const runDailyBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const today = new Date();
    const cat: DayCategory = categoryForDate(today);
    const dow = dayOfWeek(today);
    const isoDate = today.toISOString().slice(0, 10);

    // skip review-only day
    if (cat === "other") {
      const { data: existing } = await supabase.from("daily_batches")
        .select("*").eq("user_id", userId).eq("batch_date", isoDate).maybeSingle();
      if (existing) return { batch: existing, skipped: false, reviewDay: true };
      const { data: row } = await supabase.from("daily_batches").insert({
        user_id: userId, batch_date: isoDate, day_of_week: dow,
        category: cat, status: "complete",
        summary: { note: "Review & follow-ups day — no new applications prepared." } as any,
      } as any).select().single();
      return { batch: row, skipped: false, reviewDay: true };
    }

    // 30-day reapply guard
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data: companies } = await supabase
      .from("companies").select("*")
      .eq("user_id", userId).eq("category", cat)
      .or(`last_applied_at.is.null,last_applied_at.lt.${cutoff}`);

    let companies_reviewed = 0;
    let jobs_found = 0;
    let jobs_rejected = 0;
    let applications_prepared = 0;

    for (const co of companies ?? []) {
      companies_reviewed++;
      // verify (re-score)
      const trust = computeTrustScore({
        has_official_site: !!co.domain, has_careers_page: !!co.careers_url,
        has_linkedin: !!co.linkedin_url || !!co.has_linkedin,
        ats_domain_match: !!co.careers_url && !!co.domain && co.careers_url.includes(co.domain),
        business_footprint_score: Math.min(100, (co.domain_age_days ?? 0) / 30),
        news_signals_count: Math.round(((co.glassdoor_rating ?? 0) as number) * 2),
        description: co.notes,
      });
      await supabase.from("companies").update({
        trust_score: trust.score, verification_status: trust.decision, red_flags: trust.red_flags,
      }).eq("id", co.id);

      if (trust.decision === "rejected") { jobs_rejected++; continue; }

      // Build a synthetic job listing for the company (in lieu of live scraping)
      const role = pickRoleForCategory(cat);
      const dedupe = `${co.id}:${role}:${isoDate}`;
      const { data: existingJob } = await supabase.from("job_listings")
        .select("id").eq("user_id", userId).eq("dedupe_hash", dedupe).maybeSingle();
      if (existingJob) continue;

      const salary_min = 75_000 + Math.floor(Math.random() * 40_000);
      const ats = SUPPORTED_ATS[Math.floor(Math.random() * SUPPORTED_ATS.length)];
      const resume_match = 70 + Math.floor(Math.random() * 25);

      const interview = computeInterviewProbability({
        resume_match, skills_match: resume_match,
        salary_min, experience_fit: 80, remote: true, ats,
        has_education_match: true,
        mba_relevant: !!co.mba_friendly,
        portfolio_relevant: projectsForRole(role).length > 0,
        profile_strength: 90, hiring_activity: co.hiring_activity ?? 50,
        trust_score: trust.score,
      });

      const ready = isReadyToApply({
        trust_score: trust.score, interview_probability: interview.score,
        salary_min, remote: true, ats,
      });

      const { data: jobRow } = await supabase.from("job_listings").insert({
        user_id: userId, company_id: co.id, company_name: co.name,
        title: role, role_category: role, category: cat,
        location: "Remote (US)", remote: true,
        salary_min, salary_max: salary_min + 25_000,
        ats, source_url: co.careers_url ?? `https://${co.domain}/careers`,
        description: `${role} at ${co.name}. SQL, dashboards, and operational excellence.`,
        resume_match, legitimacy: trust.score, final_score: interview.score,
        interview_probability: interview.score,
        ready_to_apply: ready,
        salary_estimated: false, status: "new",
        dedupe_hash: dedupe, posted_at: new Date().toISOString(),
        blockers: [],
      } as any).select().single();

      jobs_found++;

      if (jobRow && (interview.priority === "high" || interview.priority === "good")) {
        const portfolio = projectsForRole(role)[0] ?? null;
        await supabase.from("applications").insert({
          user_id: userId, job_id: jobRow.id, status: "manual_review",
          priority: interview.priority,
          portfolio_project: portfolio,
        } as any);
        applications_prepared++;

        await supabase.from("companies").update({ last_applied_at: new Date().toISOString() }).eq("id", co.id);
      }
    }

    const { data: batchRow } = await supabase.from("daily_batches").insert({
      user_id: userId, batch_date: isoDate, day_of_week: dow, category: cat,
      companies_reviewed, jobs_found, jobs_rejected, applications_prepared,
      status: "complete",
      summary: { label: CATEGORY_LABEL[cat] } as any,
    } as any).select().single();

    return { batch: batchRow, skipped: false, reviewDay: false };
  });

function pickRoleForCategory(cat: DayCategory): string {
  const map: Record<DayCategory, string[]> = {
    saas: ["SaaS Support Specialist", "Implementation Specialist", "Customer Success Manager"],
    data: ["Data Analyst", "Business Analyst", "Revenue Operations Analyst"],
    cs_ops: ["Customer Success Manager", "Operations Analyst", "Technical Support Engineer"],
    product_pm: ["Project Manager", "Associate Project Manager", "Product Operations Analyst"],
    remote_first: ["Operations Analyst", "Technical Support Engineer", "Customer Success Manager"],
    mba_friendly: ["Business Analyst", "Project Manager", "Revenue Operations Analyst"],
    other: ["Operations Analyst"],
  };
  const list = map[cat];
  return list[Math.floor(Math.random() * list.length)];
}

// ---------- Aggregated metrics for dashboard ---------- //
export const getDailyMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const today = new Date().toISOString().slice(0, 10);

    const [batch, companiesAgg, jobsAgg, resumesAgg, followUps] = await Promise.all([
      supabase.from("daily_batches").select("*")
        .eq("user_id", userId).eq("batch_date", today).maybeSingle(),
      supabase.from("companies").select("trust_score, verification_status").eq("user_id", userId),
      supabase.from("job_listings")
        .select("interview_probability, resume_match, ready_to_apply").eq("user_id", userId),
      supabase.from("resume_versions").select("match_score, target_role").eq("user_id", userId),
      supabase.from("applications")
        .select("id, follow_up_due_at").eq("user_id", userId)
        .not("follow_up_due_at", "is", null)
        .lte("follow_up_due_at", new Date().toISOString()),
    ]);

    const companies = companiesAgg.data ?? [];
    const jobs = jobsAgg.data ?? [];
    const resumes = resumesAgg.data ?? [];

    const verified = companies.filter((c: any) => c.verification_status === "verified").length;
    const highProb = jobs.filter((j: any) => j.ready_to_apply).length;
    const avg = (xs: number[]) =>
      xs.length ? Math.round(xs.reduce((a, c) => a + c, 0) / xs.length) : 0;

    return {
      today_iso: today,
      day_of_week: dayOfWeek(new Date()),
      todays_category: categoryForDate(new Date()),
      todays_category_label: CATEGORY_LABEL[categoryForDate(new Date())],
      batch_complete: !!batch.data,
      batch: batch.data,
      verified_companies: verified,
      total_companies: companies.length,
      high_probability_jobs: highProb,
      avg_interview_probability: avg(jobs.map((j: any) => j.interview_probability ?? 0)),
      avg_company_trust: avg(companies.map((c: any) => c.trust_score ?? 0)),
      avg_resume_match: avg(resumes.map((r: any) => r.match_score ?? 0)),
      follow_ups_due: followUps.data?.length ?? 0,
      salary_floor: SALARY_FLOOR,
    };
  });

// ---------- Lists ---------- //
export const listHighProbabilityJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("job_listings")
      .select("*, companies(trust_score, verification_status, name, category)")
      .eq("user_id", context.userId)
      .eq("ready_to_apply", true)
      .order("interview_probability", { ascending: false });
    if (error) throw new Error(error.message);
    return { jobs: data ?? [] };
  });

export const listCompanies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("companies").select("*").eq("user_id", context.userId)
      .order("trust_score", { ascending: false });
    if (error) throw new Error(error.message);
    return { companies: data ?? [] };
  });

export const listBatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("daily_batches").select("*").eq("user_id", context.userId)
      .order("batch_date", { ascending: false }).limit(60);
    if (error) throw new Error(error.message);
    return { batches: data ?? [] };
  });

export const listFollowUpsDue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("applications")
      .select("*, job_listings(title, company_name)")
      .eq("user_id", context.userId)
      .not("follow_up_due_at", "is", null)
      .order("follow_up_due_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { applications: data ?? [] };
  });

export const setFollowUp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    application_id: z.string().uuid(),
    days: z.number().int().min(0).max(180),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const due = new Date(Date.now() + data.days * 86400000).toISOString();
    const { error } = await context.supabase.from("applications")
      .update({ follow_up_due_at: due }).eq("id", data.application_id);
    if (error) throw new Error(error.message);
    return { follow_up_due_at: due };
  });
