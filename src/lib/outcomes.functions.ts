import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const FOLLOWUP_KINDS = ["recruiter_followup", "linkedin_note", "thank_you", "second_followup"] as const;
type FollowUpKind = typeof FOLLOWUP_KINDS[number];

async function logActivity(supabase: any, userId: string, action: string, payload: any) {
  await supabase.from("automation_logs").insert({
    user_id: userId,
    action: action as any,
    status: payload.status ?? "success",
    application_id: payload.application_id ?? null,
    job_id: payload.job_id ?? null,
    details: payload.details ?? {},
  });
}

export const markSubmittedManually = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    application_id: z.string().uuid(),
    submitted_at: z.string().datetime().optional(),
    application_url: z.string().url().max(500).optional().or(z.literal("")),
    resume_version_id: z.string().uuid().optional().nullable(),
    cover_letter_id: z.string().uuid().optional().nullable(),
    notes: z.string().max(2000).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Verify ownership
    const { data: app, error: e1 } = await supabase
      .from("applications").select("id, user_id, job_id").eq("id", data.application_id).single();
    if (e1) throw new Error(e1.message);
    if (app.user_id !== userId) throw new Error("Forbidden");

    const submittedAt = data.submitted_at ?? new Date().toISOString();
    // Default follow-up due in 7 days
    const followAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

    const update: any = {
      status: "submitted_manually",
      submitted_at: submittedAt,
      follow_up_due_at: followAt,
    };
    if (data.application_url) update.application_url = data.application_url;
    if (data.resume_version_id !== undefined) update.resume_version_id = data.resume_version_id;
    if (data.cover_letter_id !== undefined) update.cover_letter_id = data.cover_letter_id;
    if (data.notes) update.submission_notes = data.notes;

    const { data: row, error } = await supabase
      .from("applications").update(update).eq("id", data.application_id)
      .select("*, job_listings(title, company_name)").single();
    if (error) throw new Error(error.message);
    await logActivity(supabase, userId, "submit", {
      application_id: row.id, job_id: row.job_id,
      details: { manual: true, application_url: data.application_url ?? null, submitted_at: submittedAt },
    });
    return { application: row };
  });

const FOLLOWUP_PROMPTS: Record<FollowUpKind, (ctx: any) => { system: string; user: string }> = {
  recruiter_followup: (ctx) => ({
    system: "You write concise, warm, professional recruiter follow-up emails. 5-7 sentences. No fluff.",
    user: `Write a short follow-up email to a recruiter for the ${ctx.title} role at ${ctx.company}. Application submitted ${ctx.daysAgo} day(s) ago. Reaffirm interest, mention 1 specific proof point from candidate's background ("${ctx.proof}"), and politely ask about next steps. Sign off as ${ctx.name}.`,
  }),
  linkedin_note: (ctx) => ({
    system: "You write LinkedIn connection notes under 280 characters. Friendly, specific, no emojis.",
    user: `Write a LinkedIn connection note to a recruiter or hiring manager for the ${ctx.title} role at ${ctx.company}. Reference the role and a single proof point: "${ctx.proof}". Keep under 280 characters.`,
  }),
  thank_you: (ctx) => ({
    system: "You write thank-you emails sent within 24h after an interview. Sincere, specific, 6-8 sentences.",
    user: `Write a thank-you email after interviewing for the ${ctx.title} role at ${ctx.company}. Mention enjoying the conversation, reinforce one strength relevant to the role ("${ctx.proof}"), and reaffirm interest. Sign off as ${ctx.name}.`,
  }),
  second_followup: (ctx) => ({
    system: "You write a polite second follow-up sent ~7 days after the first. Brief, no guilt-tripping.",
    user: `Write a brief second follow-up email for the ${ctx.title} role at ${ctx.company}. It's been about 7 days since the previous follow-up. Stay warm, restate interest, offer to provide anything useful, and ask about timing. Sign off as ${ctx.name}.`,
  }),
};

export const generateFollowUps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    application_id: z.string().uuid(),
    kinds: z.array(z.enum(FOLLOWUP_KINDS)).min(1),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY missing");

    const { data: app, error } = await supabase
      .from("applications")
      .select("id, user_id, job_id, submitted_at, created_at, job_listings(title, company_name, role_category, ats)")
      .eq("id", data.application_id).single();
    if (error) throw new Error(error.message);
    if (app.user_id !== userId) throw new Error("Forbidden");

    const { data: settings } = await supabase
      .from("user_settings").select("full_name").eq("user_id", userId).maybeSingle();

    const ref = (app.job_listings as any) ?? {};
    const title = ref.title ?? "the role";
    const company = ref.company_name ?? "your company";
    const submittedAt = app.submitted_at ?? app.created_at;
    const daysAgo = Math.max(1, Math.round((Date.now() - new Date(submittedAt).getTime()) / 86400000));
    const proofByCat: Record<string, string> = {
      data: "10,000+ tickets analyzed; Tableau dashboards adopted by leadership",
      operations: "35% efficiency improvement from forecasting + capacity models",
      customer_success: "91% CSAT sustained across 18 months",
      technical_support: "25% escalation reduction after triage redesign",
    };
    const proof = proofByCat[ref.role_category ?? ""] ?? "92% SLA compliance across enterprise support queues";
    const ctx = { title, company, daysAgo, proof, name: settings?.full_name || "Khalil Hickson" };

    const out: { kind: FollowUpKind; body: string }[] = [];
    for (const kind of data.kinds) {
      const { system, user } = FOLLOWUP_PROMPTS[kind](ctx);
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
          temperature: 0.6,
        }),
      });
      if (!resp.ok) {
        const txt = await resp.text();
        await supabase.from("openai_usage").insert({
          user_id: userId, kind: `followup_${kind}`, model: "gpt-4o-mini",
          success: false, error: `OpenAI ${resp.status}: ${txt.slice(0, 200)}`, job_id: app.job_id ?? null,
        } as any);
        continue;
      }
      const j = await resp.json();
      const body = j.choices?.[0]?.message?.content?.trim() ?? "";
      const usage = j.usage ?? {};
      const costCents = ((usage.prompt_tokens ?? 0) * 0.000015) + ((usage.completion_tokens ?? 0) * 0.000060);
      await supabase.from("openai_usage").insert({
        user_id: userId, kind: `followup_${kind}`, model: "gpt-4o-mini", success: true,
        prompt_tokens: usage.prompt_tokens ?? 0, completion_tokens: usage.completion_tokens ?? 0,
        estimated_cost_cents: costCents, job_id: app.job_id ?? null,
      } as any);
      const { data: msg } = await supabase.from("follow_up_messages").insert({
        user_id: userId, application_id: data.application_id, job_id: app.job_id ?? null,
        kind, body,
      }).select().single();
      out.push({ kind, body: msg?.body ?? body });
    }
    await logActivity(supabase, userId, "follow_up", {
      application_id: data.application_id, job_id: app.job_id,
      details: { generated: out.map((o) => o.kind) },
    });
    return { messages: out };
  });

export const listFollowUpMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ application_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("follow_up_messages").select("*")
      .eq("application_id", data.application_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { messages: rows ?? [] };
  });

const POSITIVE = new Set(["interview_requested", "offer", "interview"]);
const NEGATIVE = new Set(["rejected", "ghosted"]);
const SUBMITTED = new Set(["submitted", "submitted_manually", "interview", "interview_requested", "rejected", "ghosted", "offer"]);

function rateBy<T>(apps: any[], key: (a: any) => string | null | undefined) {
  const m: Record<string, { total: number; positive: number; negative: number; submitted: number }> = {};
  apps.forEach((a) => {
    const k = key(a); if (!k) return;
    m[k] = m[k] || { total: 0, positive: 0, negative: 0, submitted: 0 };
    m[k].total += 1;
    if (SUBMITTED.has(a.status)) m[k].submitted += 1;
    if (POSITIVE.has(a.status)) m[k].positive += 1;
    if (NEGATIVE.has(a.status)) m[k].negative += 1;
  });
  return Object.entries(m).map(([name, v]) => ({
    name,
    total: v.total,
    submitted: v.submitted,
    response_rate: v.submitted > 0 ? Math.round((v.positive / v.submitted) * 100) : 0,
    positive: v.positive,
    negative: v.negative,
  })).sort((a, b) => b.response_rate - a.response_rate || b.total - a.total);
}

export const getLearningInsights = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [appsRes, resumesRes] = await Promise.all([
      supabase.from("applications")
        .select("id, status, resume_version_id, cover_letter_id, submitted_at, created_at, updated_at, job_listings(category, role_category, ats, company_name)")
        .eq("user_id", userId),
      supabase.from("resume_versions").select("id, label, target_role, match_score").eq("user_id", userId),
    ]);
    const apps = appsRes.data ?? [];
    const resumes = resumesRes.data ?? [];
    const resumeMap: Record<string, any> = {};
    resumes.forEach((r: any) => { resumeMap[r.id] = r; });

    const byResume = rateBy(apps, (a) => {
      const r = a.resume_version_id ? resumeMap[a.resume_version_id] : null;
      return r ? (r.label || r.target_role || "Resume") : null;
    });
    const byRole = rateBy(apps, (a) => a.job_listings?.role_category);
    const byCompanyType = rateBy(apps, (a) => a.job_listings?.category);
    const byAts = rateBy(apps, (a) => a.job_listings?.ats);

    // Average days to response (submitted -> first response status)
    const responseTimes = apps
      .filter((a: any) => POSITIVE.has(a.status) || NEGATIVE.has(a.status))
      .map((a: any) => {
        const start = new Date(a.submitted_at ?? a.created_at).getTime();
        const end = new Date(a.updated_at).getTime();
        return Math.max(0, (end - start) / 86400000);
      });
    const avgDaysToResponse = responseTimes.length
      ? Math.round((responseTimes.reduce((s, n) => s + n, 0) / responseTimes.length) * 10) / 10
      : null;

    // Recommendations
    const recs: { title: string; detail: string; tone: "positive" | "warning" | "info" }[] = [];
    const topRole = byRole.find((r) => r.submitted >= 2);
    if (topRole && topRole.response_rate >= 25) {
      recs.push({ tone: "positive", title: `Apply more to "${topRole.name}" roles`, detail: `${topRole.response_rate}% response rate over ${topRole.submitted} submitted application(s).` });
    }
    const topResume = byResume.find((r) => r.submitted >= 2);
    if (topResume && topResume.response_rate >= 25) {
      recs.push({ tone: "positive", title: `Resume "${topResume.name}" is performing best`, detail: `${topResume.response_rate}% response rate. Reuse this version as a base for new tailoring.` });
    }
    const weakCompany = byCompanyType.filter((c) => c.submitted >= 3 && c.response_rate < 10)[0];
    if (weakCompany) {
      recs.push({ tone: "warning", title: `Consider deprioritizing "${weakCompany.name}" companies`, detail: `Only ${weakCompany.response_rate}% response rate over ${weakCompany.submitted} submissions.` });
    }
    const weakAts = byAts.filter((a) => a.submitted >= 3 && a.response_rate < 10)[0];
    if (weakAts) {
      recs.push({ tone: "warning", title: `Low conversion on ${weakAts.name} applications`, detail: `${weakAts.response_rate}% response rate. Audit packets routed through this ATS.` });
    }
    if (recs.length === 0) {
      recs.push({ tone: "info", title: "Need more data", detail: "Submit a few more applications to unlock recommendations." });
    }

    return {
      by_resume: byResume,
      by_role: byRole,
      by_company_type: byCompanyType,
      by_ats: byAts,
      avg_days_to_response: avgDaysToResponse,
      total_submitted: apps.filter((a: any) => SUBMITTED.has(a.status)).length,
      total_responses: apps.filter((a: any) => POSITIVE.has(a.status) || NEGATIVE.has(a.status)).length,
      recommendations: recs,
    };
  });
