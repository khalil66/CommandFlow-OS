import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { openAIFetch } from "./openai-fetch";

// Master profile (mirrors resume.functions.ts KHALIL_PROFILE proof points)
const MASTER_SUMMARY =
  "Data Analyst & Technical Operations Specialist with experience analyzing 10,000+ support tickets, 50,000+ transactions, and $1.2M+ in revenue. Builds Tableau + SQL dashboards adopted by leadership.";
const MASTER_SKILLS = [
  "SQL", "Tableau", "Excel", "Salesforce", "Zendesk",
  "Python", "KPI Optimization", "Forecasting", "Operations Strategy",
  "Stakeholder Reporting", "Process Improvement", "Project Management",
];
const MASTER_BULLETS = [
  "Analyzed 10,000+ Tier 2/3 support tickets across Zendesk and Salesforce, reducing escalations by 25%.",
  "Sustained 91% CSAT and 92% SLA compliance across 18 months of customer-facing work.",
  "Built Tableau + SQL KPI dashboards adopted by leadership for weekly reviews.",
  "Drove 35% efficiency improvement through forecasting and capacity models (92% accuracy).",
  "Analyzed 50,000+ customer transactions and $1.2M+ in revenue across cohort and retention studies.",
];

function fleschReadability(text: string): number {
  if (!text) return 0;
  const sentences = Math.max(1, (text.match(/[.!?]+/g) ?? []).length);
  const words = text.trim().split(/\s+/).filter(Boolean);
  const wordCount = Math.max(1, words.length);
  const syllables = words.reduce((acc, w) => acc + Math.max(1, (w.toLowerCase().match(/[aeiouy]+/g) ?? []).length), 0);
  const score = 206.835 - 1.015 * (wordCount / sentences) - 84.6 * (syllables / wordCount);
  return Math.round(Math.max(0, Math.min(100, score)));
}

function keywordStuffing(text: string, keywords: string[]): { stuffed: string[]; warning: boolean } {
  const lower = text.toLowerCase();
  const stuffed: string[] = [];
  for (const k of keywords) {
    const re = new RegExp(`\\b${k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    const count = (lower.match(re) ?? []).length;
    if (count >= 4) stuffed.push(k);
  }
  return { stuffed, warning: stuffed.length > 0 };
}

export const getResumeDiff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ resume_id: z.string().uuid().optional(), variant_key: z.string().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    let q = supabase.from("resume_versions").select("*").order("created_at", { ascending: false }).limit(1);
    if (data.resume_id) q = supabase.from("resume_versions").select("*").eq("id", data.resume_id).limit(1);
    else if (data.variant_key) q = supabase.from("resume_versions").select("*").eq("variant_key", data.variant_key).order("created_at", { ascending: false }).limit(1);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const tailored = rows?.[0];
    if (!tailored) return { tailored: null, master: null };

    const tailoredSkills: string[] = tailored.skills ?? [];
    const tailoredKeywords: string[] = tailored.keywords ?? [];
    const tailoredBullets: string[] = tailored.bullets ?? [];

    const skillsAdded = tailoredSkills.filter((s) => !MASTER_SKILLS.map((m) => m.toLowerCase()).includes(s.toLowerCase()));
    const keywordsAdded = tailoredKeywords.filter((k) => !MASTER_SKILLS.map((m) => m.toLowerCase()).includes(k.toLowerCase()));

    const bulletsBody = tailoredBullets.join(" ");
    const readability = fleschReadability(`${tailored.summary ?? ""} ${bulletsBody}`);
    const stuffing = keywordStuffing(bulletsBody, tailoredKeywords);

    const matchImprovement = (tailored.match_score ?? 0) - 70; // baseline assumed master 70

    return {
      tailored: {
        id: tailored.id,
        label: tailored.label,
        target_role: tailored.target_role,
        variant_key: tailored.variant_key,
        match_score: tailored.match_score ?? 0,
        summary: tailored.summary ?? "",
        skills: tailoredSkills,
        keywords: tailoredKeywords,
        bullets: tailoredBullets,
        explanation: tailored.explanation ?? "",
      },
      master: { summary: MASTER_SUMMARY, skills: MASTER_SKILLS, bullets: MASTER_BULLETS },
      diff: {
        skills_added: skillsAdded,
        keywords_added: keywordsAdded,
        bullets_changed: tailoredBullets.length,
        readability,
        stuffing_warning: stuffing.warning,
        stuffed_keywords: stuffing.stuffed,
        match_improvement: matchImprovement,
      },
    };
  });

const ENRICH_SYSTEM = `You are a job-search research analyst. Given a company name and a candidate target role, return STRICT JSON with intelligence about the company. Be concise and factual; if uncertain, say "unknown" rather than invent. Never invent funding rounds, headcounts, or news.`;

export const enrichCompany = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ company_id: z.string().uuid(), target_role: z.string().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

    const { data: company, error } = await supabase.from("companies").select("*").eq("id", data.company_id).maybeSingle();
    if (error || !company) throw new Error("Company not found");

    // cached intelligence in notes (if previously saved as JSON)
    if (company.notes && company.notes.startsWith("{")) {
      try {
        const cached = JSON.parse(company.notes);
        if (cached.__enriched_at && Date.now() - new Date(cached.__enriched_at).getTime() < 7 * 86400_000) {
          return { company, intelligence: cached };
        }
      } catch {}
    }

    const prompt = `Company: ${company.name}
Domain: ${company.domain ?? "unknown"}
Category: ${company.category ?? "unknown"}
Target role for candidate: ${data.target_role ?? "Data Analyst / Operations"}

Return JSON with keys:
- overview (2-3 sentences)
- industry (string)
- company_size (string, e.g. "51-200", "1001-5000")
- headquarters (string)
- funding_stage (string or "unknown")
- remote_culture (one of: "remote-first","hybrid","in-office","unknown")
- hiring_signals (array of 2-4 short strings)
- growth_signals (array of 2-4 short strings)
- interview_themes (array of 4-6 short strings — likely topics in interviews for the target role)
- role_competitiveness (one of: "low","medium","high","very high")
- keywords (array of 8-12 ATS keywords this company tends to look for)
- questions_to_ask (array of 4-6 thoughtful questions to ask the interviewer)
- red_flags (array of 0-4 risks; empty array if none)`;

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: ENRICH_SYSTEM }, { role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.3,
      }),
    });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`OpenAI ${resp.status}: ${txt.slice(0, 200)}`);
    }
    const json = await resp.json();
    const content = json.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content);
    const intelligence = { ...parsed, __enriched_at: new Date().toISOString() };

    // Cache JSON in notes (text column) — best effort
    await supabase.from("companies").update({ notes: JSON.stringify(intelligence) }).eq("id", data.company_id);

    // Log usage
    const usage = json.usage ?? {};
    await supabase.from("openai_usage").insert({
      user_id: userId, kind: "company_enrichment", model: "gpt-4o-mini", success: true,
      prompt_tokens: usage.prompt_tokens ?? 0, completion_tokens: usage.completion_tokens ?? 0,
      estimated_cost_cents: ((usage.prompt_tokens ?? 0) * 0.000015) + ((usage.completion_tokens ?? 0) * 0.000060),
    } as any);

    return { company, intelligence };
  });

export const listCompaniesForIntel = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("companies")
      .select("id, name, domain, category, trust_score, verification_status, notes, hiring_activity")
      .order("trust_score", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return {
      companies: (data ?? []).map((c: any) => {
        let cached: any = null;
        if (c.notes && c.notes.startsWith("{")) { try { cached = JSON.parse(c.notes); } catch {} }
        return { ...c, has_intelligence: !!cached, intelligence: cached };
      }),
    };
  });
