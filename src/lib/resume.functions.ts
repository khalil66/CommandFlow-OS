import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const KHALIL_PROFILE = `Khalil Hickson — Data Analyst & Technical Operations Specialist
Location: Jacksonville, FL · khalilhickson.com
Skills: SQL, Tableau, Excel (advanced), Salesforce, Zendesk, Data Analysis,
KPI Optimization, Forecasting, Operations Strategy, Stakeholder Reporting.
Highlights:
- Analyzed 10,000+ Tier 2/3 support cases
- Reduced escalations by 25%
- Sustained 91% CSAT for 18 months
- Built Tableau/SQL KPI dashboards used by leadership
- Forecasting models that improved fulfillment efficiency by 35%
- Standardized Zendesk + Salesforce reporting pipelines`;

const SYSTEM = `You tailor Khalil Hickson's resume and cover letter to a specific job description.
Output strict JSON matching the provided schema. Be ATS-friendly, professional, human-sounding.
Never invent metrics — only use the highlights provided in the profile.
Quantify with: 10,000+ cases, 25% escalation reduction, 91% CSAT, 35% efficiency gain.`;

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

    const userPrompt = `JOB TITLE: ${data.title}
COMPANY: ${data.company}
TARGET CATEGORY: ${data.category ?? "general"}

JOB DESCRIPTION:
${data.job_description}

CANDIDATE PROFILE:
${KHALIL_PROFILE}

Return JSON with: matchScore (0-100), summary (3-4 sentences), skills (array of 8-12), bullets (array of 5-7 quantified resume bullets), keywords (array of 8-15 ATS keywords), cover (200-280 word cover letter), explanation (why this scored what it did).`;

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
