import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------- Outcome model ---------- //
// Canonical outcome labels mapped from application.status + timestamps.
export type OutcomeLabel =
  | "queued"
  | "submitted"
  | "recruiter_reply"
  | "interview"
  | "offer"
  | "rejected"
  | "ghosted";

const SUBMITTED_STATUSES = new Set([
  "submitted", "submitted_manually",
  "interview_requested", "interview",
  "rejected", "ghosted", "offer",
]);
const REPLY_STATUSES = new Set([
  "interview_requested", "interview", "offer", "rejected",
]);
const INTERVIEW_STATUSES = new Set(["interview", "interview_requested", "offer"]);

function outcomeFor(a: any): OutcomeLabel {
  if (a.status === "offer" || a.offer_at) return "offer";
  if (a.status === "rejected" || a.rejected_at) return "rejected";
  if (a.status === "ghosted" || a.ghosted_at) return "ghosted";
  if (a.status === "interview" || a.technical_interview_at || a.final_interview_at) return "interview";
  if (a.status === "interview_requested" || a.interview_requested_at) return "interview";
  if (a.response_received_at || a.recruiter_screen_at) return "recruiter_reply";
  if (SUBMITTED_STATUSES.has(a.status)) return "submitted";
  return "queued";
}

// ---------- setOutcome ---------- //
const OUTCOME_INPUT = z.object({
  application_id: z.string().uuid(),
  outcome: z.enum(["recruiter_reply", "interview", "offer", "rejected", "ghosted"]),
  notes: z.string().max(2000).optional(),
  occurred_at: z.string().datetime().optional(),
});

export const setApplicationOutcome = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => OUTCOME_INPUT.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const ts = data.occurred_at ?? new Date().toISOString();
    const update: any = { updated_at: new Date().toISOString() };
    switch (data.outcome) {
      case "recruiter_reply":
        update.status = "submitted_manually";
        update.response_received_at = ts;
        break;
      case "interview":
        update.status = "interview_requested";
        update.interview_requested_at = ts;
        if (!update.response_received_at) update.response_received_at = ts;
        break;
      case "offer":
        update.status = "offer";
        update.offer_at = ts;
        break;
      case "rejected":
        update.status = "rejected";
        update.rejected_at = ts;
        break;
      case "ghosted":
        update.status = "ghosted";
        update.ghosted_at = ts;
        break;
    }
    if (data.notes) update.notes = data.notes;
    const { data: row, error } = await supabase
      .from("applications")
      .update(update)
      .eq("id", data.application_id)
      .eq("user_id", userId)
      .select("id, status")
      .single();
    if (error) throw new Error(error.message);
    return { application: row, outcome: data.outcome };
  });

// ---------- Conversion + segment analytics ---------- //
type Funnel = {
  submitted: number;
  recruiter_reply: number;
  interview: number;
  offer: number;
  rejected: number;
  ghosted: number;
  reply_rate: number;       // reply / submitted
  interview_rate: number;   // interview / reply
  offer_rate: number;       // offer / interview
  end_to_end: number;       // offer / submitted
};

function funnelOf(apps: any[]): Funnel {
  const sub = apps.filter((a) => SUBMITTED_STATUSES.has(a.status)).length;
  const reply = apps.filter((a) => REPLY_STATUSES.has(a.status) || a.response_received_at).length;
  const intv = apps.filter((a) => INTERVIEW_STATUSES.has(a.status)).length;
  const offer = apps.filter((a) => a.status === "offer").length;
  const rejected = apps.filter((a) => a.status === "rejected").length;
  const ghosted = apps.filter((a) => a.status === "ghosted").length;
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
  return {
    submitted: sub,
    recruiter_reply: reply,
    interview: intv,
    offer,
    rejected,
    ghosted,
    reply_rate: pct(reply, sub),
    interview_rate: pct(intv, reply),
    offer_rate: pct(offer, intv),
    end_to_end: pct(offer, sub),
  };
}

function segment<T>(apps: any[], key: (a: any) => string | null | undefined) {
  const m: Record<string, any[]> = {};
  for (const a of apps) {
    const k = key(a);
    if (!k) continue;
    (m[k] = m[k] || []).push(a);
  }
  return Object.entries(m)
    .map(([name, rows]) => ({ name, count: rows.length, funnel: funnelOf(rows) }))
    .filter((r) => r.funnel.submitted >= 1)
    .sort((a, b) => b.funnel.reply_rate - a.funnel.reply_rate || b.count - a.count);
}

// ---------- Dashboard ---------- //
export const getOutcomeDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [appsRes, resumesRes] = await Promise.all([
      supabase.from("applications").select(
        "id, status, resume_version_id, resume_variant_key, submitted_at, created_at, updated_at, " +
        "response_received_at, interview_requested_at, recruiter_screen_at, technical_interview_at, " +
        "final_interview_at, rejected_at, ghosted_at, offer_at, " +
        "job_listings(category, role_category, ats, company_name)"
      ).eq("user_id", userId),
      supabase.from("resume_versions").select("id, label, target_role, variant_key").eq("user_id", userId),
    ]);
    const apps = appsRes.data ?? [];
    const resumes = resumesRes.data ?? [];
    const resumeMap: Record<string, any> = {};
    resumes.forEach((r: any) => { resumeMap[r.id] = r; });

    const labeled = apps.map((a: any) => ({ ...a, outcome: outcomeFor(a) }));
    const funnel = funnelOf(labeled);

    const byRole = segment(labeled, (a) => a.job_listings?.role_category);
    const byCategory = segment(labeled, (a) => a.job_listings?.category);
    const byAts = segment(labeled, (a) => a.job_listings?.ats);
    const byCompany = segment(labeled, (a) => a.job_listings?.company_name);
    const byResume = segment(labeled, (a) => {
      const r = a.resume_version_id ? resumeMap[a.resume_version_id] : null;
      return a.resume_variant_key || (r ? (r.label || r.target_role || r.variant_key) : null);
    });

    const minN = (rows: any[], n = 2) => rows.filter((r) => r.funnel.submitted >= n);
    const top = (rows: any[]) => minN(rows)[0] ?? null;

    return {
      funnel,
      top_category: top(byRole) || top(byCategory),
      top_ats: top(byAts),
      top_resume: top(byResume),
      by_role: byRole,
      by_category: byCategory,
      by_ats: byAts,
      by_company: byCompany.slice(0, 10),
      by_resume: byResume,
      total: apps.length,
    };
  });

// ---------- Probability recalibration ---------- //
// Apply learned lift/penalty to interview_probability of queued jobs based on
// historical reply rate per (role_category, ats). Only updates jobs in
// status 'new' or 'queued' (i.e., not yet submitted).
export const recalibrateInterviewProbabilities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: apps } = await supabase
      .from("applications")
      .select("status, response_received_at, interview_requested_at, offer_at, " +
              "job_listings(role_category, ats)")
      .eq("user_id", userId);
    const rows = apps ?? [];

    // Compute reply rate per role_category and ats
    const stats = (key: (a: any) => string | undefined) => {
      const m: Record<string, { sub: number; reply: number }> = {};
      for (const a of rows) {
        const k = key(a);
        if (!k) continue;
        m[k] = m[k] || { sub: 0, reply: 0 };
        if (SUBMITTED_STATUSES.has(a.status)) m[k].sub += 1;
        if (REPLY_STATUSES.has(a.status) || a.response_received_at) m[k].reply += 1;
      }
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(m)) {
        if (v.sub >= 2) out[k] = v.reply / v.sub; // 0..1
      }
      return out;
    };
    const byRoleRate = stats((a) => a.job_listings?.role_category);
    const byAtsRate = stats((a) => a.job_listings?.ats);
    const baseline =
      Object.values(byRoleRate).reduce((s, n) => s + n, 0) /
      Math.max(1, Object.keys(byRoleRate).length || 1);

    const { data: queued } = await supabase
      .from("job_listings")
      .select("id, role_category, ats, interview_probability")
      .eq("user_id", userId)
      .in("status", ["new", "queued", "ready", "manual_review"]);

    let updated = 0;
    for (const j of queued ?? []) {
      const base = j.interview_probability ?? 50;
      const rLift = byRoleRate[j.role_category ?? ""] != null
        ? (byRoleRate[j.role_category ?? ""] - baseline) * 40
        : 0;
      const aLift = byAtsRate[j.ats ?? ""] != null
        ? (byAtsRate[j.ats ?? ""] - baseline) * 25
        : 0;
      const next = Math.max(0, Math.min(100, Math.round(base + rLift + aLift)));
      if (next !== base) {
        await supabase.from("job_listings")
          .update({ interview_probability: next })
          .eq("id", j.id).eq("user_id", userId);
        updated += 1;
      }
    }
    return {
      updated,
      by_role: byRoleRate,
      by_ats: byAtsRate,
      baseline_reply_rate: Math.round(baseline * 1000) / 10,
    };
  });

// ---------- Weekly AI recommendations ---------- //
export const generateWeeklyRecommendations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.OPENAI_API_KEY;

    // Pull dashboard inline
    const dashRes = await supabase.from("applications").select(
      "status, resume_version_id, resume_variant_key, submitted_at, created_at, response_received_at, " +
      "interview_requested_at, rejected_at, ghosted_at, offer_at, " +
      "job_listings(category, role_category, ats, company_name)"
    ).eq("user_id", userId);
    const apps = dashRes.data ?? [];

    const funnel = funnelOf(apps);
    const byRole = segment(apps, (a) => a.job_listings?.role_category);
    const byAts = segment(apps, (a) => a.job_listings?.ats);
    const byCompany = segment(apps, (a) => a.job_listings?.company_name).slice(0, 10);

    // Time-of-week: submitted_at day-of-week reply rate
    const dow: Record<string, { sub: number; reply: number }> = {};
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (const a of apps) {
      const t = a.submitted_at ?? a.created_at;
      if (!t) continue;
      const d = dayNames[new Date(t).getDay()];
      dow[d] = dow[d] || { sub: 0, reply: 0 };
      if (SUBMITTED_STATUSES.has(a.status)) dow[d].sub += 1;
      if (REPLY_STATUSES.has(a.status) || a.response_received_at) dow[d].reply += 1;
    }
    const dowRates = Object.entries(dow)
      .filter(([, v]) => v.sub >= 1)
      .map(([d, v]) => ({ day: d, rate: Math.round((v.reply / v.sub) * 1000) / 10, n: v.sub }));

    // Deterministic baseline recommendations (always available)
    const recs: { tone: "positive" | "warning" | "info"; title: string; detail: string }[] = [];
    const topRole = byRole.find((r) => r.funnel.submitted >= 2);
    if (topRole) recs.push({
      tone: "positive",
      title: `Apply more to "${topRole.name}"`,
      detail: `${topRole.funnel.reply_rate}% recruiter-reply rate across ${topRole.funnel.submitted} submissions.`,
    });
    const weakRole = byRole.filter((r) => r.funnel.submitted >= 3 && r.funnel.reply_rate < 10)[0];
    if (weakRole) recs.push({
      tone: "warning",
      title: `Avoid "${weakRole.name}" category`,
      detail: `Only ${weakRole.funnel.reply_rate}% reply rate over ${weakRole.funnel.submitted} submissions.`,
    });
    const topAts = byAts.find((a) => a.funnel.submitted >= 2);
    if (topAts) recs.push({
      tone: "positive",
      title: `Strongest ATS: ${topAts.name}`,
      detail: `${topAts.funnel.reply_rate}% reply rate · ${topAts.funnel.interview_rate}% reply→interview.`,
    });
    const bestDow = [...dowRates].sort((a, b) => b.rate - a.rate)[0];
    if (bestDow) recs.push({
      tone: "info",
      title: `Best day to apply: ${bestDow.day}`,
      detail: `${bestDow.rate}% reply rate across ${bestDow.n} submissions.`,
    });
    const topCompanies = byCompany.filter((c) => c.funnel.reply_rate >= 25).slice(0, 3).map((c) => c.name);
    if (topCompanies.length) recs.push({
      tone: "positive",
      title: `Strongest companies`,
      detail: topCompanies.join(", "),
    });

    // Optional AI narrative
    let narrative: string | null = null;
    if (apiKey && apps.length >= 5) {
      try {
        const summary = {
          funnel,
          top_roles: byRole.slice(0, 3),
          weak_roles: byRole.filter((r) => r.funnel.reply_rate < 10).slice(0, 3),
          top_ats: byAts.slice(0, 3),
          best_days: dowRates.sort((a, b) => b.rate - a.rate).slice(0, 3),
        };
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: "You are a job-search analyst. Give a 4-6 sentence weekly action plan based on the user's real data. Concrete, no fluff." },
              { role: "user", content: JSON.stringify(summary) },
            ],
            temperature: 0.4,
          }),
        });
        if (r.ok) {
          const j = await r.json();
          narrative = j.choices?.[0]?.message?.content?.trim() ?? null;
          const u = j.usage ?? {};
          await supabase.from("openai_usage").insert({
            user_id: userId, kind: "weekly_outcome_recs", model: "gpt-4o-mini", success: true,
            prompt_tokens: u.prompt_tokens ?? 0, completion_tokens: u.completion_tokens ?? 0,
            estimated_cost_cents: ((u.prompt_tokens ?? 0) * 0.000015) + ((u.completion_tokens ?? 0) * 0.000060),
          } as any);
        }
      } catch { /* non-fatal */ }
    }

    // Persist a weekly_learning_reports row (best effort)
    const now = new Date();
    const start = new Date(now); start.setDate(now.getDate() - 7);
    await supabase.from("weekly_learning_reports").insert({
      user_id: userId,
      week_start: start.toISOString().slice(0, 10),
      week_end: now.toISOString().slice(0, 10),
      recommendations: recs.map((r) => `${r.title} — ${r.detail}`),
      payload: { funnel, by_role: byRole, by_ats: byAts, dow: dowRates, narrative },
    } as any);

    return { funnel, recommendations: recs, narrative, dow: dowRates };
  });

export const getLatestWeeklyReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("weekly_learning_reports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    return { report: data?.[0] ?? null };
  });
