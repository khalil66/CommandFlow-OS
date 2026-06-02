import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tailorResume } from "./resume.functions";
import { projectsForRole, PORTFOLIO_URL } from "./portfolio";
import { computeInterviewProbability, SUPPORTED_ATS, SALARY_FLOOR } from "./scoring";
import { openAIFetch } from "./openai-fetch";

const LINKEDIN_URL = "https://www.linkedin.com/in/khalilhickson";

// ---------- Confidence / Quality scoring (deterministic) ---------- //

export type Confidence = "Strong Match" | "Good Match" | "Stretch Opportunity" | "Low Probability";

export function confidenceLabel(quality: number): Confidence {
  if (quality >= 88) return "Strong Match";
  if (quality >= 75) return "Good Match";
  if (quality >= 60) return "Stretch Opportunity";
  return "Low Probability";
}

export interface QualityInputs {
  resume_match: number;          // 0-100
  keyword_alignment: number;     // 0-100
  portfolio_alignment: number;   // 0-100 (100 if mapped, 50 otherwise)
  interview_probability: number; // 0-100
  trust_score: number;           // 0-100
  ats_compatibility: number;     // 100 if supported, 30 otherwise
  salary_quality: number;        // 0-100 (≥75K = 100, ≥55K = 75, missing = 50, below = 0)
}

export function computeQuality(i: QualityInputs): { score: number; breakdown: Record<string, number> } {
  const w = {
    resume_match: 0.18,
    keyword_alignment: 0.14,
    portfolio_alignment: 0.10,
    interview_probability: 0.20,
    trust_score: 0.16,
    ats_compatibility: 0.12,
    salary_quality: 0.10,
  };
  const b: Record<string, number> = {};
  let total = 0;
  for (const [k, weight] of Object.entries(w)) {
    const v = Math.max(0, Math.min(100, (i as any)[k] ?? 0));
    b[k] = Math.round(v * weight);
    total += v * weight;
  }
  return { score: Math.round(total), breakdown: b };
}

function salaryQuality(min: number | null | undefined, estimated: boolean): number {
  if (min == null) return estimated ? 50 : 50;
  if (min >= 75000) return 100;
  if (min >= SALARY_FLOOR) return 75;
  return 0;
}

// ---------- Interview prep / Why-this-company LLM call ---------- //

const PREP_SYSTEM = `You generate interview preparation and "why this company" content
for Khalil Hickson. Output STRICT JSON. Be specific, grounded, no AI clichés.

Rules:
- Use only proof points provided. Never invent metrics or claims.
- STAR examples must reference real metrics from Khalil's profile.
- "Why this company" must reference category + remote-first + MBA/student
  friendliness when applicable. No generic praise.
- Keep recruiter and technical questions realistic for this role and ATS.
- LinkedIn tips must be concrete, max 5 bullets.`;

const PREP_SCHEMA_HINT = `{
  "talking_points": [string, 4-6 items],
  "recruiter_questions": [string, 5-7 items],
  "technical_questions": [string, 5-7 items],
  "star_examples": [{"question": string, "situation": string, "task": string, "action": string, "result": string}, 2-3 items],
  "why_company": string (120-180 words),
  "linkedin_tips": [string, 3-5 items],
  "ats_summary": string (60-100 words on how the resume covers the JD's ATS keywords),
  "readiness_explanation": string (3-4 sentences explaining the quality score)
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
- Tableau + SQL KPI dashboards adopted by leadership
- MBA student, Jacksonville FL, remote-first`;

async function callPrep(args: {
  title: string; company: string; category: string | null;
  description: string; ats: string | null; portfolio_project: string | null;
  trust_score: number; interview_probability: number;
  is_remote_first: boolean; mba_friendly: boolean; funding_stage: string | null;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const userPrompt = `JOB: ${args.title} @ ${args.company}
CATEGORY: ${args.category ?? "general"} · ATS: ${args.ats ?? "n/a"}
COMPANY SIGNALS: trust=${args.trust_score} · interview_prob=${args.interview_probability}
remote_first=${args.is_remote_first} · mba_friendly=${args.mba_friendly} · funding=${args.funding_stage ?? "unknown"}

JOB DESCRIPTION:
${args.description.slice(0, 4000)}

KHALIL PROOF POINTS:
${KHALIL_PROOF}

PORTFOLIO PROJECT (recommended): ${args.portfolio_project ?? "(choose best fit)"}
PORTFOLIO URL: ${PORTFOLIO_URL}
LINKEDIN: ${LINKEDIN_URL}

Return JSON in this shape:
${PREP_SCHEMA_HINT}`;

  const resp = await openAIFetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: PREP_SYSTEM }, { role: "user", content: userPrompt }],
        response_format: { type: "json_object" },
        temperature: 0.5,
      }),
    },
    { label: `packet-prep:${args.company.slice(0, 24)}` }
  );
  const j = await resp.json();
  return JSON.parse(j.choices?.[0]?.message?.content ?? "{}");
}

// ---------- Generate full packet ---------- //

export const generatePacket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ job_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: job } = await supabase.from("job_listings").select("*")
      .eq("id", data.job_id).eq("user_id", userId).maybeSingle();
    if (!job) throw new Error("Job not found");

    const { data: company } = job.company_id
      ? await supabase.from("companies").select("*").eq("id", job.company_id).maybeSingle()
      : { data: null as any };

    // 1. Tailored resume + cover (uses existing tailorResume server fn under the hood).
    // Cache: if we already generated a resume + cover for this job in the last 7 days
    // (same jobId + role bucket + company), reuse instead of paying OpenAI again.
    const cacheCutoff = new Date(Date.now() - 7 * 86400_000).toISOString();
    const { data: cachedResume } = await supabase.from("resume_versions")
      .select("*").eq("user_id", userId).eq("job_id", job.id)
      .gte("created_at", cacheCutoff)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    const { data: cachedCover } = cachedResume
      ? await supabase.from("cover_letters")
          .select("*").eq("user_id", userId).eq("job_id", job.id)
          .gte("created_at", cacheCutoff)
          .order("created_at", { ascending: false }).limit(1).maybeSingle()
      : { data: null as any };

    let tailored: Awaited<ReturnType<typeof tailorResume>>;
    if (cachedResume && cachedCover) {
      console.log(`[packet] cache hit for job ${job.id} (${job.company_name})`);
      tailored = {
        matchScore: cachedResume.match_score ?? 0,
        summary: cachedResume.summary ?? "",
        skills: cachedResume.skills ?? [],
        bullets: cachedResume.bullets ?? [],
        keywords: cachedResume.keywords ?? [],
        cover: cachedCover.body ?? "",
        explanation: cachedResume.explanation ?? "",
        ats_readability: 80,
        portfolio_project: null,
        links: { portfolio: PORTFOLIO_URL, linkedin: "https://www.linkedin.com/in/khalilhickson" },
        resume_id: cachedResume.id,
        cover_id: cachedCover.id,
      } as any;
    } else {
      tailored = await tailorResume({
        data: {
          title: job.title,
          company: job.company_name,
          category: job.role_category ?? job.category ?? "operations",
          job_description: job.description ?? `${job.title} at ${job.company_name}`,
          job_id: job.id,
          save: true,
        },
      });
    }

    // 2. Interview prep / why-this-company
    const portfolio = projectsForRole(job.role_category ?? job.title)[0] ?? null;
    let prep: any = {};
    try {
      prep = await callPrep({
        title: job.title, company: job.company_name,
        category: job.role_category ?? null,
        description: job.description ?? "",
        ats: job.ats ?? null,
        portfolio_project: portfolio,
        trust_score: company?.trust_score ?? 80,
        interview_probability: job.interview_probability ?? 0,
        is_remote_first: company?.is_remote_first ?? true,
        mba_friendly: company?.mba_friendly ?? false,
        funding_stage: company?.funding_stage ?? null,
      });
    } catch (e: any) {
      prep = { _error: e.message };
    }

    // 3. Quality score
    const keywordAlignment = Math.min(100, (tailored.keywords?.length ?? 0) * 8);
    const quality = computeQuality({
      resume_match: tailored.matchScore ?? 0,
      keyword_alignment: keywordAlignment,
      portfolio_alignment: portfolio ? 100 : 50,
      interview_probability: job.interview_probability ?? 0,
      trust_score: company?.trust_score ?? 80,
      ats_compatibility: SUPPORTED_ATS.includes(job.ats ?? "") ? 100 : 30,
      salary_quality: salaryQuality(job.salary_min, !!job.salary_estimated),
    });
    const confidence = confidenceLabel(quality.score);

    // 4. Upsert application in manual_review
    const { data: existing } = await supabase.from("applications")
      .select("id").eq("user_id", userId).eq("job_id", job.id).maybeSingle();
    const appPayload = {
      user_id: userId, job_id: job.id,
      status: "manual_review" as const,
      priority: "manual" as const,
      resume_version_id: tailored.resume_id ?? null,
      cover_letter_id: tailored.cover_id ?? null,
      portfolio_project: portfolio,
      notes: `Quality ${quality.score} · ${confidence}`,
    };
    if (existing) {
      await supabase.from("applications").update(appPayload).eq("id", existing.id);
    } else {
      await supabase.from("applications").insert(appPayload);
    }

    return {
      job, company,
      resume: {
        summary: tailored.summary, skills: tailored.skills, bullets: tailored.bullets,
        keywords: tailored.keywords, match_score: tailored.matchScore,
      },
      cover: { body: tailored.cover },
      portfolio_project: portfolio,
      portfolio_url: PORTFOLIO_URL,
      linkedin_url: LINKEDIN_URL,
      prep,
      quality: { score: quality.score, breakdown: quality.breakdown, confidence },
      explanation: tailored.explanation,
      ats_summary: prep.ats_summary ?? "",
      readiness_explanation: prep.readiness_explanation ?? tailored.explanation,
    };
  });

// ---------- Approve / Reject / Save / Get latest packet ---------- //

export const decideApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    job_id: z.string().uuid(),
    decision: z.enum(["approve", "reject", "save_for_later"]),
    notes: z.string().max(1000).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const statusMap = {
      approve: "approved",
      reject: "rejected",
      save_for_later: "manual_review",
    } as const;
    const { data: existing } = await supabase.from("applications")
      .select("id").eq("user_id", userId).eq("job_id", data.job_id).maybeSingle();
    const payload: any = {
      user_id: userId, job_id: data.job_id,
      status: statusMap[data.decision],
      notes: data.notes ?? null,
    };
    if (data.decision === "approve") payload.submitted_at = null; // still NOT submitted — manual only
    if (existing) {
      await supabase.from("applications").update(payload).eq("id", existing.id);
    } else {
      await supabase.from("applications").insert(payload);
    }
    return { ok: true, status: payload.status };
  });

export const getLatestPacket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ job_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: job } = await supabase.from("job_listings").select("*")
      .eq("id", data.job_id).eq("user_id", userId).maybeSingle();
    if (!job) throw new Error("Job not found");
    const [{ data: company }, { data: resume }, { data: cover }, { data: app }] = await Promise.all([
      job.company_id
        ? supabase.from("companies").select("*").eq("id", job.company_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from("resume_versions").select("*").eq("job_id", job.id).eq("user_id", userId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("cover_letters").select("*").eq("job_id", job.id).eq("user_id", userId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("applications").select("*").eq("job_id", job.id).eq("user_id", userId).maybeSingle(),
    ]);
    return { job, company, resume, cover, application: app };
  });
