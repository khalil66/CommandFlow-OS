import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { projectsForRole, PORTFOLIO_URL } from "./portfolio";

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

function bucketForCategory(category?: string | null, title?: string): keyof typeof ROLE_PROOF_POINTS {
  const t = `${category ?? ""} ${title ?? ""}`.toLowerCase();
  if (t.includes("data") || t.includes("analyst") && t.includes("business")) return "data";
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

export const tailorResume = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    title: z.string().min(1),
    company: z.string().min(1),
    category: z.string().optional(),
    job_description: z.string().min(10),
    job_id: z.string().uuid().optional(),
    save: z.boolean().default(true),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

    const bucket = bucketForCategory(data.category, data.title);
    const proofPoints = ROLE_PROOF_POINTS[bucket];
    const portfolio = projectsForRole(data.title)[0] ?? projectsForRole(data.category ?? "")[0] ?? null;

    const userPrompt = `JOB TITLE: ${data.title}
COMPANY: ${data.company}
TARGET CATEGORY: ${data.category ?? "general"}

JOB DESCRIPTION:
${data.job_description}

CANDIDATE PROFILE:
${KHALIL_PROFILE}

ROLE-SPECIFIC PROOF POINTS (prioritize these in bullets and cover):
${proofPoints.map(p => `- ${p}`).join("\n")}

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

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: userPrompt }],
        response_format: { type: "json_object" },
        temperature: 0.4,
      }),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`OpenAI error ${resp.status}: ${txt.slice(0, 200)}`);
    }
    const json = await resp.json();
    const content = json.choices?.[0]?.message?.content ?? "{}";
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
      const { supabase, userId } = context;
      const { data: r } = await supabase.from("resume_versions").insert({
        user_id: userId, job_id: data.job_id ?? null,
        label: `${data.company} — ${data.title}`,
        target_role: data.category ?? null,
        summary: out.summary, skills: out.skills, bullets: out.bullets,
        keywords: out.keywords, match_score: out.matchScore, explanation: out.explanation,
      }).select("id").maybeSingle();
      resume_id = r?.id ?? null;

      const { data: c } = await supabase.from("cover_letters").insert({
        user_id: userId, job_id: data.job_id ?? null, body: out.cover,
      }).select("id").maybeSingle();
      cover_id = c?.id ?? null;
    }

    return { ...out, resume_id, cover_id };
  });

export const listResumes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("resume_versions")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { resumes: data ?? [] };
  });
