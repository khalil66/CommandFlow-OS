// ============================================================================
// Company Discovery Intelligence Layer — Phase 2.6 addendum: ATS Resolution.
//
// PROBLEM THIS SOLVES: Company Scout's direct detectAts() (./ats-detect.ts)
// only recognizes a URL that is ALREADY a supported ATS board URL (e.g.
// https://boards.greenhouse.io/acme). A live Dry Run B showed AI-suggested
// candidates almost always come back as a company's GENERIC careers page
// (https://zapier.com/jobs, https://slack.com/careers, ...) — detectAts()
// correctly reports these as "Unknown" and processCandidate() rejected all
// 11/11 candidates as unsupported_ats:Unknown, even though several of those
// real companies genuinely do use a supported ATS behind that generic page.
//
// This module adds a resolution stage that starts from a generic careers
// page / domain / company name and tries to reach a VERIFIED supported ATS
// endpoint — deterministic methods first, AI only as a last resort, and an
// AI suggestion is NEVER trusted until it's independently validated against
// the real ATS fetcher, exactly like every other candidate here.
//
// SCOPE / WHAT THIS FILE DOES NOT DO:
//   - Does not modify ./ats-detect.ts. Stage 1 below calls the real,
//     unmodified detectAts() — its regression behavior is unchanged (see
//     ats-resolver.test.ts's "existing detectAts() regression" test).
//   - Does not broaden production ingestion to unsupported ATS platforms.
//     A company that can't be resolved to Greenhouse/Lever/Ashby/Breezy is
//     still rejected exactly as before (unsupported_ats:Unknown).
//   - Never touches Supabase / any database. resolveCompanyAts()'s signature
//     has no database handle at all — structurally, it cannot write state.
//     (See ats-resolver.test.ts's "never writes DB state" test.)
//   - Never scrapes job descriptions — Stage 2 only extracts link URLs from
//     a careers page's raw HTML, never parses posting content.
//   - Never does unbounded crawling or probing — every stage funnels through
//     the same shared, hard-capped validation budget (MAX_CANDIDATE_ENDPOINTS).
//
// ARCHITECTURE: every external effect (fetching a careers page, validating a
// candidate ATS endpoint, asking AI for a guess) is passed in via `deps`
// (AtsResolverDeps) rather than imported and used directly inside the
// resolution algorithm. This is deliberate: Phase 2.6's Vitest-mocking work
// on fetchByPlatform (see company-discovery.functions.test.ts) proved that
// module-level `vi.mock`/`vi.doMock` interception is fragile across
// environments. Passing dependencies explicitly means ats-resolver.test.ts
// needs zero module mocking — tests just construct plain fake functions.
// ============================================================================

import { detectAts, type SupportedAts } from "./ats-detect";
import { fetchByPlatform, type NormJob } from "./ingest.functions";
import { generateAtsGuessAI } from "./company-discovery-ai";

export type AtsResolutionMethod =
  | "direct"
  | "career_page_link"
  | "known_url_pattern"
  | "ai_candidate"
  | "unresolved";

export type AtsResolutionConfidence = "high" | "medium" | "low";

export interface AtsCandidateEndpoint {
  provider: SupportedAts;
  url: string;
  slug: string;
  source: AtsResolutionMethod;
}

export interface AtsValidationAttempt {
  provider: SupportedAts;
  slug: string;
  url: string;
  source: AtsResolutionMethod;
  outcome: "valid" | "not_found" | "fetch_error";
  detail: string | null;
}

export interface AtsResolutionResult {
  resolved: boolean;
  provider: SupportedAts | null;
  careersUrl: string | null;
  slug: string | null;
  confidence: AtsResolutionConfidence;
  resolutionMethod: AtsResolutionMethod;
  validationEvidence: AtsValidationAttempt[];
}

export interface ResolveCompanyAtsInput {
  companyName: string;
  domain: string | null;
  careersUrl: string | null;
  // Optional hints already produced by AI candidate generation
  // (company-discovery-ai.ts's ats_provider_guess/ats_url_guess/
  // ats_slug_guess) — reused here at zero extra API cost, but NEVER trusted
  // until it passes the same validateAtsEndpoint() check as everything else.
  aiGuess?: {
    ats_provider_guess?: string | null;
    ats_url_guess?: string | null;
    ats_slug_guess?: string | null;
  } | null;
}

// ---- Injectable dependencies ----------------------------------------------
export interface AtsResolverDeps {
  // Fetches a careers page's HTML with strict, bounded limits (Stage 2).
  // Must never throw — any failure (timeout, non-2xx, oversized body,
  // network error) returns null; Stage 2 is best-effort and must never
  // abort resolution.
  fetchPage: (url: string) => Promise<{ status: number; body: string } | null>;
  // Validates ONE candidate ATS endpoint using the real, existing ATS
  // fetcher (ingest.functions.ts's fetchByPlatform in production). Returns
  // the jobs array on success (used only to confirm "responds successfully
  // + response format valid" — never persisted, never scored here), or null
  // if invalid/unreachable/empty.
  validateAtsEndpoint: (provider: SupportedAts, slug: string) => Promise<NormJob[] | null>;
  // Stage 4b — a FRESH AI call, only made when nothing else (including the
  // caller-supplied aiGuess hint) resolved anything. Optional: omit entirely
  // to disable AI assistance. Returns a raw, UNTRUSTED guess; the resolver
  // still runs it through validateAtsEndpoint before ever accepting it.
  generateAiAtsGuess?: (input: {
    companyName: string;
    domain: string | null;
    careersUrl: string | null;
  }) => Promise<{ provider: string | null; url: string | null; slug: string | null } | null>;
}

// ---- Safety limits (Phase 2.6 authorization, "Safety" section) -----------
export const MAX_CANDIDATE_ENDPOINTS = 8;
export const PAGE_FETCH_TIMEOUT_MS = 5000;
export const PAGE_MAX_REDIRECTS = 3;
export const PAGE_MAX_BYTES = 2_000_000; // 2MB cap on careers-page HTML read

const SUPPORTED_ATS: SupportedAts[] = ["Greenhouse", "Lever", "Ashby", "Breezy"];

function isSupportedAts(v: unknown): v is SupportedAts {
  return typeof v === "string" && (SUPPORTED_ATS as string[]).includes(v);
}

function urlForPattern(provider: SupportedAts, slug: string): string {
  switch (provider) {
    case "Greenhouse":
      return `https://boards.greenhouse.io/${slug}`;
    case "Lever":
      return `https://jobs.lever.co/${slug}`;
    case "Ashby":
      return `https://jobs.ashbyhq.com/${slug}`;
    case "Breezy":
      return `https://${slug}.breezy.hr`;
  }
}

// ---- Stage 2 helper: pull candidate ATS links out of raw careers-page HTML.
// Bounded scan (caps how many raw matches it collects before filtering) —
// never parses/extracts posting content, only href/URL-shaped substrings.
const HREF_RE = /href\s*=\s*["']([^"']+)["']/gi;
const BARE_URL_RE = /https?:\/\/[^\s"'<>)]+/gi;
const ATS_HOST_RE = /greenhouse\.io|lever\.co|ashbyhq\.com|breezy\.hr/i;

function extractAtsLinksFromHtml(html: string): string[] {
  const found = new Set<string>();
  let m: RegExpExecArray | null;

  HREF_RE.lastIndex = 0;
  while (found.size < 200 && (m = HREF_RE.exec(html))) {
    found.add(m[1]);
  }
  // Some careers pages link to their ATS via JS/data attributes rather than
  // a plain <a href>; also scan bare URL-shaped substrings as a fallback.
  BARE_URL_RE.lastIndex = 0;
  while (found.size < 400 && (m = BARE_URL_RE.exec(html))) {
    found.add(m[0]);
  }

  return [...found].filter((u) => ATS_HOST_RE.test(u));
}

// ---- Stage 3 helper: a small, bounded set of common-pattern guesses from
// the company's name/domain. NEVER treated as valid on their own — every
// one of these still has to pass validateAtsEndpoint() like any other
// candidate.
function slugify(input: string): string {
  return input.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "").slice(0, 60);
}

function domainToken(domain: string | null): string | null {
  if (!domain) return null;
  const base = domain.split(".")[0];
  return base ? base.toLowerCase().replace(/[^a-z0-9]/g, "") : null;
}

function buildKnownUrlPatternCandidates(companyName: string, domain: string | null): AtsCandidateEndpoint[] {
  const slugs = new Set<string>();
  const nameSlug = slugify(companyName);
  if (nameSlug) slugs.add(nameSlug);
  const domSlug = domainToken(domain);
  if (domSlug) slugs.add(domSlug);

  const out: AtsCandidateEndpoint[] = [];
  for (const slug of slugs) {
    for (const provider of SUPPORTED_ATS) {
      out.push({ provider, url: urlForPattern(provider, slug), slug, source: "known_url_pattern" });
    }
  }
  return out;
}

// ----------------------------------------------------------------------------
// Main entry point.
// ----------------------------------------------------------------------------
export async function resolveCompanyAts(
  input: ResolveCompanyAtsInput,
  deps: AtsResolverDeps
): Promise<AtsResolutionResult> {
  const validationEvidence: AtsValidationAttempt[] = [];
  const attemptedKeys = new Set<string>();
  let attempts = 0;

  async function tryValidate(candidate: AtsCandidateEndpoint): Promise<AtsResolutionResult | null> {
    const key = `${candidate.provider}:${candidate.slug}`;
    if (attemptedKeys.has(key)) return null; // never re-test the same (provider, slug)
    if (attempts >= MAX_CANDIDATE_ENDPOINTS) return null; // hard cap — no unlimited probing
    attemptedKeys.add(key);
    attempts++;

    try {
      const jobs = await deps.validateAtsEndpoint(candidate.provider, candidate.slug);
      if (jobs && jobs.length > 0) {
        validationEvidence.push({
          provider: candidate.provider, slug: candidate.slug, url: candidate.url, source: candidate.source,
          outcome: "valid", detail: `${jobs.length} job(s) returned`,
        });
        const confidence: AtsResolutionConfidence =
          candidate.source === "direct" || candidate.source === "career_page_link" ? "high"
          : candidate.source === "known_url_pattern" ? "medium"
          : "low"; // ai_candidate
        return {
          resolved: true,
          provider: candidate.provider,
          careersUrl: candidate.url,
          slug: candidate.slug,
          confidence,
          resolutionMethod: candidate.source,
          validationEvidence,
        };
      }
      validationEvidence.push({
        provider: candidate.provider, slug: candidate.slug, url: candidate.url, source: candidate.source,
        outcome: "not_found", detail: "endpoint returned zero jobs / invalid response",
      });
      return null;
    } catch (e: any) {
      validationEvidence.push({
        provider: candidate.provider, slug: candidate.slug, url: candidate.url, source: candidate.source,
        outcome: "fetch_error", detail: (e?.message || String(e)).slice(0, 200),
      });
      return null;
    }
  }

  // ---- Stage 1: direct detectAts() on the supplied URL (unmodified) -------
  if (input.careersUrl) {
    const det = detectAts(input.careersUrl);
    if (det.supported && det.slug && isSupportedAts(det.platform)) {
      const result = await tryValidate({ provider: det.platform, url: input.careersUrl, slug: det.slug, source: "direct" });
      if (result) return result;
      // URL LOOKED like a supported ATS board but failed live validation
      // (e.g. renamed/removed slug) — fall through to later stages instead
      // of trusting the URL shape alone.
    }
  }

  // ---- Stage 2: inspect the actual careers page for links to a supported
  // ATS. Single page fetch only — no recursive crawling of extracted links
  // (they're validated via the ATS API, never re-fetched as HTML). --------
  if (input.careersUrl && attempts < MAX_CANDIDATE_ENDPOINTS) {
    const page = await deps.fetchPage(input.careersUrl);
    if (page && page.status >= 200 && page.status < 300 && page.body) {
      const links = extractAtsLinksFromHtml(page.body);
      for (const link of links) {
        if (attempts >= MAX_CANDIDATE_ENDPOINTS) break;
        const det = detectAts(link);
        if (det.supported && det.slug && isSupportedAts(det.platform)) {
          const result = await tryValidate({ provider: det.platform, url: link, slug: det.slug, source: "career_page_link" });
          if (result) return result;
        }
      }
    }
  }

  // ---- Stage 3: bounded common-pattern guesses from name/domain ----------
  if (attempts < MAX_CANDIDATE_ENDPOINTS) {
    for (const candidate of buildKnownUrlPatternCandidates(input.companyName, input.domain)) {
      if (attempts >= MAX_CANDIDATE_ENDPOINTS) break;
      const result = await tryValidate(candidate);
      if (result) return result;
    }
  }

  // ---- Stage 4a: reuse the AI hint already produced by candidate
  // generation (company-discovery-ai.ts's ats_*_guess fields), if any —
  // zero extra OpenAI cost. Still fully unvalidated until tryValidate. -----
  if (attempts < MAX_CANDIDATE_ENDPOINTS && input.aiGuess?.ats_provider_guess && isSupportedAts(input.aiGuess.ats_provider_guess)) {
    const provider = input.aiGuess.ats_provider_guess;
    let slug = input.aiGuess.ats_slug_guess || null;
    const guessedUrl = input.aiGuess.ats_url_guess || null;
    if (!slug && guessedUrl) {
      const det = detectAts(guessedUrl);
      if (det.supported && det.slug) slug = det.slug;
    }
    if (slug) {
      const result = await tryValidate({ provider, url: guessedUrl ?? urlForPattern(provider, slug), slug, source: "ai_candidate" });
      if (result) return result;
    }
  }

  // ---- Stage 4b: fresh AI call, only if everything deterministic (and the
  // free AI hint) failed, and only if the caller opted in by providing
  // generateAiAtsGuess. The AI is asked explicitly for one of exactly the 4
  // supported providers or "Unknown" — see generateAtsGuessAI's prompt in
  // company-discovery-ai.ts. Its answer is STILL run through the same
  // tryValidate() as every other candidate before ever being accepted. -----
  if (attempts < MAX_CANDIDATE_ENDPOINTS && deps.generateAiAtsGuess) {
    try {
      const guess = await deps.generateAiAtsGuess({
        companyName: input.companyName, domain: input.domain, careersUrl: input.careersUrl,
      });
      if (guess?.provider && isSupportedAts(guess.provider)) {
        let slug = guess.slug || null;
        if (!slug && guess.url) {
          const det = detectAts(guess.url);
          if (det.supported && det.slug) slug = det.slug;
        }
        if (slug) {
          const result = await tryValidate({
            provider: guess.provider, url: guess.url ?? urlForPattern(guess.provider, slug), slug, source: "ai_candidate",
          });
          if (result) return result;
        }
      }
    } catch {
      // AI Stage 4b is best-effort — a failure here must resolve exactly
      // like "AI found nothing", never differently or fatally.
    }
  }

  return {
    resolved: false,
    provider: null,
    careersUrl: null,
    slug: null,
    confidence: "low",
    resolutionMethod: "unresolved",
    validationEvidence,
  };
}

// ----------------------------------------------------------------------------
// Production dependency wiring. Kept separate from resolveCompanyAts() itself
// so the resolution algorithm never directly imports fetch/Supabase/OpenAI —
// only this factory does, and only to build the deps object a caller injects.
// ----------------------------------------------------------------------------

// Real production careers-page fetch: GET only, no credentials sent (plain
// fetch() with no cookie jar / auth header), bounded timeout, bounded
// manually-followed redirect count, bounded response size.
export async function defaultFetchPage(url: string): Promise<{ status: number; body: string } | null> {
  let currentUrl = url;
  for (let hop = 0; hop <= PAGE_MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PAGE_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { Accept: "text/html,application/xhtml+xml" },
      });
    } catch {
      clearTimeout(timer);
      return null;
    }
    clearTimeout(timer);

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return null;
      try {
        currentUrl = new URL(loc, currentUrl).toString();
      } catch {
        return null;
      }
      continue; // consume one of the bounded redirect hops
    }
    if (res.status < 200 || res.status >= 400) {
      return { status: res.status, body: "" };
    }
    const contentLength = res.headers.get("content-length");
    if (contentLength && Number(contentLength) > PAGE_MAX_BYTES) {
      return { status: res.status, body: "" }; // too large — no usable body
    }
    let text: string;
    try {
      text = await res.text();
    } catch {
      return null;
    }
    if (text.length > PAGE_MAX_BYTES) text = text.slice(0, PAGE_MAX_BYTES);
    return { status: res.status, body: text };
  }
  return null; // exceeded the bounded redirect count
}

// Real production validateAtsEndpoint: reuses the EXISTING ATS fetcher
// (ingest.functions.ts) rather than building a second one — "the
// corresponding ATS fetcher responds successfully" per the Phase 2.6
// authorization's validation-behavior requirement.
async function defaultValidateAtsEndpoint(provider: SupportedAts, slug: string): Promise<NormJob[] | null> {
  try {
    const jobs = await fetchByPlatform(provider, slug);
    return jobs.length > 0 ? jobs : null;
  } catch {
    return null;
  }
}

export function buildDefaultAtsResolverDeps(params: {
  supabase: any;
  userId: string;
  apiKey: string | null;
}): AtsResolverDeps {
  return {
    fetchPage: defaultFetchPage,
    validateAtsEndpoint: defaultValidateAtsEndpoint,
    generateAiAtsGuess: params.apiKey
      ? async ({ companyName, domain, careersUrl }) =>
          generateAtsGuessAI({
            supabase: params.supabase, userId: params.userId, apiKey: params.apiKey!,
            companyName, domain, careersUrl,
          })
      : undefined,
  };
}
