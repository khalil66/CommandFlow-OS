import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";
import { tailorResumeInternal } from "./resume-generation.server";
import { projectsForRole, PORTFOLIO_URL } from "./portfolio";
import { SUPPORTED_ATS, SALARY_FLOOR } from "./scoring";
import { computeQuality, confidenceLabel } from "./packet-quality";
import { openAIFetch } from "./openai-fetch";
import { prepOutputSchema } from "./generation-contracts";
import { validateSavedPacket, withPacketLease } from "./retry-database.server";

export async function generatePacketCore(
  supabase: SupabaseClient<Database>,
  userId: string,
  jobId: string,
) {
  z.string().uuid().parse(userId);
  z.string().uuid().parse(jobId);
  return withPacketLease(supabase, userId, jobId, () => buildPacket(supabase, userId, jobId));
}

const LINKEDIN_URL = "https://www.linkedin.com/in/khalilhickson";

// ---------- Confidence / Quality scoring (deterministic) ---------- //

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
  title: string;
  company: string;
  category: string | null;
  description: string;
  ats: string | null;
  portfolio_project: string | null;
  trust_score: number;
  interview_probability: number;
  is_remote_first: boolean;
  mba_friendly: boolean;
  funding_stage: string | null;
}) {
  const apiKey = process.env["OPENAI_API_KEY"];
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
        messages: [
          { role: "system", content: PREP_SYSTEM },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.5,
      }),
    },
    { label: `packet-prep:${args.company.slice(0, 24)}` },
  );
  const j = await resp.json();
  const usage = j.usage ?? {};
  return { content: JSON.parse(j.choices?.[0]?.message?.content ?? "{}"), usage };
}

// ---------- Generate full packet ---------- //

/**
 * Core packet generation logic. Accepts any Supabase client (authed user
 * client or service-role admin client) plus an explicit userId so it can be
 * invoked from both authenticated server functions AND cron/admin paths
 * (e.g. the AI retry queue processor).
 */
async function buildPacket(supabase: SupabaseClient<Database>, userId: string, jobId: string) {
  const { data: job } = await supabase
    .from("job_listings")
    .select("*")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!job) throw new Error("Job not found");

  const { data: company } = job.company_id
    ? await supabase
        .from("companies")
        .select("*")
        .eq("id", job.company_id)
        .eq("user_id", userId)
        .maybeSingle()
    : { data: null };

  // 1. Resume generation calls a server-only helper, never an RPC stub.
  // Cache: if we already generated a resume + cover for this job in the last 7 days
  // (same jobId + role bucket + company), reuse instead of paying OpenAI again.
  const cacheCutoff = new Date(Date.now() - 7 * 86400_000).toISOString();
  const { data: cachedResume } = await supabase
    .from("resume_versions")
    .select("*")
    .eq("user_id", userId)
    .eq("job_id", job.id)
    .gte("created_at", cacheCutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: cachedCover } = cachedResume
    ? await supabase
        .from("cover_letters")
        .select("*")
        .eq("user_id", userId)
        .eq("job_id", job.id)
        .gte("created_at", cacheCutoff)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  let tailored: Awaited<ReturnType<typeof tailorResumeInternal>>;
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
    };
  } else {
    tailored = await tailorResumeInternal(supabase, userId, {
      title: job.title,
      company: job.company_name,
      category: job.role_category ?? job.category ?? "operations",
      job_description: job.description ?? `${job.title} at ${job.company_name}`,
      job_id: job.id,
      save: true,
    });
  }

  // 2. Interview prep / why-this-company
  const portfolio = projectsForRole(job.role_category ?? job.title)[0] ?? null;
  let prep: z.infer<typeof prepOutputSchema>;
  const { data: storedPrep } = await supabase
    .from("interview_prep")
    .select("brief")
    .eq("user_id", userId)
    .eq("job_id", job.id)
    .gte("generated_at", cacheCutoff)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const cachedPrep = prepOutputSchema.safeParse(storedPrep?.brief);
  const reusedPrep = cachedPrep.success;
  if (cachedPrep.success) {
    prep = cachedPrep.data;
  } else {
    try {
      const prepResponse = await callPrep({
        title: job.title,
        company: job.company_name,
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
      const tokens = prepResponse.usage;
      const { error: usageError } = await supabase.from("openai_usage").insert({
        user_id: userId,
        job_id: job.id,
        kind: "interview_prep",
        model: "gpt-4o-mini",
        success: true,
        prompt_tokens: tokens.prompt_tokens ?? 0,
        completion_tokens: tokens.completion_tokens ?? 0,
        estimated_cost_cents:
          (tokens.prompt_tokens ?? 0) * 0.000015 + (tokens.completion_tokens ?? 0) * 0.00006,
      });
      if (usageError) throw new Error("Interview preparation usage could not be recorded");
      prep = prepOutputSchema.parse(prepResponse.content);
    } catch (error) {
      const { error: logError } = await supabase.from("automation_logs").insert({
        user_id: userId,
        job_id: job.id,
        action: "tailor_resume",
        status: "failed",
        details: { stage: "interview_preparation", reason: "packet_prep_failed" },
      });
      if (logError) console.error("Interview preparation failure could not be recorded");
      throw error;
    }
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
  const { data: existing } = await supabase
    .from("applications")
    .select("id")
    .eq("user_id", userId)
    .eq("job_id", job.id)
    .maybeSingle();
  const appPayload = {
    user_id: userId,
    job_id: job.id,
    status: "manual_review" as const,
    priority: "manual" as const,
    resume_version_id: tailored.resume_id ?? null,
    cover_letter_id: tailored.cover_id ?? null,
    portfolio_project: portfolio,
    notes: `Quality ${quality.score} · ${confidence}`,
  };
  if (existing) {
    const { error } = await supabase
      .from("applications")
      .update(appPayload)
      .eq("id", existing.id)
      .eq("user_id", userId)
      .in("status", ["manual_review", "queued"]);
    if (error) throw new Error("Application could not be saved");
  } else {
    const { error } = await supabase.from("applications").insert(appPayload);
    if (error) throw new Error("Application could not be saved");
  }
  const { data: application, error: appError } = await supabase
    .from("applications")
    .select("id, status, resume_version_id, cover_letter_id")
    .eq("user_id", userId)
    .eq("job_id", job.id)
    .single();
  if (
    appError ||
    !application ||
    application.status !== "manual_review" ||
    !application.resume_version_id ||
    !application.cover_letter_id
  ) {
    throw new Error("Packet requires an existing manual-review application and saved artifacts");
  }
  const validatedPrep = prepOutputSchema.parse(prep);
  if (!reusedPrep) {
    const { error: prepError } = await supabase.from("interview_prep").insert({
      user_id: userId,
      application_id: application.id,
      job_id: job.id,
      brief: validatedPrep,
      recruiter_questions: validatedPrep.recruiter_questions,
      technical_questions: validatedPrep.technical_questions,
      star_answers: validatedPrep.star_examples,
    });
    if (prepError) throw new Error("Interview preparation could not be saved");
  }
  await validateSavedPacket(supabase, userId, job.id, application.id);

  return {
    job,
    company,
    resume: {
      summary: tailored.summary,
      skills: tailored.skills,
      bullets: tailored.bullets,
      keywords: tailored.keywords,
      match_score: tailored.matchScore,
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
}
