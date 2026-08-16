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
// V2 (Phase 2.6 resolver v2) ADDS, on top of the original resolver:
//   - Redirect-landing detection: if the supplied careers page itself
//     redirects straight to a supported ATS URL (rather than merely linking
//     to one in its HTML), that's recognized as its own resolution method
//     ("career_page_redirect") instead of being silently absorbed into the
//     generic page fetch.
//   - Job-URL -> company-board normalization made explicit: a link found on
//     a careers page that points at an individual posting (e.g.
//     boards.greenhouse.io/acme/jobs/12345) is normalized down to the
//     canonical company board (boards.greenhouse.io/acme) and labeled
//     "canonical_link" — distinct from "career_page_link", which is used
//     when the page already links directly to the board root.
//   - Unsupported-provider detection: if a careers page clearly links to a
//     recognized-but-rejected ATS (Workday, Taleo, iCIMS, SAP SuccessFactors,
//     Oracle, Brassring), that intelligence is preserved on the result
//     (resolutionStatus: "unsupported_provider", detectedUnsupportedProvider)
//     instead of being indistinguishable from a plain "nothing found" miss.
//     This still never resolves the company — it still cannot become an
//     active job source — it only makes the REASON more specific.
//   - Broader deterministic slug candidates: in addition to the company name
//     and domain, Stage 3 now also tries the normalized (suffix-stripped)
//     company name, the careers-page hostname, and the AI's slug hint (if
//     any) as additional slug variants — cross-checked against all 4
//     supported providers, never trusting the AI's claimed provider without
//     validation.
//   - Extra telemetry on the result (attemptCount, careerPageChecked,
//     validatedJobCount) so a caller (the dry-run report) can report
//     aggregate resolution-method/rate metrics.
//
// V2.1 (smart validation-budget allocation) ADDS, on top of V2:
//   - PROBLEM: V2's Stage 3 (deterministic name/domain/hostname pattern
//     guessing) ran BEFORE the free AI-hint reuse, and could generate enough
//     slug x provider combinations on its own to exhaust the entire shared
//     MAX_CANDIDATE_ENDPOINTS budget before the AI-hint stage ever got a
//     turn — observed live as Monday.com reaching attemptCount=8, still
//     unresolved, with ai_hint_resolution_count=0 across the run. The AI
//     hint costs nothing extra (it's already-generated candidate-generation
//     metadata) and deserved a guaranteed shot.
//   - FIX #1 — reordering: the free AI-hint reuse (reusing
//     ats_provider_guess/ats_url_guess/ats_slug_guess from candidate
//     generation, at zero extra OpenAI cost) now runs immediately after the
//     careers-page stage and BEFORE the broad deterministic pattern search.
//     It's evidence-tiered into two checks: a Tier 1 check (the AI's own
//     URL is already ATS-shaped — concrete "direct evidence", just
//     AI-sourced) and a Tier 2 check (the AI's explicit provider+slug
//     pairing, trusted only as a candidate to validate, never as fact).
//   - FIX #2 — reservation: the broad deterministic pattern search (now
//     split into Tier 3 "structural" guesses — domain stem, careers-page
//     hostname — and Tier 4 "broader" guesses — company name, normalized
//     name, AI slug hint cross-checked against every provider) self-limits
//     to leave AI_FRESH_CALL_RESERVE attempts unspent whenever a fresh AI
//     call (Stage 4b) is actually configured, so pattern guessing can never
//     fully starve it. If AI assistance isn't configured at all, no budget
//     is held back — nothing to reserve it for.
//   - Evidence tiers are attached to each AtsCandidateEndpoint as an
//     explicit `priority` (1 = strongest ... 4 = weakest) and the Stage 3/4
//     candidate list is built as one deduplicated, presorted queue before
//     any validation call is made, rather than scattering the ordering
//     logic across the stage.
//   - New telemetry: attemptsBySource (per-method attempt tally, not just
//     the winning method), attemptBudgetMax/Used/Remaining.
//   - No change to MAX_CANDIDATE_ENDPOINTS itself, to resolutionMethod
//     semantics, to unsupported-provider detection, or to what counts as
//     "resolved" — this is purely about WHEN each candidate gets tried, not
//     what gets trusted or how many total attempts are allowed.
//
// V2.2 (evidence quality + honest classification) ADDS, on top of V2.1:
//   ROOT-CAUSE CONTEXT: a live Dry Run C (45% resolution) plus direct,
//   controlled HTTP inspection of all 11 unresolved companies showed that
//   NONE of them would flip to resolved purely from better HTML-evidence
//   extraction — the real gaps were: JS-rendered career pages with no
//   server-rendered job data (Shopify, HubSpot, Toggl), acquired/dead
//   companies redirecting off-domain (Drift's meta-refresh to a marketing
//   page, InVision's redirect to a competitor's homepage), a self-hosted
//   non-ATS careers tool (Basecamp/37signals), acquirer-domain redirects
//   with unclear ATS (Trello/Loom -> Atlassian), a company genuinely using
//   no supported ATS (Salesforce), and — the one genuinely actionable case —
//   Monday.com, whose Next.js careers page embeds structured job data with
//   `"source":"ashby"` on every posting (deterministic proof of the real
//   ATS) but exposes no public jobs.ashbyhq.com board under any guessable
//   slug (confirmed by directly probing Ashby's public API with 6 plausible
//   slugs — all 404). V2.2 therefore focuses on (a) general evidence-
//   extraction capabilities that will help OTHER companies shaped like the
//   ones that already resolve, (b) evidence-ranked slug candidates instead
//   of blind cross-provider guessing, (c) a real multi-candidate AI
//   contract, and (d) HONEST classification of what actually happened —
//   not a guaranteed resolution-rate jump on any one sample.
//
//   - Broader careers-page evidence extraction: in addition to `href=`
//     links, now also scans `src=` (script/iframe) and `action=` (form)
//     attribute values, plus a conservative structured-JSON provider hint
//     (`"source":"ashby"`-shaped key/value pairs) — never a bare
//     provider-name word match, which a live check (Doist's marketing copy
//     "...shape the *workday* for millions...") proved is a real
//     false-positive risk. A provider hint alone NEVER resolves anything —
//     it only reprioritizes which provider Stage 3's pattern guesses try
//     first (see below); it still requires full endpoint validation.
//   - Meta-refresh redirect following: `defaultFetchPage()` now also
//     recognizes `<meta http-equiv="refresh" content="N;url=...">` as a
//     redirect hop (bounded by the same PAGE_MAX_REDIRECTS budget as HTTP
//     redirects) — a real gap found live (Drift's careers URL is exactly
//     this, meta-refreshing to a marketing page).
//   - Redirect-target structural evidence: when the careers-page fetch
//     lands somewhere else that ISN'T itself ATS-shaped, that landing
//     hostname is added as an additional Tier 3 slug source (the company's
//     REAL recruiting domain may differ from its marketing domain).
//   - Evidence-ranked slug candidates: Stage 3 gained a hyphen-preserving
//     name-slug variant (many ATS tenants use hyphenated slugs) and, when a
//     structured provider hint was found, candidates for that provider are
//     tried before candidates for the other 3 — still bounded, still
//     deduplicated, still funneled through the same shared budget; never an
//     uncontrolled combinatorial explosion.
//   - AI ranked-candidate contract (Stage 4b): generateAiAtsGuess now
//     returns up to 3 ranked candidates (see AiAtsRankedCandidate) instead
//     of one guess. Consumed strongest-confidence-first, each independently
//     validated, deduplicated against anything already attempted, and
//     capped by the same shared budget — the AI may PROPOSE, never approve.
//   - Honest unresolved classification: resolutionStatus gains
//     "no_supported_ats_evidence" (fetch succeeded, but literally nothing
//     ATS-shaped was found anywhere — supported OR rejected) and
//     "stale_or_inactive_company" (the careers page redirected off the
//     company's own domain to what looks like a dead end — a tiny
//     meta-refresh stub, or a bare homepage root with no job content) —
//     both are strict refinements of "unresolved", never upgrades to
//     "resolved", and "unsupported_provider" keeps its existing precedence
//     and its existing strict evidence requirement (a real ATS HOSTNAME
//     match via detectAts() — never a word-in-prose heuristic).
//   - Attempt-economics telemetry: successfulAttemptsBySource /
//     failedAttemptsBySource (win vs. miss per method) and
//     aiCandidatesGenerated/Validated/Successful, so a caller can measure
//     which stages are actually earning their network cost.
//
// SCOPE / WHAT THIS FILE DOES NOT DO:
//   - Does not modify ./ats-detect.ts. Every stage below calls the real,
//     unmodified detectAts() — its regression behavior is unchanged (see
//     ats-resolver.test.ts's "existing detectAts() regression" test).
//   - Does not broaden production ingestion to unsupported ATS platforms.
//     A company that can't be resolved to Greenhouse/Lever/Ashby/Breezy is
//     still rejected exactly as before (unsupported_ats:Unknown, or now
//     unsupported_ats:<DetectedProvider> when that's known).
//   - Never touches Supabase / any database. resolveCompanyAts()'s signature
//     has no database handle at all — structurally, it cannot write state.
//     (See ats-resolver.test.ts's "never writes DB state" test.)
//   - Never scrapes job descriptions — the careers-page stage only extracts
//     link/attribute URLs and a narrow structured-JSON provider hint from
//     raw HTML, never parses posting content.
//   - Never executes JavaScript and never launches a browser — every new
//     evidence source (script src, iframe src, form action, embedded JSON)
//     is extracted via bounded regex scanning of the raw HTML text that was
//     already fetched, not by rendering the page.
//   - Never does unbounded crawling or probing — every stage funnels through
//     the same shared, hard-capped validation budget (MAX_CANDIDATE_ENDPOINTS).
//     Unsupported-provider detection, provider-hint detection, and
//     redirect-target inspection are detectAts()/regex-only checks (no
//     network call), so they never consume that budget themselves.
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

import { detectAts, type SupportedAts, type RejectedAts } from "./ats-detect";
import { fetchByPlatform, type NormJob } from "./ingest.functions";
import { generateAtsGuessAI, type AiAtsRankedCandidate } from "./company-discovery-ai";
import { normalizeCompanyName } from "./company-discovery";

export type { AiAtsRankedCandidate };

export type AtsResolutionMethod =
  | "canonical_link"
  | "career_page_link"
  | "career_page_redirect"
  | "known_url_pattern"
  | "ai_hint_validated"
  | "unresolved";

export type AtsResolutionConfidence = "high" | "medium" | "low";

// Phase 2.6 v2.2: refined beyond the original 3-state status. All new states
// are strict refinements of "not resolved" — none of them ever grant a
// company an active job source; they only make the REASON more specific and
// more honest than a generic "unresolved" catch-all.
//   resolved                  — a real endpoint was found AND validated.
//   unsupported_provider      — deterministic evidence (a real ATS hostname,
//                                via detectAts()) of a RECOGNIZED but
//                                unsupported ATS (Workday, Taleo, etc).
//                                Highest precedence among the failure states.
//   stale_or_inactive_company — the careers page redirected off the
//                                company's own domain to something that
//                                looks like a dead end (a tiny meta-refresh
//                                stub, or a bare homepage root with no job
//                                content) rather than a real careers
//                                destination.
//   no_supported_ats_evidence — the careers page was fetched successfully
//                                and read in full, but literally nothing
//                                ATS-shaped (supported OR rejected, in a
//                                link/script/iframe/form/JSON hint) was
//                                found anywhere in it, AND every pattern
//                                guess still failed.
//   unresolved                — the generic fallback: either the page fetch
//                                itself failed/was never attempted, or SOME
//                                ATS-shaped evidence existed but nothing
//                                ever validated.
export type AtsResolutionStatus =
  | "resolved"
  | "unsupported_provider"
  | "stale_or_inactive_company"
  | "no_supported_ats_evidence"
  | "unresolved";

// Evidence-strength tier (Phase 2.6 v2.1) — lower number = stronger, tried
// earlier. Attached to every candidate so the deterministic pattern queue
// (Tiers 3/4) can be built, deduplicated, and sorted BEFORE any validation
// call is made, rather than scattering ordering/budget logic across stages.
//   1 = direct evidence (input URL, career-page link/redirect, AI's own URL)
//   2 = AI's explicit provider+slug pairing
//   3 = structural identity guesses (domain stem, careers-page hostname,
//       redirect-target hostname)
//   4 = broader guesses (company name, normalized name, hyphenated name, AI
//       slug hint cross-checked against every provider)
export type AtsEvidenceTier = 1 | 2 | 3 | 4;

export interface AtsCandidateEndpoint {
  provider: SupportedAts;
  url: string;
  slug: string;
  source: AtsResolutionMethod;
  priority: AtsEvidenceTier;
}

export interface AtsAttemptsBySource {
  canonical_link: number;
  career_page_link: number;
  career_page_redirect: number;
  known_url_pattern: number;
  ai_hint_validated: number;
}

export interface AtsValidationAttempt {
  provider: SupportedAts;
  slug: string;
  url: string;
  source: AtsResolutionMethod;
  outcome: "valid" | "not_found" | "fetch_error";
  detail: string | null;
  jobCount?: number;
}

export interface AtsResolutionResult {
  resolved: boolean;
  resolutionStatus: AtsResolutionStatus;
  provider: SupportedAts | null;
  careersUrl: string | null;
  slug: string | null;
  confidence: AtsResolutionConfidence;
  resolutionMethod: AtsResolutionMethod;
  validationEvidence: AtsValidationAttempt[];
  // Telemetry (Phase 2.6 v2, point 6) ----------------------------------------
  attemptCount: number;              // number of validateAtsEndpoint calls made
  careerPageChecked: boolean;        // whether Stage 2's page fetch was attempted
  detectedUnsupportedProvider: RejectedAts | null;
  validatedJobCount: number | null;  // job count backing the winning resolution, if any
  // Telemetry (Phase 2.6 v2.1, point 8) ---------------------------------------
  attemptsBySource: AtsAttemptsBySource; // per-method attempt tally (win or lose)
  attemptBudgetMax: number;              // === MAX_CANDIDATE_ENDPOINTS
  attemptBudgetUsed: number;             // === attemptCount, exposed under the budget-telemetry name too
  attemptBudgetRemaining: number;        // attemptBudgetMax - attemptBudgetUsed
  // Telemetry (Phase 2.6 v2.2, point 6/8) -------------------------------------
  successfulAttemptsBySource: AtsAttemptsBySource; // per-method attempt tally, "valid" outcomes only
  failedAttemptsBySource: AtsAttemptsBySource;     // per-method attempt tally, not_found + fetch_error
  aiCandidatesGenerated: number;   // how many ranked candidates Stage 4b's AI call proposed
  aiCandidatesValidated: number;   // how many of those were actually run through tryValidate
  aiCandidatesSuccessful: number;  // how many of those resolved (0 or 1)
  detectedProviderHint: SupportedAts | null; // structured-JSON provider hint (e.g. "source":"ashby") — NEVER trusted alone, only reprioritizes Stage 3
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
  // abort resolution. `finalUrl` is the URL actually reached after
  // following redirects — HTTP 3xx AND meta-refresh alike (equal to the
  // requested URL when there was neither) — it's how the resolver detects a
  // careers page that redirects straight to a supported ATS board (or, v2.2,
  // to a dead end off the company's own domain).
  fetchPage: (url: string) => Promise<{ status: number; body: string; finalUrl: string } | null>;
  // Validates ONE candidate ATS endpoint using the real, existing ATS
  // fetcher (ingest.functions.ts's fetchByPlatform in production). Returns
  // the jobs array on success (used only to confirm "responds successfully
  // + response format valid" — never persisted, never scored here), or null
  // if invalid/unreachable/empty.
  validateAtsEndpoint: (provider: SupportedAts, slug: string) => Promise<NormJob[] | null>;
  // Stage 4b — a FRESH AI call, only made when nothing else (including the
  // caller-supplied aiGuess hint) resolved anything. Optional: omit entirely
  // to disable AI assistance. Returns a RANKED LIST of at most 3 raw,
  // UNTRUSTED candidate guesses (may be empty — the AI should never fabricate
  // certainty); the resolver still runs each one through validateAtsEndpoint,
  // strongest-confidence-first, before ever accepting anything.
  generateAiAtsGuess?: (input: {
    companyName: string;
    domain: string | null;
    careersUrl: string | null;
  }) => Promise<AiAtsRankedCandidate[]>;
}

// ---- Safety limits (Phase 2.6 authorization, "Safety" section) -----------
export const MAX_CANDIDATE_ENDPOINTS = 8;
export const PAGE_FETCH_TIMEOUT_MS = 5000;
export const PAGE_MAX_REDIRECTS = 3;
export const PAGE_MAX_BYTES = 2_000_000; // 2MB cap on careers-page HTML read

// Phase 2.6 v2.1 — reserved for Stage 4b's FRESH AI call (a real OpenAI
// round-trip, only made as a last resort). Broad deterministic pattern
// guessing (Tiers 3/4) self-limits so it can never spend this reserve —
// only applies when a fresh-call capability is actually configured; there's
// nothing to reserve room for otherwise, and the full budget flows to
// pattern guessing instead ("unused reserved attempts flow to lower-priority
// stages").
export const AI_FRESH_CALL_RESERVE = 2;

// Phase 2.6 v2.2 — hard ceiling on how many AI-proposed candidates Stage 4b
// will ever consider, regardless of how many the model returns. Each is
// still independently validated and still shares the same overall
// MAX_CANDIDATE_ENDPOINTS budget — this is a defense-in-depth cap on the AI
// response shape itself, not a separate budget.
export const AI_RANKED_CANDIDATE_MAX = 3;

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

// True when `url` is already an exact board-root URL for `provider` (no
// extra path segments beyond the slug) — as opposed to an individual
// job-posting URL that merely happens to live under the same board.
function isExactBoardRoot(provider: SupportedAts, url: string): boolean {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    if (provider === "Breezy") return path === "" || path === "/";
    const segments = path.split("/").filter(Boolean);
    return segments.length === 1;
  } catch {
    return false;
  }
}

// ---- Stage 2 helper: pull candidate ATS links out of raw careers-page HTML.
// Bounded scan (caps how many raw matches it collects before filtering) —
// never parses/extracts posting content, only attribute-value/URL-shaped
// substrings. Deliberately matches BOTH supported and recognized-but-
// unsupported ATS hosts — detectAts() classifies each match, so unsupported
// providers can be detected (and their identity preserved) rather than
// silently discarded.
//
// Phase 2.6 v2.2 broadens the scan beyond plain `<a href>` links to also
// cover `src=` (covers both `<script src>` and `<iframe src>` in one
// pattern) and `action=` (form submission targets) — a supported ATS is
// sometimes embedded via a script tag or an iframe rather than a visible
// link. The pre-existing bare-URL scan already covers ATS URLs embedded
// inside inline JSON/JS (e.g. Next.js's server-rendered __NEXT_DATA__ blob)
// since it scans raw text regardless of surrounding markup.
const HREF_RE = /href\s*=\s*["']([^"']+)["']/gi;
const SRC_RE = /\bsrc\s*=\s*["']([^"']+)["']/gi;
const ACTION_RE = /\baction\s*=\s*["']([^"']+)["']/gi;
const BARE_URL_RE = /https?:\/\/[^\s"'<>)]+/gi;
const ATS_HOST_RE =
  /greenhouse\.io|lever\.co|ashbyhq\.com|breezy\.hr|myworkdayjobs\.com|workday\.com|taleo\.net|successfactors\.com|sapsf\.com|icims\.com|oraclecloud\.com|brassring\.com|kenexa\.com/i;

function extractAtsLinksFromHtml(html: string): string[] {
  const found = new Set<string>();
  let m: RegExpExecArray | null;

  const scan = (re: RegExp, group: number, cap: number) => {
    re.lastIndex = 0;
    while (found.size < cap && (m = re.exec(html))) {
      found.add(m[group]);
    }
  };

  scan(HREF_RE, 1, 220);
  scan(SRC_RE, 1, 300);
  scan(ACTION_RE, 1, 350);
  // Some careers pages link to their ATS via JS/data attributes rather than
  // a plain <a href>, or embed it inside inline JSON; also scan bare
  // URL-shaped substrings as a fallback.
  scan(BARE_URL_RE, 0, 400);

  return [...found].filter((u) => ATS_HOST_RE.test(u));
}

// ---- Stage 2 helper (Phase 2.6 v2.2): a conservative, structured-JSON
// provider hint — matches ONLY a quoted key/value pair like `"source":
// "ashby"`, never a bare provider-name word anywhere in the page. This
// distinction is load-bearing: a live check of Doist's careers page found
// the bare word "workday" appearing in ordinary marketing prose ("...shape
// the workday for millions worldwide...") — a naive word-match would have
// falsely flagged Doist as using the Workday ATS. This hint is NEVER
// trusted as fact and can never resolve anything by itself — it only
// reprioritizes which provider Stage 3's pattern guesses try first; the
// candidate it produces still goes through full endpoint validation like
// everything else.
const PROVIDER_HINT_RE =
  /"(?:source|ats|provider|ats_provider|atsProvider|job_board|jobBoard)"\s*:\s*"(greenhouse|lever|ashby|breezy)"/i;

function extractProviderHint(html: string): SupportedAts | null {
  const m = PROVIDER_HINT_RE.exec(html);
  if (!m) return null;
  const raw = m[1].toLowerCase();
  const canonical = SUPPORTED_ATS.find((p) => p.toLowerCase() === raw);
  return canonical ?? null;
}

// ---- Stage 2 helper (Phase 2.6 v2.2): meta-refresh redirect target, e.g.
// <meta http-equiv="refresh" content="0; url=https://example.com/target">.
// Exported for direct unit testing; wired into defaultFetchPage's bounded
// redirect-following loop so a meta-refresh is treated the same as an HTTP
// 3xx redirect (same PAGE_MAX_REDIRECTS hop budget, same "never throws"
// contract).
const META_REFRESH_RE =
  /<meta[^>]+http-equiv\s*=\s*["']refresh["'][^>]*content\s*=\s*["']\s*\d+\s*;\s*url\s*=\s*([^"'>]+)["']/i;

export function extractMetaRefreshTarget(html: string, baseUrl: string): string | null {
  const m = META_REFRESH_RE.exec(html);
  if (!m) return null;
  try {
    return new URL(m[1].trim(), baseUrl).toString();
  } catch {
    return null;
  }
}

// ---- Stage 2 helper (Phase 2.6 v2.2): a cheap, bounded signal that a
// careers-page redirect landed on a dead end rather than a real careers
// destination — used only to REFINE the "unresolved" classification
// (stale_or_inactive_company), never to change what counts as resolved.
// Deliberately conservative: only fires when the landing page is BOTH (a)
// off the company's own domain and (b) shaped like a stub/homepage rather
// than a specific destination — a tiny body (a meta-refresh stub, like
// Drift's 334-byte redirect page) OR a bare root path with no query/hash
// (a plain homepage, like InVision's redirect to a competitor's root). A
// redirect to a specific sub-path (e.g. "/jobs", "/company/careers") is
// deliberately NOT flagged — that's still a plausible real careers
// destination (e.g. an acquirer's careers hub), just not one we can
// validate a supported ATS on.
const STALE_LANDING_MAX_BODY_BYTES = 3000;

function looksLikeDeadEndLanding(finalUrl: string, originalDomain: string | null, bodyLength: number): boolean {
  let landedHost: string;
  let landedPath: string;
  try {
    const u = new URL(finalUrl);
    landedHost = u.hostname.toLowerCase().replace(/^www\./, "");
    landedPath = u.pathname;
  } catch {
    return false;
  }
  const origin = (originalDomain ?? "").toLowerCase().replace(/^www\./, "");
  const sameDomain = origin && (landedHost === origin || landedHost.endsWith(`.${origin}`) || origin.endsWith(`.${landedHost}`));
  if (sameDomain) return false; // still on the company's own domain — not a dead end by this heuristic

  const isRootPath = landedPath === "" || landedPath === "/";
  const isTinyStub = bodyLength > 0 && bodyLength < STALE_LANDING_MAX_BODY_BYTES;
  return isRootPath || isTinyStub;
}

// ---- Stage 3 helper: a small, bounded set of common-pattern guesses from
// the company's name/domain/careers-page hostname/AI slug hint. NEVER
// treated as valid on their own — every one of these still has to pass
// validateAtsEndpoint() like any other candidate. Cross-checks every slug
// variant against all 4 supported providers rather than brute-forcing
// arbitrary permutations of the slug itself.
function slugify(input: string): string {
  return input.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "").slice(0, 60);
}

// Phase 2.6 v2.2 — a hyphen-preserving variant: many real ATS tenant slugs
// use hyphens between words (e.g. "acme-robotics") rather than the
// compacted "acmerobotics" slugify() produces. Both are tried; this is an
// ADDITIONAL candidate source, not a replacement.
function slugifyHyphenated(input: string): string {
  return input
    .toLowerCase()
    .replace(/&/g, "and")
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// Lighter sanitizer for an AI-supplied slug hint: real ATS slugs commonly
// contain hyphens (e.g. "my-company") — stripping them like slugify() does
// for a company NAME would silently turn a possibly-correct hint into a
// guaranteed-wrong candidate while still consuming shared attempt budget.
function sanitizeSlugHint(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60);
}

function domainToken(domain: string | null): string | null {
  if (!domain) return null;
  const base = domain.split(".")[0];
  return base ? base.toLowerCase().replace(/[^a-z0-9]/g, "") : null;
}

function hostnameOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

// Builds the Tier 3 + Tier 4 deterministic candidate queue: deduplicated by
// slug string (when two sources produce the identical slug, the STRONGER
// tier wins rather than keeping whichever happened to be inserted first),
// cross-multiplied against all 4 supported providers, and pre-sorted so the
// caller can consume strictly strongest-evidence-first.
//   Tier 3 (structural): domain stem, careers-page hostname stem, and
//     (v2.2) the redirect-target hostname stem when the careers page bounced
//     somewhere else that wasn't itself ATS-shaped — companies commonly
//     reuse their (real) domain as their ATS tenant slug, so this is
//     treated as stronger deterministic evidence than a name-derived guess.
//   Tier 4 (broader): the literal company name, the normalized (suffix-
//     stripped) company name, (v2.2) a hyphen-preserving name variant, and
//     the AI's slug hint cross-checked against EVERY provider (not trusting
//     the AI's claimed provider — that specific pairing was already tried,
//     at higher priority, in the AI-hint stage).
//
// Phase 2.6 v2.2 — evidence-ranked ordering: when a structured-JSON provider
// hint was found on the careers page (extractProviderHint), candidates for
// THAT provider are moved ahead of candidates for the other 3 within their
// tier (a stable secondary sort) — still bounded, still deduplicated, still
// validated like everything else; the hint only affects ORDER, never
// whether validation is required.
function buildKnownUrlPatternCandidates(
  companyName: string,
  domain: string | null,
  careersUrl: string | null,
  aiSlugHint: string | null | undefined,
  redirectTargetHost: string | null,
  providerHint: SupportedAts | null
): AtsCandidateEndpoint[] {
  const slugTiers = new Map<string, AtsEvidenceTier>();
  const consider = (slug: string | null, tier: AtsEvidenceTier) => {
    if (!slug) return;
    const existing = slugTiers.get(slug);
    if (existing === undefined || tier < existing) slugTiers.set(slug, tier);
  };

  consider(domainToken(domain), 3);
  consider(domainToken(hostnameOf(careersUrl)), 3);
  consider(domainToken(redirectTargetHost), 3);

  consider(slugify(companyName), 4);
  consider(slugify(normalizeCompanyName(companyName) ?? ""), 4);
  consider(slugifyHyphenated(companyName), 4);
  consider(aiSlugHint ? sanitizeSlugHint(aiSlugHint) : null, 4);

  const out: AtsCandidateEndpoint[] = [];
  for (const [slug, tier] of slugTiers) {
    for (const provider of SUPPORTED_ATS) {
      out.push({ provider, url: urlForPattern(provider, slug), slug, source: "known_url_pattern", priority: tier });
    }
  }
  return out.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (providerHint) {
      const aHinted = a.provider === providerHint ? 0 : 1;
      const bHinted = b.provider === providerHint ? 0 : 1;
      if (aHinted !== bHinted) return aHinted - bHinted;
    }
    return 0;
  });
}

function zeroAttemptsTally(): AtsAttemptsBySource {
  return { canonical_link: 0, career_page_link: 0, career_page_redirect: 0, known_url_pattern: 0, ai_hint_validated: 0 };
}

const AI_CONFIDENCE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

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
  let careerPageChecked = false;
  let pageFetchSucceeded = false;
  let detectedUnsupportedProvider: RejectedAts | null = null;
  let sawAnyAtsEvidence = false;
  let careersPageOffDomainRedirect = false;
  let providerHint: SupportedAts | null = null;
  let redirectTargetHost: string | null = null;
  let aiCandidatesGenerated = 0;
  let aiCandidatesValidated = 0;
  let aiCandidatesSuccessful = 0;

  function attemptsBySource(): AtsAttemptsBySource {
    const tally = zeroAttemptsTally();
    for (const e of validationEvidence) tally[e.source as keyof AtsAttemptsBySource]++;
    return tally;
  }
  function successfulAttemptsBySource(): AtsAttemptsBySource {
    const tally = zeroAttemptsTally();
    for (const e of validationEvidence) if (e.outcome === "valid") tally[e.source as keyof AtsAttemptsBySource]++;
    return tally;
  }
  function failedAttemptsBySource(): AtsAttemptsBySource {
    const tally = zeroAttemptsTally();
    for (const e of validationEvidence) if (e.outcome !== "valid") tally[e.source as keyof AtsAttemptsBySource]++;
    return tally;
  }

  function classifyUnresolvedStatus(): AtsResolutionStatus {
    if (detectedUnsupportedProvider) return "unsupported_provider";
    if (careersPageOffDomainRedirect) return "stale_or_inactive_company";
    if (careerPageChecked && pageFetchSucceeded && !sawAnyAtsEvidence) return "no_supported_ats_evidence";
    return "unresolved";
  }

  function unresolved(): AtsResolutionResult {
    return {
      resolved: false,
      resolutionStatus: classifyUnresolvedStatus(),
      provider: null,
      careersUrl: null,
      slug: null,
      confidence: "low",
      resolutionMethod: "unresolved",
      validationEvidence,
      attemptCount: attempts,
      careerPageChecked,
      detectedUnsupportedProvider,
      validatedJobCount: null,
      attemptsBySource: attemptsBySource(),
      attemptBudgetMax: MAX_CANDIDATE_ENDPOINTS,
      attemptBudgetUsed: attempts,
      attemptBudgetRemaining: MAX_CANDIDATE_ENDPOINTS - attempts,
      successfulAttemptsBySource: successfulAttemptsBySource(),
      failedAttemptsBySource: failedAttemptsBySource(),
      aiCandidatesGenerated,
      aiCandidatesValidated,
      aiCandidatesSuccessful,
      detectedProviderHint: providerHint,
    };
  }

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
          outcome: "valid", detail: `${jobs.length} job(s) returned`, jobCount: jobs.length,
        });
        const confidence: AtsResolutionConfidence =
          candidate.source === "canonical_link" || candidate.source === "career_page_link" || candidate.source === "career_page_redirect" ? "high"
          : candidate.source === "known_url_pattern" ? "medium"
          : "low"; // ai_hint_validated
        return {
          resolved: true,
          resolutionStatus: "resolved",
          provider: candidate.provider,
          careersUrl: candidate.url,
          slug: candidate.slug,
          confidence,
          resolutionMethod: candidate.source,
          validationEvidence,
          attemptCount: attempts,
          careerPageChecked,
          detectedUnsupportedProvider,
          validatedJobCount: jobs.length,
          attemptsBySource: attemptsBySource(),
          attemptBudgetMax: MAX_CANDIDATE_ENDPOINTS,
          attemptBudgetUsed: attempts,
          attemptBudgetRemaining: MAX_CANDIDATE_ENDPOINTS - attempts,
          successfulAttemptsBySource: successfulAttemptsBySource(),
          failedAttemptsBySource: failedAttemptsBySource(),
          aiCandidatesGenerated,
          aiCandidatesValidated,
          aiCandidatesSuccessful,
          detectedProviderHint: providerHint,
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

  // ---- Stage 1 (Tier 1 — direct evidence): detectAts() on the supplied URL
  // (unmodified). The resulting URL is always normalized to the canonical
  // board root — even when the caller-supplied URL pointed at an individual
  // job posting. --------------------------------------------------------
  if (input.careersUrl) {
    const det = detectAts(input.careersUrl);
    if (det.supported && det.slug && isSupportedAts(det.platform)) {
      sawAnyAtsEvidence = true;
      const canonical = urlForPattern(det.platform, det.slug);
      const result = await tryValidate({ provider: det.platform, url: canonical, slug: det.slug, source: "canonical_link", priority: 1 });
      if (result) return result;
      // URL LOOKED like a supported ATS board but failed live validation
      // (e.g. renamed/removed slug) — fall through to later stages instead
      // of trusting the URL shape alone.
    } else if (!det.supported && det.platform !== "Unknown") {
      // The supplied URL is itself a recognized-but-rejected ATS
      // (e.g. Workday) — preserve that intelligence immediately.
      sawAnyAtsEvidence = true;
      detectedUnsupportedProvider = det.platform as RejectedAts;
    }
  }

  // ---- Stage 2 (Tier 1 — direct evidence): fetch the actual careers page
  // (bounded timeout/redirects/size, no credentials) and inspect it several
  // ways:
  //   (a) did the fetch itself land on a supported ATS URL after following
  //       redirects — HTTP 3xx OR meta-refresh alike ("career_page_redirect")?
  //   (b) did it land somewhere off the company's own domain that looks
  //       like a dead end (v2.2 stale/inactive signal), or somewhere else
  //       structurally useful (v2.2 redirect-target hostname evidence)?
  //   (c) does the page's HTML contain a link/script/iframe/form/JSON
  //       reference to a supported ATS ("career_page_link" if it's already
  //       a board root, "canonical_link" if it's a job-specific URL that
  //       needs normalizing down to the board)?
  //   (d) (v2.2) does the page embed a conservative structured-JSON
  //       provider hint (e.g. "source":"ashby") — never trusted alone, only
  //       reprioritizes Stage 3.
  // Single page fetch only — no recursive crawling of extracted links (they
  // are validated via the ATS API, never re-fetched as HTML). -------------
  if (input.careersUrl && attempts < MAX_CANDIDATE_ENDPOINTS) {
    careerPageChecked = true;
    const page = await deps.fetchPage(input.careersUrl);
    if (page && page.status >= 200 && page.status < 300) {
      pageFetchSucceeded = true;
      // (a)/(b) redirect-landing check — only meaningful if we actually
      // landed somewhere different from the URL we requested.
      if (page.finalUrl && page.finalUrl !== input.careersUrl) {
        const landedDet = detectAts(page.finalUrl);
        if (landedDet.supported && landedDet.slug && isSupportedAts(landedDet.platform)) {
          sawAnyAtsEvidence = true;
          const canonical = urlForPattern(landedDet.platform, landedDet.slug);
          const result = await tryValidate({
            provider: landedDet.platform, url: canonical, slug: landedDet.slug, source: "career_page_redirect", priority: 1,
          });
          if (result) return result;
        } else if (!landedDet.supported && landedDet.platform !== "Unknown") {
          sawAnyAtsEvidence = true;
          if (!detectedUnsupportedProvider) detectedUnsupportedProvider = landedDet.platform as RejectedAts;
        } else {
          // Landed somewhere that isn't itself ATS-shaped. Two possibilities,
          // checked in order: a genuine dead end (stale/inactive signal), or
          // a structurally useful alternate recruiting domain worth trying
          // as a Tier 3 slug source.
          if (looksLikeDeadEndLanding(page.finalUrl, input.domain, page.body?.length ?? 0)) {
            careersPageOffDomainRedirect = true;
          } else {
            redirectTargetHost = hostnameOf(page.finalUrl);
          }
        }
      }

      // (c) inspect the page body for ATS links/script/iframe/form refs.
      if (page.body) {
        const links = extractAtsLinksFromHtml(page.body);
        for (const link of links) {
          if (attempts >= MAX_CANDIDATE_ENDPOINTS) break;
          const det = detectAts(link);
          if (det.supported && det.slug && isSupportedAts(det.platform)) {
            sawAnyAtsEvidence = true;
            const exact = isExactBoardRoot(det.platform, link);
            const canonical = urlForPattern(det.platform, det.slug);
            const result = await tryValidate({
              provider: det.platform,
              url: canonical,
              slug: det.slug,
              source: exact ? "career_page_link" : "canonical_link",
              priority: 1,
            });
            if (result) return result;
          } else if (!det.supported && det.platform !== "Unknown") {
            sawAnyAtsEvidence = true;
            if (!detectedUnsupportedProvider) detectedUnsupportedProvider = det.platform as RejectedAts;
          }
        }

        // (d) structured-JSON provider hint — a much weaker signal than an
        // actual URL match above, so it never short-circuits resolution; it
        // only informs Stage 3's ordering below.
        const hint = extractProviderHint(page.body);
        if (hint) {
          sawAnyAtsEvidence = true;
          providerHint = hint;
        }
      }
    }
  }

  // ---- Stage AI-hint reuse (Tier 1 + Tier 2): reuse the free hint already
  // produced by candidate generation (company-discovery-ai.ts's ats_*_guess
  // fields), if any — zero extra OpenAI cost. Runs BEFORE the broad
  // deterministic pattern search (below) so it can never be starved by it —
  // this is the direct fix for the v2 "Monday.com reaches the attempt cap
  // with ai_hint_resolution_count=0" budget-starvation issue. Still fully
  // unvalidated until tryValidate() — nothing here is ever trusted as fact.
  //   Tier 1: the AI's URL is ALREADY structurally ATS-shaped — concrete
  //     "direct evidence", just AI-sourced rather than page/input-sourced.
  //     Trusts what the URL actually parses as (via detectAts), not the AI's
  //     separate provider claim, in case the two disagree.
  //   Tier 2: the AI's explicit (provider, slug) pairing — a specific,
  //     narrower bet than Tier 3/4's broadened cross-provider search below.
  if (attempts < MAX_CANDIDATE_ENDPOINTS && input.aiGuess?.ats_provider_guess && isSupportedAts(input.aiGuess.ats_provider_guess)) {
    const provider = input.aiGuess.ats_provider_guess;
    let slug = input.aiGuess.ats_slug_guess || null;
    const guessedUrl = input.aiGuess.ats_url_guess || null;

    if (guessedUrl) {
      const det = detectAts(guessedUrl);
      if (det.supported && det.slug && isSupportedAts(det.platform)) {
        const canonical = urlForPattern(det.platform, det.slug);
        const result = await tryValidate({ provider: det.platform, url: canonical, slug: det.slug, source: "ai_hint_validated", priority: 1 });
        if (result) return result;
      }
      if (!slug && det.supported && det.slug) slug = det.slug;
    }

    if (slug && attempts < MAX_CANDIDATE_ENDPOINTS) {
      const result = await tryValidate({ provider, url: urlForPattern(provider, slug), slug, source: "ai_hint_validated", priority: 2 });
      if (result) return result;
    }
  }

  // ---- Stage 3 (Tier 3 + Tier 4 — deterministic pattern guessing): a
  // deduplicated, pre-sorted queue of bounded common-pattern guesses from
  // name/normalized name/hyphenated name/domain/careers-page hostname/
  // redirect-target hostname/AI slug hint — strongest (structural) evidence
  // first, provider-hint-matching candidates first within a tier, never a
  // brute-force permutation of the slug itself. NEVER treated as valid on
  // their own — every candidate still has to pass tryValidate() like
  // everything else.
  //
  // Budget reservation (Phase 2.6 v2.1): self-limits to leave
  // AI_FRESH_CALL_RESERVE attempts unspent whenever Stage 4b's fresh AI call
  // is actually configured, so broad pattern guessing can never fully
  // exhaust the budget before that later-but-still-valuable evidence gets a
  // turn. No reservation (full remaining budget available) when AI
  // assistance isn't configured at all — nothing to hold room for.
  {
    const reserveForFreshAiCall = deps.generateAiAtsGuess ? AI_FRESH_CALL_RESERVE : 0;
    // Never below `attempts` (can't reserve into a negative remaining
    // budget) and never above the global cap.
    const patternStageBudget = Math.min(
      MAX_CANDIDATE_ENDPOINTS,
      Math.max(attempts, MAX_CANDIDATE_ENDPOINTS - reserveForFreshAiCall)
    );
    const patternCandidates = buildKnownUrlPatternCandidates(
      input.companyName,
      input.domain,
      input.careersUrl,
      input.aiGuess?.ats_slug_guess,
      redirectTargetHost,
      providerHint
    );
    for (const candidate of patternCandidates) {
      if (attempts >= patternStageBudget) break;
      const result = await tryValidate(candidate);
      if (result) return result;
    }
  }

  // ---- Stage 4b: fresh AI call, only if everything deterministic (and the
  // free AI hint) failed, and only if the caller opted in by providing
  // generateAiAtsGuess. Phase 2.6 v2.2: the AI now returns a RANKED LIST of
  // at most AI_RANKED_CANDIDATE_MAX candidates (see generateAtsGuessAI's
  // prompt in company-discovery-ai.ts) instead of a single guess — consumed
  // strongest-confidence-first, each independently run through the same
  // tryValidate() as every other candidate (deduplicated against anything
  // already attempted) before ever being accepted. The AI may PROPOSE,
  // never approve — its knowledge may be stale; live validation is the only
  // source of truth. Thanks to Stage 3's reservation above, this is
  // guaranteed a real shot at the budget (barring Tier 1/2 evidence alone
  // already exhausting it, which only happens when there's a lot of genuine
  // direct evidence to sift through — never because of speculative pattern
  // guessing). -------------------------------------------------------------
  if (attempts < MAX_CANDIDATE_ENDPOINTS && deps.generateAiAtsGuess) {
    try {
      const rawGuesses = await deps.generateAiAtsGuess({
        companyName: input.companyName, domain: input.domain, careersUrl: input.careersUrl,
      });
      const guesses = Array.isArray(rawGuesses) ? rawGuesses : [];
      aiCandidatesGenerated = guesses.length;

      const ranked = guesses
        .filter((g) => g && isSupportedAts(g.provider))
        .sort((a, b) => (AI_CONFIDENCE_RANK[b.confidence] ?? 0) - (AI_CONFIDENCE_RANK[a.confidence] ?? 0))
        .slice(0, AI_RANKED_CANDIDATE_MAX);

      for (const guess of ranked) {
        if (attempts >= MAX_CANDIDATE_ENDPOINTS) break;
        const provider = guess.provider;
        let slug = guess.slug || null;

        // Tier 1: this candidate's URL is itself already ATS-shaped.
        if (guess.ats_url) {
          const det = detectAts(guess.ats_url);
          if (det.supported && det.slug && isSupportedAts(det.platform)) {
            aiCandidatesValidated++;
            const canonical = urlForPattern(det.platform, det.slug);
            const result = await tryValidate({ provider: det.platform, url: canonical, slug: det.slug, source: "ai_hint_validated", priority: 1 });
            if (result) { aiCandidatesSuccessful++; return { ...result, aiCandidatesGenerated, aiCandidatesValidated, aiCandidatesSuccessful }; }
          }
          if (!slug && det.supported && det.slug) slug = det.slug;
        }

        // Tier 2: this candidate's explicit (provider, slug) pairing.
        if (slug && attempts < MAX_CANDIDATE_ENDPOINTS) {
          aiCandidatesValidated++;
          const result = await tryValidate({
            provider, url: urlForPattern(provider, slug), slug, source: "ai_hint_validated", priority: 2,
          });
          if (result) { aiCandidatesSuccessful++; return { ...result, aiCandidatesGenerated, aiCandidatesValidated, aiCandidatesSuccessful }; }
        }
      }
    } catch {
      // AI Stage 4b is best-effort — a failure here must resolve exactly
      // like "AI found nothing", never differently or fatally.
    }
  }

  return unresolved();
}

// ----------------------------------------------------------------------------
// Production dependency wiring. Kept separate from resolveCompanyAts() itself
// so the resolution algorithm never directly imports fetch/Supabase/OpenAI —
// only this factory does, and only to build the deps object a caller injects.
// ----------------------------------------------------------------------------

// Real production careers-page fetch: GET only, no credentials sent (plain
// fetch() with no cookie jar / auth header), bounded timeout, bounded
// manually-followed redirect count, bounded response size. Reports the final
// landed URL so the resolver can detect a careers page that redirects
// straight to a supported ATS board. Phase 2.6 v2.2: also follows a
// meta-refresh redirect (bounded by the same hop budget as HTTP redirects) —
// a real gap found live (a careers URL that's purely a meta-refresh stub).
export async function defaultFetchPage(url: string): Promise<{ status: number; body: string; finalUrl: string } | null> {
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
      return { status: res.status, body: "", finalUrl: currentUrl };
    }
    const contentLength = res.headers.get("content-length");
    if (contentLength && Number(contentLength) > PAGE_MAX_BYTES) {
      return { status: res.status, body: "", finalUrl: currentUrl }; // too large — no usable body
    }
    let text: string;
    try {
      text = await res.text();
    } catch {
      return null;
    }
    if (text.length > PAGE_MAX_BYTES) text = text.slice(0, PAGE_MAX_BYTES);

    const metaRefreshTarget = extractMetaRefreshTarget(text, currentUrl);
    if (metaRefreshTarget && metaRefreshTarget !== currentUrl && hop < PAGE_MAX_REDIRECTS) {
      currentUrl = metaRefreshTarget;
      continue; // consume one of the bounded redirect hops, same as an HTTP 3xx
    }

    return { status: res.status, body: text, finalUrl: currentUrl };
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
