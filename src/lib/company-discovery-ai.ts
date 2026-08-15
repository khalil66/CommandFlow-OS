// ============================================================================
// Company Discovery Intelligence Layer — Phase 2: AI-assisted discovery.
//
// Deliberately isolated from company-discovery.ts (deterministic logic) per
// the "use AI only where it adds value" requirement. Every function here:
//   - is used ONLY for tasks that aren't reliably deterministic (candidate
//     suggestion, ambiguous remote-policy interpretation, similar-company
//     generation) — never for domain normalization, URL validation, ATS slug
//     parsing, dedup keys, timestamps, or status transitions (all of that is
//     in company-discovery.ts, with zero AI involved).
//   - stores confidence + provenance on its output.
//   - logs token usage to the existing openai_usage table, exactly like
//     enrichCompany() in intelligence.functions.ts already does.
//   - NEVER returns a "high confidence" remote-eligibility verdict — only the
//     deterministic classifier in company-discovery.ts can do that (see
//     classifyRemoteEligibilityAI below for why).
// ============================================================================

import { openAIFetch } from "./openai-fetch";

export interface AiCandidateCompany {
  name: string;
  domain_guess: string | null;
  careers_url_guess: string | null;
  reasoning: string;
  confidence: "high" | "medium" | "low";
  // Phase 2.6 addendum: an optional, UNTRUSTED hint at the company's ATS,
  // asked for alongside the generic careers page. Never used to skip
  // validation — src/lib/ats-resolver.ts still independently verifies any
  // of these before ever accepting them (see its Stage 4a).
  ats_provider_guess?: "Greenhouse" | "Lever" | "Ashby" | "Breezy" | null;
  ats_url_guess?: string | null;
  ats_slug_guess?: string | null;
}

export interface AiCandidateGenerationResult {
  candidates: AiCandidateCompany[];
  provenance: {
    model: string;
    prompt_summary: string;
    generated_at: string;
  };
}

const CANDIDATE_SYSTEM = `You are a company-discovery research assistant for a job-search automation tool. \
Given a targeting brief, suggest REAL, currently-operating companies that plausibly match it. \
Never invent companies. If you are not confident a company is real and currently operating, omit it \
rather than guess. Prefer companies you have high confidence use Greenhouse, Lever, Ashby, or Breezy \
for hiring, but it is fine to include companies where you are unsure of their ATS — that will be \
verified separately. Return STRICT JSON only.`;

async function callOpenAiJson(params: {
  apiKey: string;
  label: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<{ parsed: any; usage: { prompt_tokens: number; completion_tokens: number } }> {
  const resp = await openAIFetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${params.apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: params.systemPrompt },
          { role: "user", content: params.userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
      }),
    },
    { label: params.label }
  );
  const json: any = await resp.json();
  const content = json.choices?.[0]?.message?.content ?? "{}";
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = {};
  }
  const usage = json.usage ?? {};
  return {
    parsed,
    usage: { prompt_tokens: usage.prompt_tokens ?? 0, completion_tokens: usage.completion_tokens ?? 0 },
  };
}

/** Best-effort usage logging — mirrors enrichCompany's pattern exactly. Never throws. */
async function logAiUsage(
  supabase: any,
  userId: string,
  kind: string,
  model: string,
  usage: { prompt_tokens: number; completion_tokens: number },
  success: boolean
) {
  try {
    await supabase.from("openai_usage").insert({
      user_id: userId,
      kind,
      model,
      success,
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      estimated_cost_cents: usage.prompt_tokens * 0.000015 + usage.completion_tokens * 0.00006,
    } as any);
  } catch {
    // Usage logging is best-effort; never fail discovery because of it.
  }
}

// ----------------------------------------------------------------------------
// Level 2/4/6 candidate suggestion — ATS ecosystem / industry / long-tail.
// ----------------------------------------------------------------------------
export async function generateCandidateCompanies(params: {
  supabase: any;
  userId: string;
  apiKey: string;
  brief: string;         // e.g. "SaaS companies, 200-2000 employees, hiring Customer Success roles, US remote"
  excludeNames: string[]; // companies already known — asked to avoid resuggesting
  limit: number;          // capped by the caller to respect DISCOVERY_SAFETY_CAP_CEILINGS
}): Promise<AiCandidateGenerationResult> {
  const userPrompt = `Targeting brief: ${params.brief}

Companies already known (do NOT resuggest these): ${params.excludeNames.slice(0, 60).join(", ") || "none"}

Suggest up to ${Math.min(params.limit, 25)} real companies matching the brief.

For each company, also give your best guess at BOTH a generic careers page AND, if you specifically know it, a DIRECT supported-ATS job-board URL (Greenhouse/Lever/Ashby/Breezy) — but it is fine and expected to leave the ATS fields null/"Unknown" when you don't know; that will be verified separately and never trusted on your word alone.

Return JSON: { "candidates": [ { "name": string, "domain_guess": string|null, "careers_url_guess": string|null, "reasoning": string (1 sentence), "confidence": "high"|"medium"|"low", "ats_provider_guess": "Greenhouse"|"Lever"|"Ashby"|"Breezy"|"Unknown"|null, "ats_url_guess": string|null (a DIRECT ATS board URL, e.g. https://boards.greenhouse.io/{slug} — NOT just the generic careers page again; null if unsure), "ats_slug_guess": string|null } ] }`;

  const { parsed, usage } = await callOpenAiJson({
    apiKey: params.apiKey,
    label: `discovery:candidates:${params.brief.slice(0, 30)}`,
    systemPrompt: CANDIDATE_SYSTEM,
    userPrompt,
  });

  await logAiUsage(params.supabase, params.userId, "company_discovery_candidates", "gpt-4o-mini", usage, true);

  const candidates: AiCandidateCompany[] = Array.isArray(parsed.candidates)
    ? parsed.candidates
        .filter((c: any) => c && typeof c.name === "string" && c.name.trim().length > 0)
        .map((c: any) => ({
          name: String(c.name).trim(),
          domain_guess: c.domain_guess ? String(c.domain_guess).trim() : null,
          careers_url_guess: c.careers_url_guess ? String(c.careers_url_guess).trim() : null,
          reasoning: typeof c.reasoning === "string" ? c.reasoning.slice(0, 300) : "",
          confidence: (["high", "medium", "low"] as const).includes(c.confidence) ? c.confidence : "low",
          ats_provider_guess: (["Greenhouse", "Lever", "Ashby", "Breezy"] as const).includes(c.ats_provider_guess) ? c.ats_provider_guess : null,
          ats_url_guess: typeof c.ats_url_guess === "string" && c.ats_url_guess.trim() ? c.ats_url_guess.trim() : null,
          ats_slug_guess: typeof c.ats_slug_guess === "string" && c.ats_slug_guess.trim() ? c.ats_slug_guess.trim() : null,
        }))
    : [];

  return {
    candidates,
    provenance: { model: "gpt-4o-mini", prompt_summary: params.brief, generated_at: new Date().toISOString() },
  };
}

// ----------------------------------------------------------------------------
// Level 3 — similar-company expansion (feeds company_similarity).
// ----------------------------------------------------------------------------
export async function generateSimilarCompanies(params: {
  supabase: any;
  userId: string;
  apiKey: string;
  sourceCompany: {
    name: string;
    industry: string | null;
    company_size_estimate: string | null;
    ats_provider: string | null;
    remote_policy_summary: string | null;
  };
  limit: number;
}): Promise<AiCandidateGenerationResult & { sharedAttributes: Record<string, unknown> }> {
  const profile = params.sourceCompany;
  const userPrompt = `A company in our system performed well (strong role fit, response rate, or job quality):
Name: ${profile.name}
Industry: ${profile.industry ?? "unknown"}
Size: ${profile.company_size_estimate ?? "unknown"}
ATS: ${profile.ats_provider ?? "unknown"}
Remote policy: ${profile.remote_policy_summary ?? "unknown"}

Suggest up to ${Math.min(params.limit, 25)} REAL companies with a similar profile (similar industry, size band, remote philosophy, and ideally the same ATS). These will be validated separately — it's fine to be unsure of their exact ATS.

For each company, also give your best guess at BOTH a generic careers page AND, if you specifically know it, a DIRECT supported-ATS job-board URL (Greenhouse/Lever/Ashby/Breezy) — leave the ATS fields null/"Unknown" when unsure; that will be verified separately.

Return JSON: { "candidates": [ { "name": string, "domain_guess": string|null, "careers_url_guess": string|null, "reasoning": string, "confidence": "high"|"medium"|"low", "ats_provider_guess": "Greenhouse"|"Lever"|"Ashby"|"Breezy"|"Unknown"|null, "ats_url_guess": string|null, "ats_slug_guess": string|null } ] }`;

  const { parsed, usage } = await callOpenAiJson({
    apiKey: params.apiKey,
    label: `discovery:similar:${profile.name.slice(0, 24)}`,
    systemPrompt: CANDIDATE_SYSTEM,
    userPrompt,
  });

  await logAiUsage(params.supabase, params.userId, "company_discovery_similarity", "gpt-4o-mini", usage, true);

  const candidates: AiCandidateCompany[] = Array.isArray(parsed.candidates)
    ? parsed.candidates
        .filter((c: any) => c && typeof c.name === "string" && c.name.trim().length > 0)
        .map((c: any) => ({
          name: String(c.name).trim(),
          domain_guess: c.domain_guess ? String(c.domain_guess).trim() : null,
          careers_url_guess: c.careers_url_guess ? String(c.careers_url_guess).trim() : null,
          reasoning: typeof c.reasoning === "string" ? c.reasoning.slice(0, 300) : "",
          confidence: (["high", "medium", "low"] as const).includes(c.confidence) ? c.confidence : "low",
          ats_provider_guess: (["Greenhouse", "Lever", "Ashby", "Breezy"] as const).includes(c.ats_provider_guess) ? c.ats_provider_guess : null,
          ats_url_guess: typeof c.ats_url_guess === "string" && c.ats_url_guess.trim() ? c.ats_url_guess.trim() : null,
          ats_slug_guess: typeof c.ats_slug_guess === "string" && c.ats_slug_guess.trim() ? c.ats_slug_guess.trim() : null,
        }))
    : [];

  return {
    candidates,
    provenance: { model: "gpt-4o-mini", prompt_summary: `similar to ${profile.name}`, generated_at: new Date().toISOString() },
    sharedAttributes: {
      industry: profile.industry,
      company_size_estimate: profile.company_size_estimate,
      ats_provider: profile.ats_provider,
    },
  };
}

// ----------------------------------------------------------------------------
// AI fallback for ambiguous remote-policy text. IMPORTANT: this function's
// confidence is deliberately capped at "medium" — it can never return "high".
// Combined with the rule in company-discovery.ts that only "high" confidence
// may set usEligibleConfirmed=true, this guarantees an AI-derived read can
// NEVER by itself confirm US-remote eligibility. Only the deterministic
// regex classifier (reading explicit, unambiguous text) can do that. This is
// intentional — eligibility is a safety-relevant classification and AI output
// is treated as directional intelligence, not a confirmation source.
// ----------------------------------------------------------------------------
export async function classifyRemoteEligibilityAI(params: {
  supabase: any;
  userId: string;
  apiKey: string;
  jobText: string;
  companyName: string;
}): Promise<{
  eligibilityClass: "us_confirmed" | "global_us_eligible" | "north_america" | "mixed_role_dependent" | "us_excluded" | "unknown";
  confidence: "medium" | "low"; // capped — see note above
  reasoning: string;
}> {
  const userPrompt = `Job posting text from ${params.companyName} (truncated):
"""
${params.jobText.slice(0, 1500)}
"""

Classify whether a person LOCATED IN THE UNITED STATES could legally work this remote role, based only on what the text says. Do not guess beyond the text.

Return JSON: { "eligibility_class": "us_confirmed"|"global_us_eligible"|"north_america"|"mixed_role_dependent"|"us_excluded"|"unknown", "confidence": "medium"|"low", "reasoning": string (1 sentence) }`;

  const { parsed, usage } = await callOpenAiJson({
    apiKey: params.apiKey,
    label: `discovery:remote-eligibility:${params.companyName.slice(0, 24)}`,
    systemPrompt: "You are a careful, conservative remote-work-eligibility classifier. When uncertain, prefer \"unknown\" over guessing. Return STRICT JSON only.",
    userPrompt,
  });

  await logAiUsage(params.supabase, params.userId, "company_discovery_remote_eligibility", "gpt-4o-mini", usage, true);

  const validClasses = ["us_confirmed", "global_us_eligible", "north_america", "mixed_role_dependent", "us_excluded", "unknown"];
  const eligibilityClass = validClasses.includes(parsed.eligibility_class) ? parsed.eligibility_class : "unknown";
  // Hard cap: never trust the model's own "confidence" claim above "medium".
  const confidence: "medium" | "low" = parsed.confidence === "medium" ? "medium" : "low";

  return {
    eligibilityClass,
    confidence,
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning.slice(0, 300) : "",
  };
}

// ----------------------------------------------------------------------------
// Phase 2.6 addendum — ATS Resolver Stage 4b (src/lib/ats-resolver.ts): a
// last-resort AI guess at a company's supported-ATS job-board URL, used only
// when deterministic resolution (direct URL, careers-page link inspection,
// bounded pattern candidates) and the free candidate-generation hint all
// failed. IMPORTANT: this function's output is NEVER treated as validated —
// ats-resolver.ts independently re-checks every field this returns against
// the real ATS fetcher before accepting anything. This function's only job
// is to produce a candidate guess, restricted to exactly the 4 supported
// providers or "Unknown".
// ----------------------------------------------------------------------------
export async function generateAtsGuessAI(params: {
  supabase: any;
  userId: string;
  apiKey: string;
  companyName: string;
  domain: string | null;
  careersUrl: string | null;
}): Promise<{ provider: string | null; url: string | null; slug: string | null }> {
  const userPrompt = `Company: ${params.companyName}
Domain: ${params.domain ?? "unknown"}
Known careers page (generic — NOT necessarily an ATS job board): ${params.careersUrl ?? "unknown"}

We need to know whether this company uses one of exactly these four applicant-tracking systems for hiring: Greenhouse, Lever, Ashby, or Breezy. Return only one of "Greenhouse", "Lever", "Ashby", "Breezy", or "Unknown" — never any other ATS name, and never guess if you aren't reasonably confident.

If you know it, give the DIRECT ATS job-board URL — e.g. https://boards.greenhouse.io/{slug}, https://jobs.lever.co/{slug}, https://jobs.ashbyhq.com/{slug}, or https://{slug}.breezy.hr. Do NOT simply repeat the generic careers page URL above as your answer — if all you know is the generic page, return "Unknown" with null url/slug instead.

Return JSON: { "ats_provider": "Greenhouse"|"Lever"|"Ashby"|"Breezy"|"Unknown", "ats_url": string|null, "ats_slug": string|null }`;

  const { parsed, usage } = await callOpenAiJson({
    apiKey: params.apiKey,
    label: `discovery:ats-resolve:${params.companyName.slice(0, 24)}`,
    systemPrompt:
      "You identify which applicant-tracking system (if any of exactly Greenhouse, Lever, Ashby, or Breezy) a company uses, and its direct job-board URL. Never invent a URL. Never return a generic careers page as if it were an ATS board URL. Prefer \"Unknown\" over a low-confidence guess. Return STRICT JSON only.",
    userPrompt,
  });

  await logAiUsage(params.supabase, params.userId, "company_discovery_ats_resolution", "gpt-4o-mini", usage, true);

  const validProviders = ["Greenhouse", "Lever", "Ashby", "Breezy"];
  const provider = validProviders.includes(parsed.ats_provider) ? parsed.ats_provider : null;
  return {
    provider,
    url: typeof parsed.ats_url === "string" && parsed.ats_url.trim() ? parsed.ats_url.trim() : null,
    slug: typeof parsed.ats_slug === "string" && parsed.ats_slug.trim() ? parsed.ats_slug.trim() : null,
  };
}

// ----------------------------------------------------------------------------
// Industry / company-size classification for candidates missing structured
// data (used sparingly — only when deterministic signals are insufficient).
// ----------------------------------------------------------------------------
export async function classifyCompanyIndustryAI(params: {
  supabase: any;
  userId: string;
  apiKey: string;
  companyName: string;
  domain: string | null;
  sampleJobTitles: string[];
}): Promise<{ industry: string | null; companySizeEstimate: string | null; confidence: "medium" | "low" }> {
  const userPrompt = `Company: ${params.companyName}
Domain: ${params.domain ?? "unknown"}
Sample job titles posted: ${params.sampleJobTitles.slice(0, 10).join(", ") || "none"}

Classify this company's industry and estimated size band. If you are not reasonably confident, return null / "unknown" rather than guessing.

Return JSON: { "industry": string|null, "company_size_estimate": "1-50"|"51-200"|"201-500"|"501-2000"|"2001-10000"|"10000+"|null, "confidence": "medium"|"low" }`;

  const { parsed, usage } = await callOpenAiJson({
    apiKey: params.apiKey,
    label: `discovery:industry:${params.companyName.slice(0, 24)}`,
    systemPrompt: "You are a careful company-classification assistant. Prefer null over a low-confidence guess. Return STRICT JSON only.",
    userPrompt,
  });

  await logAiUsage(params.supabase, params.userId, "company_discovery_classification", "gpt-4o-mini", usage, true);

  return {
    industry: typeof parsed.industry === "string" ? parsed.industry : null,
    companySizeEstimate: typeof parsed.company_size_estimate === "string" ? parsed.company_size_estimate : null,
    confidence: parsed.confidence === "medium" ? "medium" : "low",
  };
}
