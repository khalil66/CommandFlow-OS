import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";
import { projectsForRole, PORTFOLIO_URL } from "./portfolio";
import { openAIFetch } from "./openai-fetch";
import { reserveUsage, finishUsage } from "./retry-database.server";
import { resumeArgsSchema, resumeOutputSchema } from "./generation-contracts";
const LINKEDIN_URL = "https://www.linkedin.com/in/khalilhickson";

const KHALIL_PROFILE = `Khalil Hickson — Data Analyst & Technical Operations Specialist
Location: Jacksonville, FL · Remote-first
Portfolio: ${PORTFOLIO_URL}
LinkedIn: ${LINKEDIN_URL}
Skills: SQL, Tableau, Excel (advanced), Salesforce, Zendesk, Python (analysis),
KPI Optimization, Forecasting, Operations Strategy, Stakeholder Reporting,
Process Improvement, Cross-functional Project Management.

VERIFIED PROOF POINTS (do not invent others):
- 10,000+ Tier 2/3 support tickets analyzed (Zendesk + Salesforce workflows)
- 25% reduction in escalations after triage redesign
- 91% CSAT sustained across 18 months of customer-facing work
- 24-hour average resolution time on complex technical cases
- 92% SLA compliance across enterprise support queues
- 50,000+ customer transactions analyzed for revenue intelligence
- $1.2M+ revenue analyzed in cohort + retention studies
- 35% efficiency improvement from forecasting + capacity models
- 92% forecasting accuracy on operational demand modeling
- Tableau + SQL KPI dashboards adopted by leadership`;

const ROLE_PROOF_POINTS: Record<string, string[]> = {
  data: [
    "50,000+ customer transactions analyzed for revenue intelligence",
    "$1.2M+ revenue analyzed across cohort + retention studies",
    "Tableau dashboards adopted by leadership for weekly reviews",
    "SQL pipelines standardizing reporting across 3 source systems",
  ],
  operations: [
    "35% efficiency improvement from forecasting + capacity models",
    "92% forecasting accuracy on operational demand modeling",
    "KPI dashboards driving weekly cross-functional reviews",
    "Process redesign reducing manual handoffs by ~40%",
  ],
  customer_success: [
    "91% CSAT sustained across 18 months of customer-facing work",
    "24-hour average resolution on complex technical cases",
    "92% SLA compliance across enterprise support queues",
    "Customer health dashboards used by CSM leadership",
  ],
  technical_support: [
    "10,000+ Tier 2/3 support tickets analyzed",
    "25% reduction in escalations after triage redesign",
    "Zendesk + Salesforce workflow automation reducing manual steps",
    "Runbook standardization adopted by L1/L2 teams",
  ],
  product_pm: [
    "Cross-functional project delivery across support, ops, and analytics",
    "KPI dashboards and forecasting models adopted by leadership",
    "35% efficiency improvement from process redesign initiatives",
    "Stakeholder reporting cadences spanning 3+ functions",
  ],
  saas: [
    "Customer-facing SaaS workflows in Zendesk + Salesforce",
    "91% CSAT and 92% SLA compliance in SaaS support context",
    "Implementation playbooks for new enterprise accounts",
    "Tableau dashboards tracking adoption + health metrics",
  ],
};

function bucketForCategory(
  category?: string | null,
  title?: string,
): keyof typeof ROLE_PROOF_POINTS {
  const t = `${category ?? ""} ${title ?? ""}`.toLowerCase();
  if (t.includes("data") || (t.includes("analyst") && t.includes("business"))) return "data";
  if (t.includes("operations") || t.includes("ops")) return "operations";
  if (t.includes("customer success") || t.includes("csm")) return "customer_success";
  if (t.includes("support") || t.includes("technical")) return "technical_support";
  if (t.includes("product") || t.includes("project") || t.includes("pm")) return "product_pm";
  if (t.includes("saas") || t.includes("implementation")) return "saas";
  if (t.includes("analyst")) return "data";
  return "operations";
}

const SYSTEM = `You tailor Khalil Hickson's resume and cover letter for a specific job.
Output STRICT JSON matching the requested schema. Be ATS-friendly, professional, and human-sounding.

Hard rules:
- Never invent metrics. Use ONLY the proof points provided.
- Avoid keyword stuffing. Use each ATS keyword in natural context, never list-dump.
- Bullets must lead with a strong verb, include a quantified outcome from the proof list,
  and reflect the actual job requirements.
- Cover letter must sound like a real person — no AI clichés, no "I am writing to apply",
  no superlatives ("world-class", "passionate"), no over-formal hedging.
- Reference Khalil's portfolio (${PORTFOLIO_URL}) and LinkedIn (${LINKEDIN_URL}) ONCE in the cover letter.
- Mention the recommended portfolio project by name once if it is genuinely relevant.
- Optimize for ATS readability: short sentences, common section terms, no symbols beyond standard punctuation.`;

export async function tailorResumeInternal(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: unknown,
) {
  userId = z.string().uuid().parse(userId);
  const data = resumeArgsSchema.parse(input);
  if (data.job_id) {
    const { data: job, error } = await supabase
      .from("job_listings")
      .select("id")
      .eq("user_id", userId)
      .eq("id", data.job_id)
      .maybeSingle();
    if (error || !job) throw new Error("Job not found");
  }
  if (process.env["RETRY_REPAIR_ENABLED"] !== "true")
    return legacyTailorResume(supabase, userId, data);
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const reservationId = await reserveUsage(supabase, userId, data.job_id);
  const bucket = bucketForCategory(data.category, data.title);
  const proofPoints = ROLE_PROOF_POINTS[bucket];
  const portfolio =
    projectsForRole(data.title)[0] ?? projectsForRole(data.category ?? "")[0] ?? null;

  const userPrompt = `JOB TITLE: ${data.title}
COMPANY: ${data.company}
TARGET CATEGORY: ${data.category ?? "general"}

JOB DESCRIPTION:
${data.job_description}

CANDIDATE PROFILE:
${KHALIL_PROFILE}

ROLE-SPECIFIC PROOF POINTS (prioritize these in bullets and cover):
${proofPoints.map((p) => `- ${p}`).join("\n")}

RECOMMENDED PORTFOLIO PROJECT: ${portfolio ?? "(none specifically mapped — choose from profile)"}

Return JSON with:
- matchScore (0-100, honest)
- summary (3-4 sentence professional summary tailored to the role)
- skills (array of 8-12, drawn from the profile + JD overlap, no fabricated tools)
- bullets (5-7 ATS-friendly resume bullets, each anchored in a real proof point above)
- keywords (8-15 ATS keywords pulled from the JD, used naturally — not stuffed)
- cover (200-280 word cover letter, human-sounding, references portfolio + LinkedIn ONCE)
- explanation (why this scored what it did, 2-3 sentences)
- ats_readability (0-100, your assessment of ATS-friendliness)`;

  const model = "gpt-4o-mini";
  let costCents = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let resume_id: string | null = null;
  let cover_id: string | null = null;
  try {
    const resp = await openAIFetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.4,
        }),
      },
      { label: `resume:${data.company.slice(0, 24)}` },
    );
    const json = await resp.json();
    const content = json.choices?.[0]?.message?.content ?? "{}";
    const usage = json.usage ?? {};
    // gpt-4o-mini: $0.15/1M input, $0.60/1M output → cents
    promptTokens = usage.prompt_tokens ?? 0;
    completionTokens = usage.completion_tokens ?? 0;
    costCents = (usage.prompt_tokens ?? 0) * 0.000015 + (usage.completion_tokens ?? 0) * 0.00006;
    const parsed = resumeOutputSchema.parse(JSON.parse(content));

    const out = {
      matchScore: Number(parsed.matchScore ?? 0),
      summary: String(parsed.summary ?? ""),
      skills: Array.isArray(parsed.skills) ? parsed.skills.map(String) : [],
      bullets: Array.isArray(parsed.bullets) ? parsed.bullets.map(String) : [],
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String) : [],
      cover: String(parsed.cover ?? ""),
      explanation: String(parsed.explanation ?? ""),
      ats_readability: Number(parsed.ats_readability ?? 80),
      portfolio_project: portfolio,
      links: { portfolio: PORTFOLIO_URL, linkedin: LINKEDIN_URL },
    };

    if (data.save) {
      const { data: r, error: resumeError } = await supabase
        .from("resume_versions")
        .insert({
          user_id: userId,
          job_id: data.job_id ?? null,
          label: `${data.company} — ${data.title}`,
          target_role: data.category ?? null,
          summary: out.summary,
          skills: out.skills,
          bullets: out.bullets,
          keywords: out.keywords,
          match_score: out.matchScore,
          explanation: out.explanation,
        })
        .select("id")
        .maybeSingle();
      if (resumeError || !r) throw new Error("Resume could not be saved");
      resume_id = r.id;

      const { data: c, error: coverError } = await supabase
        .from("cover_letters")
        .insert({
          user_id: userId,
          job_id: data.job_id ?? null,
          body: out.cover,
        })
        .select("id")
        .maybeSingle();
      if (coverError || !c) throw new Error("Cover letter could not be saved");
      cover_id = c.id;
    }

    await finishUsage(supabase, userId, reservationId, {
      success: true,
      model,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      estimated_cost_cents: costCents,
      resume_id,
      cover_id,
      match_score: out.matchScore,
    });
    return { ...out, resume_id, cover_id };
  } catch (error) {
    await finishUsage(supabase, userId, reservationId, {
      success: false,
      model,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      estimated_cost_cents: costCents,
      resume_id,
      cover_id,
      error: error instanceof Error ? error.message.slice(0, 200) : "Generation failed",
    });
    throw error;
  }
}

async function legacyTailorResume(
  supabase: SupabaseClient<Database>,
  userId: string,
  data: z.infer<typeof resumeArgsSchema>,
) {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  // Per-user daily caps (resume + cover letter generated together count as 1 of each)

  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const { data: usageToday } = await supabase
    .from("openai_usage")
    .select("kind, success")
    .eq("user_id", userId)
    .gte("created_at", since.toISOString());
  const resumeUsed = (usageToday ?? []).filter((r) => r.kind === "resume" && r.success).length;
  const coverUsed = (usageToday ?? []).filter((r) => r.kind === "cover_letter" && r.success).length;
  if (resumeUsed >= 25)
    throw new Error("Daily resume generation limit reached (25/day). Resets at 00:00 UTC.");
  if (coverUsed >= 25) throw new Error("Daily cover letter generation limit reached (25/day).");

  const bucket = bucketForCategory(data.category, data.title);
  const proofPoints = ROLE_PROOF_POINTS[bucket];
  const portfolio =
    projectsForRole(data.title)[0] ?? projectsForRole(data.category ?? "")[0] ?? null;

  const userPrompt = `JOB TITLE: ${data.title}
COMPANY: ${data.company}
TARGET CATEGORY: ${data.category ?? "general"}

JOB DESCRIPTION:
${data.job_description}

CANDIDATE PROFILE:
${KHALIL_PROFILE}

ROLE-SPECIFIC PROOF POINTS (prioritize these in bullets and cover):
${proofPoints.map((p) => `- ${p}`).join("\n")}

RECOMMENDED PORTFOLIO PROJECT: ${portfolio ?? "(none specifically mapped — choose from profile)"}

Return JSON with:
- matchScore (0-100, honest)
- summary (3-4 sentence professional summary tailored to the role)
- skills (array of 8-12, drawn from the profile + JD overlap, no fabricated tools)
- bullets (5-7 ATS-friendly resume bullets, each anchored in a real proof point above)
- keywords (8-15 ATS keywords pulled from the JD, used naturally — not stuffed)
- cover (200-280 word cover letter, human-sounding, references portfolio + LinkedIn ONCE)
- explanation (why this scored what it did, 2-3 sentences)
- ats_readability (0-100, your assessment of ATS-friendliness)`;

  const model = "gpt-4o-mini";
  let resp: Response;
  try {
    resp = await openAIFetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: userPrompt },
          ],
          response_format: { type: "json_object" },
          temperature: 0.4,
        }),
      },
      { label: `resume:${data.company.slice(0, 24)}` },
    );
  } catch (e) {
    await supabase.from("openai_usage").insert({
      user_id: userId,
      kind: "resume",
      model,
      success: false,
      error: `error: ${e instanceof Error ? e.message.slice(0, 200) : "Generation failed"}`,
      job_id: data.job_id ?? null,
    });
    throw e;
  }
  const json = await resp.json();
  const content = json.choices?.[0]?.message?.content ?? "{}";
  const usage = json.usage ?? {};
  // gpt-4o-mini: $0.15/1M input, $0.60/1M output → cents
  const costCents =
    (usage.prompt_tokens ?? 0) * 0.000015 + (usage.completion_tokens ?? 0) * 0.00006;
  const parsed = JSON.parse(content);

  const out = {
    matchScore: Number(parsed.matchScore ?? 0),
    summary: String(parsed.summary ?? ""),
    skills: Array.isArray(parsed.skills) ? parsed.skills.map(String) : [],
    bullets: Array.isArray(parsed.bullets) ? parsed.bullets.map(String) : [],
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String) : [],
    cover: String(parsed.cover ?? ""),
    explanation: String(parsed.explanation ?? ""),
    ats_readability: Number(parsed.ats_readability ?? 80),
    portfolio_project: portfolio,
    links: { portfolio: PORTFOLIO_URL, linkedin: LINKEDIN_URL },
  };

  let resume_id: string | null = null;
  let cover_id: string | null = null;
  if (data.save) {
    const { data: r } = await supabase
      .from("resume_versions")
      .insert({
        user_id: userId,
        job_id: data.job_id ?? null,
        label: `${data.company} — ${data.title}`,
        target_role: data.category ?? null,
        summary: out.summary,
        skills: out.skills,
        bullets: out.bullets,
        keywords: out.keywords,
        match_score: out.matchScore,
        explanation: out.explanation,
      })
      .select("id")
      .maybeSingle();
    resume_id = r?.id ?? null;

    const { data: c } = await supabase
      .from("cover_letters")
      .insert({
        user_id: userId,
        job_id: data.job_id ?? null,
        body: out.cover,
      })
      .select("id")
      .maybeSingle();
    cover_id = c?.id ?? null;
  }

  // Log success — one row per kind so analytics can split them
  await supabase.from("openai_usage").insert([
    {
      user_id: userId,
      kind: "resume",
      model,
      success: true,
      job_id: data.job_id ?? null,
      resume_version_id: resume_id,
      match_score: out.matchScore,
      prompt_tokens: usage.prompt_tokens ?? 0,
      completion_tokens: usage.completion_tokens ?? 0,
      estimated_cost_cents: costCents / 2,
    },
    {
      user_id: userId,
      kind: "cover_letter",
      model,
      success: true,
      job_id: data.job_id ?? null,
      cover_letter_id: cover_id,
      match_score: out.matchScore,
      prompt_tokens: 0,
      completion_tokens: 0,
      estimated_cost_cents: costCents / 2,
    },
  ]);

  return { ...out, resume_id, cover_id };
}
