// Smart Apply optimization layer:
// - Source ranking by historical performance
// - Follow-up task scheduling + management
// - Interview prep automation
// - Dashboard summary card data
// - Resume variant performance stats
// - Weekly learning report generation

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { freshnessBucket } from "./freshness";
import { RESUME_VARIANT_LABEL, type ResumeVariantKey } from "./qc-gate";

// =====================================================================
// SOURCE RANKING
// =====================================================================

export const recomputeSourcePriority = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: sources } = await (supabase as any).from("job_sources")
      .select("*").eq("user_id", userId);
    if (!sources?.length) return { ok: true, updated: 0 };

    // Aggregate per-ATS metrics from applications + safety logs.
    // (job_sources.ats is the join key.)
    const [{ data: apps }, { data: safety }] = await Promise.all([
      (supabase as any).from("applications")
        .select("status, response_received_at, interview_requested_at, rejected_at, job_listings!inner(ats, final_score)")
        .eq("user_id", userId),
      (supabase as any).from("automation_safety_logs")
        .select("ats, action").eq("user_id", userId).eq("action", "safety_blocked"),
    ]);

    const byAts = new Map<string, { total: number; resp: number; intv: number; rej: number; safety: number; q: number; high: number }>();
    const get = (k: string) => {
      let v = byAts.get(k);
      if (!v) { v = { total: 0, resp: 0, intv: 0, rej: 0, safety: 0, q: 0, high: 0 }; byAts.set(k, v); }
      return v;
    };
    for (const a of apps ?? []) {
      const ats = (a as any).job_listings?.ats ?? "";
      if (!ats) continue;
      const v = get(ats);
      v.total++;
      if (a.response_received_at) v.resp++;
      if (a.interview_requested_at) v.intv++;
      if (a.status === "rejected") v.rej++;
      const fs = (a as any).job_listings?.final_score ?? 0;
      v.q += fs;
      if (fs >= 85) v.high++;
    }
    for (const s of safety ?? []) {
      const ats = (s as any).ats ?? ""; if (!ats) continue;
      get(ats).safety++;
    }

    let updated = 0;
    for (const src of sources) {
      const v = byAts.get(src.ats ?? "") ?? { total: 0, resp: 0, intv: 0, rej: 0, safety: 0, q: 0, high: 0 };
      const total = Math.max(1, v.total);
      const responseRate = v.resp / total;
      const interviewRate = v.intv / total;
      const rejectionRate = v.rej / total;
      const safetyRate = v.safety / Math.max(1, v.total + v.safety);
      const qualityAvg = v.total > 0 ? v.q / v.total : 50;
      // Composite priority — higher = better
      const priority = Math.max(0, Math.min(100,
        50
        + responseRate * 40
        + interviewRate * 30
        + (qualityAvg - 50) * 0.4
        - rejectionRate * 10
        - safetyRate * 30
      ));
      await (supabase as any).from("job_sources").update({
        response_count: v.resp, interview_count: v.intv, rejection_count: v.rej,
        safety_block_count: v.safety, high_prob_count: v.high,
        quality_score_avg: +qualityAvg.toFixed(2),
        priority_score: +priority.toFixed(2),
        last_quality_recalc_at: new Date().toISOString(),
      }).eq("id", src.id);
      updated++;
    }
    return { ok: true, updated };
  });

export const getSourceRanking = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await (supabase as any).from("job_sources")
      .select("*").eq("user_id", userId)
      .order("priority_score", { ascending: false });
    return { sources: data ?? [] };
  });

// =====================================================================
// FOLLOW-UP TASKS
// =====================================================================

const FOLLOW_UP_KINDS = ["followup_5d", "followup_10d", "linkedin_connect"] as const;

export const scheduleFollowUps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ application_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: app } = await (supabase as any).from("applications")
      .select("id, job_id, user_id").eq("id", data.application_id).maybeSingle();
    if (!app || app.user_id !== userId) throw new Error("Application not found");

    const now = Date.now();
    const tasks = [
      { kind: "followup_5d", due_at: new Date(now + 5 * 86400000).toISOString() },
      { kind: "followup_10d", due_at: new Date(now + 10 * 86400000).toISOString() },
      { kind: "linkedin_connect", due_at: new Date(now + 3 * 86400000).toISOString() },
    ];
    // Avoid duplicates: delete pending tasks for the same app/kind first
    await (supabase as any).from("follow_up_tasks")
      .delete().eq("user_id", userId).eq("application_id", app.id).eq("status", "pending");
    const rows = tasks.map((t) => ({
      user_id: userId, application_id: app.id, job_id: app.job_id,
      kind: t.kind, due_at: t.due_at, status: "pending",
    }));
    await (supabase as any).from("follow_up_tasks").insert(rows);
    // Also set legacy follow_up_due_at on application for the existing UI
    await (supabase as any).from("applications")
      .update({ follow_up_due_at: tasks[0].due_at }).eq("id", app.id);
    return { ok: true, scheduled: rows.length };
  });

export const listFollowUpTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await (supabase as any).from("follow_up_tasks")
      .select("*, applications!inner(id, status, job_listings(title, company_name, source_url, ats))")
      .eq("user_id", userId)
      .order("due_at", { ascending: true })
      .limit(200);
    return { tasks: data ?? [] };
  });

export const completeFollowUpTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    task_id: z.string().uuid(),
    action: z.enum(["done", "dismiss", "snooze"]).default("done"),
    snooze_days: z.number().min(1).max(30).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.action === "snooze") {
      const days = data.snooze_days ?? 3;
      const newDue = new Date(Date.now() + days * 86400000).toISOString();
      await (supabase as any).from("follow_up_tasks")
        .update({ due_at: newDue }).eq("id", data.task_id).eq("user_id", userId);
      return { ok: true, snoozed: days };
    }
    await (supabase as any).from("follow_up_tasks")
      .update({
        status: data.action === "done" ? "done" : "dismissed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", data.task_id).eq("user_id", userId);
    return { ok: true };
  });

// =====================================================================
// INTERVIEW PREP AUTOMATION
// =====================================================================

const PREP_SYSTEM = `You are an interview prep generator. Output STRICT JSON.
Use only the proof points provided. Never invent metrics. No clichés. Be specific.`;

const PREP_SHAPE = `{
  "company_brief": string (3-5 sentences),
  "pitch_60s": string (60-second elevator pitch, ~150 words),
  "star_answers": [{"question": string, "situation": string, "task": string, "action": string, "result": string}, 3 items],
  "recruiter_questions": [string, 6 items],
  "technical_questions": [string, 6 items],
  "questions_to_ask": [string, 5 items],
  "salary_talking_points": string (3-5 sentences with anchor numbers + research)
}`;

const KHALIL_PROOF = `- 10,000+ Tier 2/3 support tickets analyzed (Zendesk + Salesforce)
- 25% reduction in escalations after triage redesign
- 91% CSAT sustained over 18 months
- 24-hour avg resolution on complex cases
- 92% SLA compliance across enterprise queues
- 50,000+ customer transactions analyzed
- $1.2M+ revenue analyzed in cohort + retention studies
- 35% efficiency improvement from forecasting + capacity models
- 92% forecasting accuracy on demand modeling
- MBA student, Jacksonville FL, remote-first`;

async function generatePrepBrief(args: {
  title: string; company: string; description: string;
  category: string | null; salary_min: number | null;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      company_brief: `Interview prep for ${args.title} at ${args.company}. Configure OPENAI_API_KEY to auto-generate detailed prep.`,
      pitch_60s: "I'm an MBA student with 5+ years across customer success and operations, specializing in turning support data into measurable efficiency gains.",
      star_answers: [],
      recruiter_questions: [
        "Walk me through your background.",
        "Why this role?",
        "What's your salary expectation?",
        "Why are you leaving your current role?",
        "Tell me about a time you led a process change.",
        "Where do you see yourself in 3 years?",
      ],
      technical_questions: [
        "How would you analyze a sudden CSAT drop?",
        "What metrics do you track for support efficiency?",
        "Describe your SQL/Tableau workflow.",
        "How do you build a forecasting model?",
        "How do you prioritize a queue with conflicting SLAs?",
        "Describe a dashboard you built leadership uses.",
      ],
      questions_to_ask: [
        "How is success measured in the first 90 days?",
        "What does the team's current workflow look like?",
        "How do data and ops collaborate here?",
        "What's the biggest challenge facing the team this quarter?",
        "How does the company support remote MBA students?",
      ],
      salary_talking_points: `Anchor on $${(args.salary_min ?? 65000).toLocaleString()}+ based on market data and 5+ years of measurable impact. Reference 25% escalation reduction and 35% efficiency gains as quantified value drivers.`,
    };
  }
  const userPrompt = `JOB: ${args.title} @ ${args.company}
CATEGORY: ${args.category ?? "general"}
SALARY FLOOR: $${args.salary_min ?? 55000}

JOB DESCRIPTION:
${(args.description ?? "").slice(0, 3500)}

KHALIL PROOF POINTS:
${KHALIL_PROOF}

Return JSON: ${PREP_SHAPE}`;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: PREP_SYSTEM }, { role: "user", content: userPrompt }],
      response_format: { type: "json_object" },
      temperature: 0.5,
    }),
  });
  if (!resp.ok) throw new Error(`OpenAI prep failed ${resp.status}`);
  const j = await resp.json();
  return JSON.parse(j.choices?.[0]?.message?.content ?? "{}");
}

export const markInterviewRequested = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ application_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: app } = await (supabase as any).from("applications")
      .select("*, job_listings(*)").eq("id", data.application_id).maybeSingle();
    if (!app || app.user_id !== userId) throw new Error("Application not found");

    await (supabase as any).from("applications").update({
      status: "interview_requested",
      interview_requested_at: new Date().toISOString(),
      response_received_at: app.response_received_at ?? new Date().toISOString(),
    }).eq("id", app.id);

    let brief: any;
    try {
      brief = await generatePrepBrief({
        title: app.job_listings?.title ?? "Role",
        company: app.job_listings?.company_name ?? "Company",
        description: app.job_listings?.description ?? "",
        category: app.job_listings?.role_category ?? null,
        salary_min: app.job_listings?.salary_min ?? null,
      });
    } catch (e: any) {
      brief = { _error: e.message };
    }

    await (supabase as any).from("interview_prep").insert({
      user_id: userId, application_id: app.id, job_id: app.job_id,
      brief: { company_brief: brief.company_brief, raw: brief },
      pitch_60s: brief.pitch_60s ?? null,
      star_answers: brief.star_answers ?? [],
      recruiter_questions: brief.recruiter_questions ?? [],
      technical_questions: brief.technical_questions ?? [],
      questions_to_ask: brief.questions_to_ask ?? [],
      salary_talking_points: brief.salary_talking_points ?? null,
    });

    return { ok: true, prep_generated: !brief._error };
  });

export const getInterviewPrep = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ application_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: prep } = await (supabase as any).from("interview_prep")
      .select("*").eq("user_id", userId).eq("application_id", data.application_id)
      .order("generated_at", { ascending: false }).limit(1).maybeSingle();
    return { prep };
  });

// =====================================================================
// RESUME VARIANT STATS
// =====================================================================

export const getResumeVariantStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: apps } = await (supabase as any).from("applications")
      .select("resume_variant_key, status, response_received_at, interview_requested_at, offer_at")
      .eq("user_id", userId)
      .not("resume_variant_key", "is", null);
    const byVariant = new Map<string, { total: number; submitted: number; response: number; interview: number; offer: number; rejected: number }>();
    for (const a of apps ?? []) {
      const k = a.resume_variant_key as string;
      let v = byVariant.get(k);
      if (!v) { v = { total: 0, submitted: 0, response: 0, interview: 0, offer: 0, rejected: 0 }; byVariant.set(k, v); }
      v.total++;
      if (["submitted", "submitted_manually", "interview_requested", "interview", "offer", "rejected"].includes(a.status)) v.submitted++;
      if (a.response_received_at) v.response++;
      if (a.interview_requested_at) v.interview++;
      if (a.offer_at) v.offer++;
      if (a.status === "rejected") v.rejected++;
    }
    const variants = [...byVariant.entries()].map(([key, v]) => ({
      variant: key as ResumeVariantKey,
      label: RESUME_VARIANT_LABEL[(key as ResumeVariantKey)] ?? key,
      ...v,
      response_rate: v.submitted > 0 ? +(v.response / v.submitted).toFixed(3) : 0,
      interview_rate: v.submitted > 0 ? +(v.interview / v.submitted).toFixed(3) : 0,
    })).sort((a, b) => b.response_rate - a.response_rate);
    return { variants };
  });

// =====================================================================
// DASHBOARD OPTIMIZATION SUMMARY (6 new cards)
// =====================================================================

export const getDashboardOptimization = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const tomorrow = new Date(Date.now() + 7 * 86400000).toISOString();
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();

    const [
      { data: sources },
      variantsRes,
      { count: freshCount },
      { count: followUpsCount },
      { count: interviewsCount },
      { data: weeklyReport },
    ] = await Promise.all([
      (supabase as any).from("job_sources").select("name, ats, priority_score, response_count, interview_count")
        .eq("user_id", userId).order("priority_score", { ascending: false }).limit(3),
      getResumeVariantStats({}),
      (supabase as any).from("job_listings").select("id", { count: "exact", head: true })
        .eq("user_id", userId).gte("posted_at", threeDaysAgo),
      (supabase as any).from("follow_up_tasks").select("id", { count: "exact", head: true })
        .eq("user_id", userId).eq("status", "pending").lte("due_at", tomorrow),
      (supabase as any).from("applications").select("id", { count: "exact", head: true })
        .eq("user_id", userId).not("interview_requested_at", "is", null)
        .gte("interview_requested_at", weekAgo),
      (supabase as any).from("weekly_learning_reports").select("*")
        .eq("user_id", userId).order("week_start", { ascending: false }).limit(1).maybeSingle(),
    ]);

    const bestVariant = (variantsRes?.variants ?? [])[0] ?? null;
    const bestSource = (sources ?? [])[0] ?? null;

    return {
      best_source: bestSource,
      best_variant: bestVariant,
      fresh_jobs_0_3: freshCount ?? 0,
      follow_ups_pending: followUpsCount ?? 0,
      interviews_this_week: interviewsCount ?? 0,
      weekly_recommendation: weeklyReport?.recommendations?.[0] ?? null,
      weekly_report: weeklyReport,
    };
  });

// =====================================================================
// WEEKLY LEARNING REPORT
// =====================================================================

export const generateWeeklyLearningReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const weekEnd = new Date(); weekEnd.setHours(23, 59, 59, 999);
    const weekStart = new Date(weekEnd.getTime() - 7 * 86400000); weekStart.setHours(0, 0, 0, 0);

    const [{ data: apps }, { data: jobs }, { data: sources }, variantStatsRes] = await Promise.all([
      (supabase as any).from("applications")
        .select("status, resume_variant_key, response_received_at, interview_requested_at, offer_at, job_listings(role_category, ats, interview_probability, companies(category))")
        .eq("user_id", userId)
        .gte("created_at", weekStart.toISOString()),
      (supabase as any).from("job_listings").select("interview_probability")
        .eq("user_id", userId).gte("created_at", weekStart.toISOString()),
      (supabase as any).from("job_sources")
        .select("name, ats, priority_score, response_count, interview_count, safety_block_count")
        .eq("user_id", userId).order("priority_score", { ascending: false }),
      getResumeVariantStats({}),
    ]);

    const tally = (arr: any[], key: (x: any) => string | null | undefined) => {
      const m = new Map<string, number>();
      for (const x of arr ?? []) {
        const k = key(x); if (!k) continue;
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    };
    const bestRoleCategory = tally(apps ?? [], (a) => a.job_listings?.role_category);
    const bestCompanyType = tally(apps ?? [], (a) => a.job_listings?.companies?.category);
    const bestAts = tally(apps ?? [], (a) => a.job_listings?.ats);
    const bestVariant = variantStatsRes.variants?.[0] ?? null;

    const totalApps = apps?.length ?? 0;
    const responses = (apps ?? []).filter((a: any) => a.response_received_at).length;
    const interviews = (apps ?? []).filter((a: any) => a.interview_requested_at).length;
    const responseRate = totalApps > 0 ? responses / totalApps : 0;
    const avgInterviewProb = (jobs?.length ?? 0) > 0
      ? Math.round((jobs ?? []).reduce((s: number, j: any) => s + (j.interview_probability ?? 0), 0) / jobs!.length)
      : 0;
    const lowestSource = [...(sources ?? [])].sort((a, b) => a.priority_score - b.priority_score)[0] ?? null;

    const recommendations: string[] = [];
    if (responseRate < 0.05 && totalApps >= 10) {
      recommendations.push("Response rate under 5% — tighten role-fit gates and prioritize fresh (0–3d) jobs only.");
    }
    if (bestVariant && bestVariant.interview_rate > 0.1) {
      recommendations.push(`Lean into the "${bestVariant.label}" resume variant — best interview rate this week (${(bestVariant.interview_rate * 100).toFixed(0)}%).`);
    }
    if (lowestSource && lowestSource.safety_block_count > 3) {
      recommendations.push(`Pause source "${lowestSource.name}" — ${lowestSource.safety_block_count} safety blocks this week.`);
    }
    if (avgInterviewProb < 70 && totalApps >= 5) {
      recommendations.push("Average interview probability below 70 — narrow your role categories and raise the salary floor.");
    }
    if (recommendations.length === 0) {
      recommendations.push("Performance is steady. Keep current Auto Review thresholds and freshness limits.");
    }

    const payload = {
      total_applications: totalApps,
      responses, interviews, response_rate: +responseRate.toFixed(3),
      avg_interview_probability: avgInterviewProb,
      best_role_category: bestRoleCategory,
      best_resume_variant: bestVariant?.label ?? null,
      best_company_type: bestCompanyType,
      best_ats_source: bestAts,
      lowest_source: lowestSource?.name ?? null,
      top_sources: (sources ?? []).slice(0, 5),
    };

    const { data: row, error } = await (supabase as any).from("weekly_learning_reports").insert({
      user_id: userId,
      week_start: weekStart.toISOString().slice(0, 10),
      week_end: weekEnd.toISOString().slice(0, 10),
      payload, recommendations,
    }).select().single();
    if (error) throw new Error(error.message);
    return { report: row };
  });

// =====================================================================
// ASSIGN FRESHNESS BUCKETS (one-shot backfill + ingest helper)
// =====================================================================

export const backfillFreshness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: jobs } = await (supabase as any).from("job_listings")
      .select("id, posted_at, freshness_bucket").eq("user_id", userId).limit(2000);
    let updated = 0;
    for (const j of jobs ?? []) {
      const b = freshnessBucket(j.posted_at);
      if (j.freshness_bucket !== b) {
        await (supabase as any).from("job_listings").update({ freshness_bucket: b }).eq("id", j.id);
        updated++;
      }
    }
    return { ok: true, updated };
  });
