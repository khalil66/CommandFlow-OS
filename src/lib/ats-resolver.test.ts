// ============================================================================
// ATS Resolver (Phase 2.6 addendum, v2) unit tests.
//
// Deliberately uses ZERO Vitest module mocking (no vi.mock/vi.doMock). Every
// external effect resolveCompanyAts() needs (fetching a careers page,
// validating a candidate ATS endpoint, asking AI for a guess) is passed in
// explicitly via the `deps` parameter, so tests just construct plain fake
// functions — the "prefer dependency injection over fragile Vitest module
// mocking" architecture constraint from the Phase 2.6 authorization.
//
// Run with: bun run test  (vitest)
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  resolveCompanyAts,
  extractMetaRefreshTarget,
  MAX_CANDIDATE_ENDPOINTS,
  AI_FRESH_CALL_RESERVE,
  type AtsResolverDeps,
  type ResolveCompanyAtsInput,
} from "./ats-resolver";
import { detectAts } from "./ats-detect";
import type { NormJob } from "./ingest.functions";

function fakeJob(overrides: Partial<NormJob> = {}): NormJob {
  return {
    external_id: "job-1",
    title: "Operations Coordinator",
    location: "Remote - US",
    description_html: "<p>Remote - US</p>",
    description_text: "Remote - US",
    url: "https://example.com/jobs/1",
    posted_at: new Date().toISOString(),
    salary_min: 90000,
    salary_max: 110000,
    salary_estimated: false,
    ...overrides,
  };
}

// A deps object where every capability is a no-op/failure by default —
// individual tests override only what they need, so unrelated stages never
// accidentally "succeed" and mask what's actually being tested.
function fakeDeps(overrides: Partial<AtsResolverDeps> = {}): AtsResolverDeps {
  return {
    fetchPage: vi.fn(async () => null),
    validateAtsEndpoint: vi.fn(async () => null),
    ...overrides,
  };
}

// fetchPage's real contract also reports `finalUrl` (the URL landed on
// after following redirects) — this helper builds a page result for tests
// that don't care about redirect-landing detection specifically.
function page(body: string, finalUrl = "https://example.com/careers"): { status: number; body: string; finalUrl: string } {
  return { status: 200, body, finalUrl };
}

describe("resolveCompanyAts — Stage 1 (direct detectAts, method: canonical_link)", () => {
  it("1. resolves a direct Greenhouse URL without needing the page fetch or AI", async () => {
    const deps = fakeDeps({
      validateAtsEndpoint: vi.fn(async (provider, slug) =>
        provider === "Greenhouse" && slug === "acme" ? [fakeJob()] : null
      ),
    });
    const result = await resolveCompanyAts(
      { companyName: "Acme Inc", domain: "acme.com", careersUrl: "https://boards.greenhouse.io/acme" },
      deps
    );
    expect(result.resolved).toBe(true);
    expect(result.resolutionStatus).toBe("resolved");
    expect(result.provider).toBe("Greenhouse");
    expect(result.slug).toBe("acme");
    expect(result.resolutionMethod).toBe("canonical_link");
    expect(result.confidence).toBe("high");
    expect(result.validatedJobCount).toBe(1);
    expect(deps.fetchPage).not.toHaveBeenCalled();
  });

  it("2. resolves a direct Lever URL", async () => {
    const deps = fakeDeps({
      validateAtsEndpoint: vi.fn(async (provider, slug) =>
        provider === "Lever" && slug === "acme" ? [fakeJob()] : null
      ),
    });
    const result = await resolveCompanyAts(
      { companyName: "Acme Inc", domain: "acme.com", careersUrl: "https://jobs.lever.co/acme" },
      deps
    );
    expect(result.resolved).toBe(true);
    expect(result.provider).toBe("Lever");
    expect(result.slug).toBe("acme");
    expect(result.resolutionMethod).toBe("canonical_link");
  });

  it("3. resolves a direct Ashby URL", async () => {
    const deps = fakeDeps({
      validateAtsEndpoint: vi.fn(async (provider, slug) =>
        provider === "Ashby" && slug === "acme" ? [fakeJob()] : null
      ),
    });
    const result = await resolveCompanyAts(
      { companyName: "Acme Inc", domain: "acme.com", careersUrl: "https://jobs.ashbyhq.com/acme" },
      deps
    );
    expect(result.resolved).toBe(true);
    expect(result.provider).toBe("Ashby");
    expect(result.slug).toBe("acme");
    expect(result.resolutionMethod).toBe("canonical_link");
  });

  it("4. resolves a direct Breezy URL", async () => {
    const deps = fakeDeps({
      validateAtsEndpoint: vi.fn(async (provider, slug) =>
        provider === "Breezy" && slug === "acme" ? [fakeJob()] : null
      ),
    });
    const result = await resolveCompanyAts(
      { companyName: "Acme Inc", domain: "acme.com", careersUrl: "https://acme.breezy.hr" },
      deps
    );
    expect(result.resolved).toBe(true);
    expect(result.provider).toBe("Breezy");
    expect(result.slug).toBe("acme");
    expect(result.resolutionMethod).toBe("canonical_link");
  });

  it("4b. normalizes a direct INDIVIDUAL JOB URL down to the canonical company board", async () => {
    const deps = fakeDeps({
      validateAtsEndpoint: vi.fn(async (provider, slug) =>
        provider === "Greenhouse" && slug === "acme" ? [fakeJob()] : null
      ),
    });
    const result = await resolveCompanyAts(
      { companyName: "Acme Inc", domain: "acme.com", careersUrl: "https://boards.greenhouse.io/acme/jobs/998877" },
      deps
    );
    expect(result.resolved).toBe(true);
    expect(result.provider).toBe("Greenhouse");
    expect(result.slug).toBe("acme");
    expect(result.careersUrl).toBe("https://boards.greenhouse.io/acme"); // normalized, not the raw job URL
    expect(result.resolutionMethod).toBe("canonical_link");
  });
});

describe("resolveCompanyAts — Stage 2a (careers page redirects straight to an ATS board)", () => {
  it("5. a careers page that 30x-redirects directly to a Greenhouse board resolves as career_page_redirect", async () => {
    const deps = fakeDeps({
      fetchPage: vi.fn(async () => ({
        status: 200,
        body: "<html><body>ignored</body></html>",
        finalUrl: "https://boards.greenhouse.io/zapier",
      })),
      validateAtsEndpoint: vi.fn(async (provider, slug) =>
        provider === "Greenhouse" && slug === "zapier" ? [fakeJob()] : null
      ),
    });
    const result = await resolveCompanyAts(
      { companyName: "Zapier", domain: "zapier.com", careersUrl: "https://zapier.com/jobs" },
      deps
    );
    expect(result.resolved).toBe(true);
    expect(result.provider).toBe("Greenhouse");
    expect(result.slug).toBe("zapier");
    expect(result.resolutionMethod).toBe("career_page_redirect");
    expect(result.confidence).toBe("high");
  });

  it("6. no redirect-landing candidate is tried when the fetch lands back on the same URL requested", async () => {
    const fetchPage = vi.fn(async (url: string) => page("<html></html>", url));
    const validateAtsEndpoint = vi.fn(async () => null);
    const deps = fakeDeps({ fetchPage, validateAtsEndpoint });
    const result = await resolveCompanyAts(
      { companyName: "NoRedirect Co", domain: "noredirect.com", careersUrl: "https://noredirect.com/careers" },
      deps
    );
    expect(result.resolved).toBe(false);
    // finalUrl === requested URL (no redirect occurred) and the body has no
    // links, so nothing should ever have been validated with source
    // "career_page_redirect" or "career_page_link" — only Stage 3's
    // deterministic pattern guesses may have run.
    expect(result.validationEvidence.some((v) => v.source === "career_page_redirect")).toBe(false);
    expect(result.validationEvidence.some((v) => v.source === "career_page_link")).toBe(false);
  });
});

describe("resolveCompanyAts — Stage 2b (career page link inspection: career_page_link vs canonical_link)", () => {
  it("7. finds a Greenhouse board-root link inside a generic careers page (career_page_link)", async () => {
    const deps = fakeDeps({
      fetchPage: vi.fn(async () => page(
        `<html><body><a href="https://boards.greenhouse.io/zapier">Apply</a></body></html>`
      )),
      validateAtsEndpoint: vi.fn(async (provider, slug) =>
        provider === "Greenhouse" && slug === "zapier" ? [fakeJob()] : null
      ),
    });
    const result = await resolveCompanyAts(
      { companyName: "Zapier", domain: "zapier.com", careersUrl: "https://zapier.com/jobs" },
      deps
    );
    expect(result.resolved).toBe(true);
    expect(result.provider).toBe("Greenhouse");
    expect(result.slug).toBe("zapier");
    expect(result.careersUrl).toBe("https://boards.greenhouse.io/zapier");
    expect(result.resolutionMethod).toBe("career_page_link");
    expect(result.confidence).toBe("high");
  });

  it("8. finds a Lever board-root link inside a generic careers page (career_page_link)", async () => {
    const deps = fakeDeps({
      fetchPage: vi.fn(async () => page(
        `<div>Careers <a href="https://jobs.lever.co/asana">here</a></div>`
      )),
      validateAtsEndpoint: vi.fn(async (provider, slug) =>
        provider === "Lever" && slug === "asana" ? [fakeJob()] : null
      ),
    });
    const result = await resolveCompanyAts(
      { companyName: "Asana", domain: "asana.com", careersUrl: "https://asana.com/jobs" },
      deps
    );
    expect(result.resolved).toBe(true);
    expect(result.provider).toBe("Lever");
    expect(result.resolutionMethod).toBe("career_page_link");
  });

  it("9. finds an Ashby board-root link inside a generic careers page (career_page_link)", async () => {
    const deps = fakeDeps({
      fetchPage: vi.fn(async () => page(
        `<a href="https://jobs.ashbyhq.com/monday">Open roles</a>`
      )),
      validateAtsEndpoint: vi.fn(async (provider, slug) =>
        provider === "Ashby" && slug === "monday" ? [fakeJob()] : null
      ),
    });
    const result = await resolveCompanyAts(
      { companyName: "Monday.com", domain: "monday.com", careersUrl: "https://monday.com/careers" },
      deps
    );
    expect(result.resolved).toBe(true);
    expect(result.provider).toBe("Ashby");
    expect(result.resolutionMethod).toBe("career_page_link");
  });

  it("10. finds a Breezy board-root link inside a generic careers page (career_page_link)", async () => {
    const deps = fakeDeps({
      fetchPage: vi.fn(async () => page(
        `<a href="https://toggl.breezy.hr">See openings</a>`
      )),
      validateAtsEndpoint: vi.fn(async (provider, slug) =>
        provider === "Breezy" && slug === "toggl" ? [fakeJob()] : null
      ),
    });
    const result = await resolveCompanyAts(
      { companyName: "Toggl", domain: "toggl.com", careersUrl: "https://toggl.com/jobs/" },
      deps
    );
    expect(result.resolved).toBe(true);
    expect(result.provider).toBe("Breezy");
    expect(result.resolutionMethod).toBe("career_page_link");
  });

  it("11. normalizes an INDIVIDUAL JOB URL found on the careers page down to the company board (canonical_link)", async () => {
    const deps = fakeDeps({
      fetchPage: vi.fn(async () => page(
        `<a href="https://boards.greenhouse.io/acme/jobs/4471002">Senior Analyst</a>`
      )),
      validateAtsEndpoint: vi.fn(async (provider, slug) =>
        provider === "Greenhouse" && slug === "acme" ? [fakeJob()] : null
      ),
    });
    const result = await resolveCompanyAts(
      { companyName: "Acme", domain: "acme.com", careersUrl: "https://acme.com/careers" },
      deps
    );
    expect(result.resolved).toBe(true);
    expect(result.provider).toBe("Greenhouse");
    expect(result.slug).toBe("acme");
    // Normalized to the board root, not the raw per-posting URL.
    expect(result.careersUrl).toBe("https://boards.greenhouse.io/acme");
    expect(result.resolutionMethod).toBe("canonical_link");
  });
});

describe("resolveCompanyAts — unsupported-provider detection", () => {
  it("12. a careers page that links to Workday is detected as an unsupported provider, not silently unresolved", async () => {
    const validateAtsEndpoint = vi.fn(async () => null);
    const deps = fakeDeps({
      fetchPage: vi.fn(async () => page(
        `<a href="https://acmeco.myworkdayjobs.com/careers">Apply on Workday</a>`
      )),
      validateAtsEndpoint,
    });
    const result = await resolveCompanyAts(
      { companyName: "Acme Co", domain: "acmeco.com", careersUrl: "https://acmeco.com/careers" },
      deps
    );
    expect(result.resolved).toBe(false);
    expect(result.resolutionStatus).toBe("unsupported_provider");
    expect(result.detectedUnsupportedProvider).toBe("Workday");
    expect(result.resolutionMethod).toBe("unresolved");
    // Detecting the Workday link itself is a free detectAts() check — it
    // must never be validated as an endpoint (it isn't a SupportedAts, so
    // it structurally cannot appear in validationEvidence). Stage 3's
    // deterministic pattern guesses still legitimately run afterward.
    expect(result.validationEvidence.some((v) => (v.provider as string) === "Workday")).toBe(false);
  });

  it("13. a supplied careers URL that IS itself Workday is detected as unsupported immediately", async () => {
    const deps = fakeDeps();
    const result = await resolveCompanyAts(
      { companyName: "Acme Co", domain: null, careersUrl: "https://acmeco.myworkdayjobs.com/careers" },
      deps
    );
    expect(result.resolved).toBe(false);
    expect(result.resolutionStatus).toBe("unsupported_provider");
    expect(result.detectedUnsupportedProvider).toBe("Workday");
  });

  it("14. an unsupported-provider detection does NOT block a genuinely supported ATS from resolving afterward", async () => {
    const deps = fakeDeps({
      fetchPage: vi.fn(async () => page(
        `<a href="https://acmeco.myworkdayjobs.com/careers">Legacy careers (Workday)</a>
         <a href="https://boards.greenhouse.io/acmeco">New careers (Greenhouse)</a>`
      )),
      validateAtsEndpoint: vi.fn(async (provider, slug) =>
        provider === "Greenhouse" && slug === "acmeco" ? [fakeJob()] : null
      ),
    });
    const result = await resolveCompanyAts(
      { companyName: "Acme Co", domain: "acmeco.com", careersUrl: "https://acmeco.com/careers" },
      deps
    );
    // The company is still genuinely resolvable — the unsupported-provider
    // link elsewhere on the page must not prevent that.
    expect(result.resolved).toBe(true);
    expect(result.resolutionStatus).toBe("resolved");
    expect(result.provider).toBe("Greenhouse");
  });
});

describe("resolveCompanyAts — Stage 3 (bounded common-pattern guesses)", () => {
  it("15. resolves via the domain-derived slug pattern", async () => {
    const deps = fakeDeps({
      validateAtsEndpoint: vi.fn(async (provider, slug) =>
        provider === "Greenhouse" && slug === "gitlab" ? [fakeJob()] : null
      ),
    });
    const result = await resolveCompanyAts(
      { companyName: "GitLab Inc.", domain: "gitlab.com", careersUrl: "https://about.gitlab.com/jobs/" },
      deps
    );
    expect(result.resolved).toBe(true);
    expect(result.resolutionMethod).toBe("known_url_pattern");
    expect(result.confidence).toBe("medium");
  });

  it("16. resolves via the careers-page HOSTNAME slug when it differs from the primary domain", async () => {
    const deps = fakeDeps({
      // domain is "acme.com" (slug "acme") but the careers page actually
      // lives on a distinct "acmehq" host — only the hostname-derived slug
      // should validate.
      validateAtsEndpoint: vi.fn(async (provider, slug) =>
        provider === "Lever" && slug === "acmehq" ? [fakeJob()] : null
      ),
    });
    const result = await resolveCompanyAts(
      { companyName: "Acme", domain: "acme.com", careersUrl: "https://acmehq.co/careers" },
      deps
    );
    expect(result.resolved).toBe(true);
    expect(result.provider).toBe("Lever");
    expect(result.slug).toBe("acmehq");
    expect(result.resolutionMethod).toBe("known_url_pattern");
  });

  it("17. resolves via the AI slug hint cross-checked against a DIFFERENT provider than the AI guessed", async () => {
    // The AI's provider guess ("Ashby") is wrong, but its SLUG guess is
    // reused as a candidate string tried against every supported provider —
    // deterministically, not trusting the AI's provider claim.
    const deps = fakeDeps({
      validateAtsEndpoint: vi.fn(async (provider, slug) =>
        provider === "Greenhouse" && slug === "acmeworks" ? [fakeJob()] : null
      ),
    });
    const result = await resolveCompanyAts(
      {
        companyName: "Acme Works",
        domain: "unrelated-domain.io",
        careersUrl: null,
        aiGuess: { ats_provider_guess: "Ashby", ats_url_guess: null, ats_slug_guess: "acmeworks" },
      },
      deps
    );
    expect(result.resolved).toBe(true);
    expect(result.provider).toBe("Greenhouse");
    expect(result.slug).toBe("acmeworks");
    // Resolved deterministically via the slug-pattern stage, not by trusting
    // the AI's (wrong) provider claim as an ai_hint_validated match.
    expect(result.resolutionMethod).toBe("known_url_pattern");
  });

  it("18. deduplicates identical slug candidates rather than re-testing them", async () => {
    // "Acme Inc" name-slug and "acme.com" domain-slug both produce "acme" —
    // must be tested once per provider, not twice.
    const validateAtsEndpoint = vi.fn<(provider: string, slug: string) => Promise<NormJob[] | null>>(async () => null);
    const deps = fakeDeps({ validateAtsEndpoint });
    await resolveCompanyAts(
      { companyName: "Acme Inc", domain: "acme.com", careersUrl: null },
      deps
    );
    const acmeGreenhouseCalls = validateAtsEndpoint.mock.calls.filter(
      (c) => c[0] === "Greenhouse" && c[1] === "acme"
    );
    expect(acmeGreenhouseCalls.length).toBe(1);
  });
});

describe("resolveCompanyAts — Stage 4 (AI hint, method: ai_hint_validated)", () => {
  it("19. AI claims Greenhouse, but the careers page ACTUALLY links to a valid Ashby board — the real ATS wins, not the AI's guess", async () => {
    const generateAiAtsGuess = vi.fn(async () => [
      { provider: "Greenhouse" as const, ats_url: "https://boards.greenhouse.io/realco", slug: "realco", confidence: "high" as const, reasoning: "", evidence_type: "known_board" as const },
    ]);
    const deps = fakeDeps({
      fetchPage: vi.fn(async () => page(
        `<a href="https://jobs.ashbyhq.com/realco">Careers</a>`
      )),
      validateAtsEndpoint: vi.fn(async (provider, slug) => {
        // Greenhouse/realco (the AI's claim) is NOT real; Ashby/realco IS.
        if (provider === "Ashby" && slug === "realco") return [fakeJob()];
        return null;
      }),
      generateAiAtsGuess,
    });
    const result = await resolveCompanyAts(
      {
        companyName: "RealCo",
        domain: "realco.com",
        careersUrl: "https://realco.com/careers",
        aiGuess: { ats_provider_guess: "Greenhouse", ats_url_guess: "https://boards.greenhouse.io/realco", ats_slug_guess: "realco" },
      },
      deps
    );
    expect(result.resolved).toBe(true);
    expect(result.provider).toBe("Ashby");
    expect(result.resolutionMethod).toBe("career_page_link");
    // The deterministic career-page-link stage runs BEFORE the AI-hint
    // stage, so the (wrong) AI hint is never even reached.
    expect(deps.validateAtsEndpoint).not.toHaveBeenCalledWith("Greenhouse", "realco");
    expect(generateAiAtsGuess).not.toHaveBeenCalled();
  });

  it("20. an AI-proposed endpoint that fails validation is rejected — AI output alone never resolves anything", async () => {
    const generateAiAtsGuess = vi.fn(async () => [
      { provider: "Greenhouse" as const, ats_url: "https://boards.greenhouse.io/fakeslug", slug: "fakeslug", confidence: "high" as const, reasoning: "", evidence_type: "known_board" as const },
    ]);
    const deps = fakeDeps({ generateAiAtsGuess }); // validateAtsEndpoint always null
    // Stage 3's reservation (AI_FRESH_CALL_RESERVE) guarantees Stage 4b still
    // gets a turn even though Stage 3 has multiple slug variants to try here
    // ("aiguess" from domain/name, "ai-guess" from the hyphen-preserving
    // variant) — proving AI is genuinely reachable as a last resort.
    const result = await resolveCompanyAts(
      { companyName: "AI Guess", domain: null, careersUrl: "https://aiguess.com/careers" },
      deps
    );
    expect(result.resolved).toBe(false);
    expect(result.resolutionMethod).toBe("unresolved");
    expect(generateAiAtsGuess).toHaveBeenCalledTimes(1);
    // The AI's suggestion must have been run through the SAME validation
    // function as every other candidate before being rejected.
    expect(deps.validateAtsEndpoint).toHaveBeenCalledWith("Greenhouse", "fakeslug");
  });

  it("21. reuses the free candidate-generation AI hint (Stage 4a) via ai_hint_validated when everything deterministic fails", async () => {
    const deps = fakeDeps({
      validateAtsEndpoint: vi.fn(async (provider, slug) =>
        provider === "Ashby" && slug === "hintco-exact" ? [fakeJob()] : null
      ),
    });
    // "Hint" (rather than "Hint Co") keeps Stage 3's name/domain-derived
    // guesses down to a single slug variant. Crucially, the AI hint here
    // supplies only a URL (no ats_slug_guess) — Stage 3's deterministic
    // candidate list only reads ats_slug_guess directly, so it cannot
    // derive this slug itself; only Stage 4a (which parses the URL via
    // detectAts()) can reach it, proving ai_hint_validated is genuinely
    // exercised and not just shadowed by Stage 3.
    const result = await resolveCompanyAts(
      {
        companyName: "Hint",
        domain: null,
        careersUrl: null,
        aiGuess: { ats_provider_guess: "Ashby", ats_url_guess: "https://jobs.ashbyhq.com/hintco-exact", ats_slug_guess: null },
      },
      deps
    );
    expect(result.resolved).toBe(true);
    expect(result.provider).toBe("Ashby");
    expect(result.resolutionMethod).toBe("ai_hint_validated");
    expect(result.confidence).toBe("low");
  });
});

describe("resolveCompanyAts — failure and edge-case handling", () => {
  it("22. a URL that LOOKS like a supported ATS but 404s/invalidates is rejected, not trusted on shape alone", async () => {
    const deps = fakeDeps(); // validateAtsEndpoint always null — nothing ever validates
    const result = await resolveCompanyAts(
      { companyName: "Dead Co", domain: null, careersUrl: "https://boards.greenhouse.io/deadco" },
      deps
    );
    expect(result.resolved).toBe(false);
    expect(result.resolutionMethod).toBe("unresolved");
    const directAttempt = result.validationEvidence.find((v) => v.source === "canonical_link");
    expect(directAttempt).toBeDefined();
    expect(directAttempt!.outcome).toBe("not_found");
  });

  it("23. multiple ATS links on one page — skips the invalid one and resolves the valid one", async () => {
    const deps = fakeDeps({
      fetchPage: vi.fn(async () => page(`
          <a href="https://jobs.lever.co/fakeslug">broken link</a>
          <a href="https://boards.greenhouse.io/realslug">real link</a>
        `)),
      // Only the Greenhouse/realslug pair is genuinely valid.
      validateAtsEndpoint: vi.fn(async (provider, slug) =>
        provider === "Greenhouse" && slug === "realslug" ? [fakeJob()] : null
      ),
    });
    const result = await resolveCompanyAts(
      { companyName: "Multi Co", domain: "multico.com", careersUrl: "https://multico.com/careers" },
      deps
    );
    expect(result.resolved).toBe(true);
    expect(result.provider).toBe("Greenhouse");
    expect(result.slug).toBe("realslug");
    // Proves the Lever candidate really was tried and rejected, not skipped.
    expect(deps.validateAtsEndpoint).toHaveBeenCalledWith("Lever", "fakeslug");
  });

  it("24. a company with no resolvable ATS anywhere is rejected cleanly, even with AI assistance unavailable", async () => {
    const deps = fakeDeps(); // no generateAiAtsGuess key at all — must be handled gracefully
    const result = await resolveCompanyAts(
      { companyName: "Totally Unresolvable LLC", domain: null, careersUrl: null },
      deps
    );
    expect(result.resolved).toBe(false);
    expect(result.resolutionStatus).toBe("unresolved");
    expect(result.provider).toBeNull();
    expect(result.careersUrl).toBeNull();
    expect(result.slug).toBeNull();
    expect(result.resolutionMethod).toBe("unresolved");
    expect(result.detectedUnsupportedProvider).toBeNull();
  });

  it("25. never exceeds the candidate-attempt cap, even when far more candidates are available", async () => {
    const manyLinks = Array.from({ length: 12 }, (_, i) => `<a href="https://boards.greenhouse.io/company${i}">apply</a>`).join("\n");
    const validateAtsEndpoint = vi.fn(async () => null); // nothing ever validates
    const deps = fakeDeps({
      fetchPage: vi.fn(async () => page(manyLinks)),
      validateAtsEndpoint,
    });
    const result = await resolveCompanyAts(
      { companyName: "Cap Test Co", domain: null, careersUrl: "https://captest.com/careers" },
      deps
    );
    expect(result.resolved).toBe(false);
    expect(result.resolutionMethod).toBe("unresolved");
    expect(validateAtsEndpoint.mock.calls.length).toBeLessThanOrEqual(MAX_CANDIDATE_ENDPOINTS);
    expect(validateAtsEndpoint).toHaveBeenCalledTimes(MAX_CANDIDATE_ENDPOINTS);
    expect(result.validationEvidence.length).toBeLessThanOrEqual(MAX_CANDIDATE_ENDPOINTS);
    expect(result.attemptCount).toBe(MAX_CANDIDATE_ENDPOINTS);
  });

  it("26. dry-run-safe: resolution never mutates anything and telemetry fields are always present, resolved or not", async () => {
    const deps = fakeDeps({
      fetchPage: vi.fn(async () => page("<html></html>")),
    });
    const result = await resolveCompanyAts(
      { companyName: "Telemetry Co", domain: "telemetryco.com", careersUrl: "https://telemetryco.com/careers" },
      deps
    );
    expect(result.careerPageChecked).toBe(true);
    expect(typeof result.attemptCount).toBe("number");
    expect(result.validatedJobCount).toBeNull();
  });
});

describe("resolveCompanyAts — architectural guarantees", () => {
  it("27. resolveCompanyAts has no database handle at all and never references Supabase / DB writes", () => {
    const src = readFileSync(new URL("./ats-resolver.ts", import.meta.url), "utf8");
    const start = src.indexOf("export async function resolveCompanyAts");
    const end = src.indexOf("export async function defaultFetchPage");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    // The resolution algorithm itself (as opposed to buildDefaultAtsResolverDeps,
    // which legitimately forwards a supabase handle through to AI-usage
    // logging) must never reference Supabase or issue a DB write. Checks for
    // actual usage (a real property/call), not just the word "Supabase" —
    // this file's own prose comments mention it (explaining why) without
    // that being a violation.
    const resolveCompanyAtsSource = src.slice(start, end);
    expect(resolveCompanyAtsSource).not.toMatch(/\bsupabase\s*[.[]/i);
    expect(resolveCompanyAtsSource).not.toMatch(/\.insert\(|\.update\(|\.from\(/);
  });

  it("28. existing detectAts() regression — unmodified by this file's addition (backward compatibility)", () => {
    expect(detectAts("https://boards.greenhouse.io/acme")).toEqual({
      supported: true, platform: "Greenhouse", slug: "acme", reason: undefined,
    });
    expect(detectAts("https://jobs.lever.co/acme")).toEqual({
      supported: true, platform: "Lever", slug: "acme", reason: undefined,
    });
    expect(detectAts("https://jobs.ashbyhq.com/acme")).toEqual({
      supported: true, platform: "Ashby", slug: "acme", reason: undefined,
    });
    expect(detectAts("https://acme.breezy.hr")).toEqual({
      supported: true, platform: "Breezy", slug: "acme", reason: undefined,
    });
    expect(detectAts("https://acme.myworkdayjobs.com/careers")).toEqual({
      supported: false, platform: "Workday", slug: null, reason: "Workday requires login / MFA / captcha",
    });
    expect(detectAts("https://acme.com/careers").platform).toBe("Unknown");
    expect(detectAts("").platform).toBe("Unknown");
  });
});

// A minimal type-shape smoke check that ResolveCompanyAtsInput/AtsResolverDeps
// are actually exported and usable the way the rest of the codebase (and
// these tests) expect — a compile-time guard as much as a runtime one.
describe("resolveCompanyAts — input/deps shape", () => {
  it("accepts an aiGuess hint (from company-discovery-ai.ts) alongside the core fields", async () => {
    const input: ResolveCompanyAtsInput = {
      companyName: "Hint Co",
      domain: null,
      careersUrl: "https://hintco.com/careers",
      aiGuess: { ats_provider_guess: "Greenhouse", ats_url_guess: "https://boards.greenhouse.io/hintco", ats_slug_guess: "hintco" },
    };
    const deps = fakeDeps({
      validateAtsEndpoint: vi.fn(async (provider, slug) =>
        provider === "Greenhouse" && slug === "hintco" ? [fakeJob()] : null
      ),
    });
    const result = await resolveCompanyAts(input, deps);
    expect(result.resolved).toBe(true);
    expect(result.provider).toBe("Greenhouse");
    expect(result.slug).toBe("hintco");
    expect(result.careersUrl).toBe("https://boards.greenhouse.io/hintco");
  });
});

// ============================================================================
// Phase 2.6 v2.1 — smart validation-budget allocation.
//
// V2's Stage 3 (deterministic name/domain/hostname pattern guessing) ran
// BEFORE the free AI-hint reuse and could, on its own, generate enough
// slug x provider combinations to exhaust the entire shared
// MAX_CANDIDATE_ENDPOINTS budget before any AI-sourced evidence ever got a
// turn — observed live as a company reaching attemptCount=8, still
// unresolved, with zero AI-hint attempts anywhere in the run. These tests
// cover the fix: evidence-tiered ordering (direct evidence and AI hints
// before broad pattern guessing) plus an explicit reserve so broad pattern
// guessing can never fully starve a configured fresh AI call.
// ============================================================================
describe("resolveCompanyAts — Phase 2.6 v2.1 budget reservation", () => {
  // A company deliberately engineered to produce 4 DISTINCT deterministic
  // slug variants (domain stem, careers-page hostname stem, raw company
  // name, normalized company name) — Tier 3 alone already has 8 candidates
  // (2 slugs x 4 providers), enough to exhaust the entire shared budget on
  // its own if nothing reserved room for the fresh AI call.
  const engineeredInput: ResolveCompanyAtsInput = {
    companyName: "Zzyzx Corp",
    domain: "zzyzx-domain.io",
    careersUrl: "https://careers.zzyzx-portal.com/jobs",
  };

  it("A. known-pattern guesses cannot consume the full budget before a configured fresh AI call is tested", async () => {
    const generateAiAtsGuess = vi.fn(async () => [
      { provider: "Ashby" as const, ats_url: null, slug: "realslug", confidence: "high" as const, reasoning: "", evidence_type: "slug_inference" as const },
    ]);
    const deps = fakeDeps({
      validateAtsEndpoint: vi.fn(async (provider, slug) =>
        provider === "Ashby" && slug === "realslug" ? [fakeJob()] : null
      ),
      generateAiAtsGuess,
    });
    const result = await resolveCompanyAts(engineeredInput, deps);

    expect(generateAiAtsGuess).toHaveBeenCalledTimes(1); // the core "not starved" guarantee
    expect(result.resolved).toBe(true);
    expect(result.provider).toBe("Ashby");
    expect(result.resolutionMethod).toBe("ai_hint_validated");
    // Stage 3 self-limited to exactly (MAX - AI_FRESH_CALL_RESERVE) attempts
    // before the fresh AI call's candidate got its turn.
    expect(result.attemptsBySource.known_url_pattern).toBe(MAX_CANDIDATE_ENDPOINTS - AI_FRESH_CALL_RESERVE);
    expect(result.attemptsBySource.ai_hint_validated).toBe(1);
    expect(result.attemptCount).toBeLessThanOrEqual(MAX_CANDIDATE_ENDPOINTS);
  });

  it("A (companion). the reserve is only held back when a fresh AI call is actually configured — unused reserve flows to pattern guessing otherwise", async () => {
    const deps = fakeDeps({ validateAtsEndpoint: vi.fn(async () => null) }); // no generateAiAtsGuess at all
    const result = await resolveCompanyAts(engineeredInput, deps);

    expect(result.resolved).toBe(false);
    // With nothing to reserve room for, Stage 3 gets the FULL shared budget.
    expect(result.attemptsBySource.known_url_pattern).toBe(MAX_CANDIDATE_ENDPOINTS);
    expect(result.attemptCount).toBe(MAX_CANDIDATE_ENDPOINTS);
  });

  it("D. career-page evidence outranks speculative name/domain patterns — Stage 3 never even runs once Stage 2 resolves", async () => {
    const deps = fakeDeps({
      fetchPage: vi.fn(async () => page(
        `<a href="https://boards.greenhouse.io/realboard">Careers</a>`
      )),
      // Deliberately also make the domain-derived PATTERN guess resolvable,
      // to a DIFFERENT company board, so a false pass (Stage 3 winning by
      // accident) would be caught by the provider/slug assertions below.
      validateAtsEndpoint: vi.fn(async (provider, slug) => {
        if (provider === "Greenhouse" && slug === "realboard") return [fakeJob()];
        if (provider === "Greenhouse" && slug === "patternco") return [fakeJob()];
        return null;
      }),
    });
    const result = await resolveCompanyAts(
      { companyName: "Pattern Co", domain: "patternco.com", careersUrl: "https://patternco.com/careers" },
      deps
    );

    expect(result.resolved).toBe(true);
    expect(result.resolutionMethod).toBe("career_page_link");
    expect(result.slug).toBe("realboard");
    // Stage 3 (known_url_pattern) never ran at all — Stage 2 already
    // returned before reaching it, even though a pattern guess would ALSO
    // have resolved (just to the wrong, weaker-evidence board).
    expect(result.attemptsBySource.known_url_pattern).toBe(0);
    expect(result.validationEvidence.every((v) => v.source !== "known_url_pattern")).toBe(true);
  });

  it("E. the same (provider, slug) reached via both the AI-hint stage and the pattern-guess stage consumes only one attempt", async () => {
    const deps = fakeDeps({
      validateAtsEndpoint: vi.fn(async (provider, slug) =>
        provider === "Greenhouse" && slug === "acme" ? [fakeJob()] : null
      ),
    });
    const result = await resolveCompanyAts(
      {
        companyName: "Acme",
        domain: "acme.com",
        careersUrl: null,
        // The AI hint's slug happens to coincide with the domain-derived
        // Stage 3 slug — both stages would independently propose
        // (Greenhouse, "acme").
        aiGuess: { ats_provider_guess: "Greenhouse", ats_url_guess: null, ats_slug_guess: "acme" },
      },
      deps
    );

    expect(result.resolved).toBe(true);
    // Resolved by the AI-hint stage (it runs first) — Stage 3 must never
    // have gotten a chance to re-attempt the identical pair.
    expect(result.resolutionMethod).toBe("ai_hint_validated");
    const greenhouseAcmeAttempts = result.validationEvidence.filter(
      (v) => v.provider === "Greenhouse" && v.slug === "acme"
    );
    expect(greenhouseAcmeAttempts).toHaveLength(1);
  });

  it("F. an unresolved candidate that reaches the cap reports attemptBudgetUsed === attemptBudgetMax and zero remaining", async () => {
    const manyLinks = Array.from({ length: 12 }, (_, i) => `<a href="https://boards.greenhouse.io/company${i}">apply</a>`).join("\n");
    const deps = fakeDeps({
      fetchPage: vi.fn(async () => page(manyLinks)),
      validateAtsEndpoint: vi.fn(async () => null),
    });
    const result = await resolveCompanyAts(
      { companyName: "Cap Telemetry Co", domain: null, careersUrl: "https://captelemetry.com/careers" },
      deps
    );

    expect(result.resolved).toBe(false);
    expect(result.attemptBudgetMax).toBe(MAX_CANDIDATE_ENDPOINTS);
    expect(result.attemptBudgetUsed).toBe(MAX_CANDIDATE_ENDPOINTS);
    expect(result.attemptBudgetUsed).toBe(result.attemptBudgetMax);
    expect(result.attemptBudgetRemaining).toBe(0);
  });
});

// ============================================================================
// Phase 2.6 v2.2 — broader evidence extraction, evidence-ranked slug
// candidates, AI ranked-candidate contract, and honest unresolved
// classification.
//
// Root-cause context: a live Dry Run C (45% resolution) plus direct,
// controlled HTTP inspection of all 11 unresolved companies showed none of
// them would flip to resolved purely from better HTML-evidence extraction —
// the gaps were genuinely JS-rendered pages, acquired/dead companies,
// self-hosted non-ATS tools, or (Monday.com) a real ATS with no publicly
// reachable board slug. These tests therefore validate the new GENERAL
// capabilities on realistic synthetic fixtures, not on the specific
// companies from that run — no company-specific special-casing.
// ============================================================================
describe("resolveCompanyAts — Phase 2.6 v2.2 broader evidence extraction", () => {
  it("1. a supported ATS URL referenced via <script src> is discovered", async () => {
    const deps = fakeDeps({
      fetchPage: vi.fn(async () => page(
        `<html><head><script src="https://boards.greenhouse.io/acme"></script></head><body></body></html>`
      )),
      validateAtsEndpoint: vi.fn(async (provider, slug) =>
        provider === "Greenhouse" && slug === "acme" ? [fakeJob()] : null
      ),
    });
    const result = await resolveCompanyAts(
      { companyName: "Acme", domain: "acme.com", careersUrl: "https://acme.com/careers" },
      deps
    );
    expect(result.resolved).toBe(true);
    expect(result.provider).toBe("Greenhouse");
    expect(result.resolutionMethod).toBe("career_page_link");
  });

  it("2. a supported ATS URL referenced via <iframe src> is discovered", async () => {
    const deps = fakeDeps({
      fetchPage: vi.fn(async () => page(
        `<div class="careers-embed"><iframe src="https://jobs.lever.co/acme" width="100%"></iframe></div>`
      )),
      validateAtsEndpoint: vi.fn(async (provider, slug) =>
        provider === "Lever" && slug === "acme" ? [fakeJob()] : null
      ),
    });
    const result = await resolveCompanyAts(
      { companyName: "Acme", domain: "acme.com", careersUrl: "https://acme.com/careers" },
      deps
    );
    expect(result.resolved).toBe(true);
    expect(result.provider).toBe("Lever");
    expect(result.resolutionMethod).toBe("career_page_link");
  });

  describe("3. meta-refresh ATS redirect discovered", () => {
    it("3a. extractMetaRefreshTarget() parses a meta-refresh redirect target", () => {
      const html = `<html><head><meta http-equiv="refresh" content="0; url=https://boards.greenhouse.io/acme"></head></html>`;
      expect(extractMetaRefreshTarget(html, "https://acme.com/careers")).toBe("https://boards.greenhouse.io/acme");
    });

    it("3b. extractMetaRefreshTarget() resolves a relative meta-refresh target against the base URL", () => {
      const html = `<meta http-equiv="refresh" content="2;url=/new-careers">`;
      expect(extractMetaRefreshTarget(html, "https://acme.com/careers")).toBe("https://acme.com/new-careers");
    });

    it("3c. returns null when there is no meta-refresh tag", () => {
      expect(extractMetaRefreshTarget("<html><body>nothing here</body></html>", "https://acme.com")).toBeNull();
    });

    it("3d. the resolver treats a meta-refresh-landed ATS URL exactly like an HTTP-redirect landing (career_page_redirect)", async () => {
      const deps = fakeDeps({
        // Simulates defaultFetchPage having already chased the meta-refresh —
        // the resolver only ever sees the final landed URL, whichever kind
        // of redirect produced it.
        fetchPage: vi.fn(async () => page("<html></html>", "https://boards.greenhouse.io/acme")),
        validateAtsEndpoint: vi.fn(async (provider, slug) =>
          provider === "Greenhouse" && slug === "acme" ? [fakeJob()] : null
        ),
      });
      const result = await resolveCompanyAts(
        { companyName: "Acme", domain: "acme.com", careersUrl: "https://acme.com/careers" },
        deps
      );
      expect(result.resolved).toBe(true);
      expect(result.resolutionMethod).toBe("career_page_redirect");
    });
  });
});

describe("resolveCompanyAts — Phase 2.6 v2.2 AI ranked-candidate contract", () => {
  it("4. AI returns multiple ranked candidates and the second (lower-confidence) candidate wins after the first fails validation", async () => {
    const generateAiAtsGuess = vi.fn(async () => [
      { provider: "Greenhouse" as const, slug: "wrongslug", ats_url: null, confidence: "high" as const, reasoning: "recalled from memory", evidence_type: "company_history" as const },
      { provider: "Ashby" as const, slug: "rightslug", ats_url: null, confidence: "medium" as const, reasoning: "slug pattern guess", evidence_type: "slug_inference" as const },
    ]);
    const deps = fakeDeps({
      validateAtsEndpoint: vi.fn(async (provider, slug) =>
        provider === "Ashby" && slug === "rightslug" ? [fakeJob()] : null
      ),
      generateAiAtsGuess,
    });
    const result = await resolveCompanyAts(
      { companyName: "Multi Rank Co", domain: null, careersUrl: null },
      deps
    );
    expect(result.resolved).toBe(true);
    expect(result.provider).toBe("Ashby");
    expect(result.slug).toBe("rightslug");
    expect(result.resolutionMethod).toBe("ai_hint_validated");
    // Proves the first (higher-confidence, wrong) candidate really was tried
    // and rejected, not skipped.
    expect(deps.validateAtsEndpoint).toHaveBeenCalledWith("Greenhouse", "wrongslug");
    expect(result.aiCandidatesGenerated).toBe(2);
    expect(result.aiCandidatesSuccessful).toBe(1);
  });

  it("5. a duplicate AI candidate (same provider+slug as another candidate) does not consume a second validation attempt", async () => {
    const generateAiAtsGuess = vi.fn(async () => [
      { provider: "Ashby" as const, slug: "acme", ats_url: null, confidence: "high" as const, reasoning: "", evidence_type: "known_board" as const },
      { provider: "Ashby" as const, slug: "acme", ats_url: null, confidence: "medium" as const, reasoning: "", evidence_type: "slug_inference" as const },
    ]);
    const validateAtsEndpoint = vi.fn<(provider: string, slug: string) => Promise<NormJob[] | null>>(async () => null); // nothing validates — isolates the dedup behavior
    const deps = fakeDeps({ validateAtsEndpoint, generateAiAtsGuess });
    await resolveCompanyAts(
      { companyName: "Zzq Dedupe Test", domain: null, careersUrl: null },
      deps
    );
    const ashbyAcmeCalls = validateAtsEndpoint.mock.calls.filter((c) => c[0] === "Ashby" && c[1] === "acme");
    expect(ashbyAcmeCalls.length).toBe(1);
  });

  it("6. AI ranked candidates cannot bypass endpoint validation, no matter how confident", async () => {
    const generateAiAtsGuess = vi.fn(async () => [
      { provider: "Greenhouse" as const, slug: "confident1", ats_url: null, confidence: "high" as const, reasoning: "", evidence_type: "known_board" as const },
      { provider: "Lever" as const, slug: "confident2", ats_url: null, confidence: "high" as const, reasoning: "", evidence_type: "known_board" as const },
      { provider: "Ashby" as const, slug: "confident3", ats_url: null, confidence: "high" as const, reasoning: "", evidence_type: "known_board" as const },
    ]);
    const deps = fakeDeps({ validateAtsEndpoint: vi.fn(async () => null), generateAiAtsGuess }); // nothing ever validates
    const result = await resolveCompanyAts(
      { companyName: "Zzq Unvalidatable Co", domain: null, careersUrl: null },
      deps
    );
    expect(result.resolved).toBe(false);
    expect(result.resolutionMethod).toBe("unresolved");
    expect(result.aiCandidatesGenerated).toBe(3);
    expect(result.aiCandidatesSuccessful).toBe(0);
  });
});

describe("resolveCompanyAts — Phase 2.6 v2.2 honest unresolved classification", () => {
  it("7. an unsupported provider discovered via the broadened <iframe src> scan still reports unsupported_provider, never validated", async () => {
    const validateAtsEndpoint = vi.fn(async () => null);
    const deps = fakeDeps({
      fetchPage: vi.fn(async () => page(
        `<iframe src="https://acme.myworkdayjobs.com/careers"></iframe>`
      )),
      validateAtsEndpoint,
    });
    const result = await resolveCompanyAts(
      { companyName: "Acme", domain: "acme.com", careersUrl: "https://acme.com/careers" },
      deps
    );
    expect(result.resolutionStatus).toBe("unsupported_provider");
    expect(result.detectedUnsupportedProvider).toBe("Workday");
    expect(result.validationEvidence.some((v) => (v.provider as string) === "Workday")).toBe(false);
  });

  it("8. absence of any supported ATS evidence is classified as no_supported_ats_evidence, NEVER unsupported_provider", async () => {
    const deps = fakeDeps({
      // A real, successfully-fetched page with genuinely nothing ATS-shaped
      // anywhere in it (no href/script/iframe/form/JSON hint of any kind).
      // finalUrl deliberately matches the requested URL (no redirect at all)
      // to isolate this test from the separate stale/off-domain-redirect
      // classification path (see test 8b below).
      fetchPage: vi.fn(async () => page(
        `<html><body><h1>Careers at Acme</h1><p>We're not currently hiring. Check back later!</p></body></html>`,
        "https://acme.com/careers"
      )),
      validateAtsEndpoint: vi.fn(async () => null),
    });
    const result = await resolveCompanyAts(
      { companyName: "Acme", domain: "acme.com", careersUrl: "https://acme.com/careers" },
      deps
    );
    expect(result.resolved).toBe(false);
    expect(result.resolutionStatus).toBe("no_supported_ats_evidence");
    expect(result.detectedUnsupportedProvider).toBeNull();
  });

  it("8b. a careers page that redirects off-domain to a tiny stub (e.g. a meta-refresh to a marketing page) is classified stale_or_inactive_company, not no_supported_ats_evidence", async () => {
    const deps = fakeDeps({
      fetchPage: vi.fn(async () => page(
        `<p>Redirecting...</p>`, // a tiny stub landing page, like a real meta-refresh target
        "https://unrelated-marketing-site.example/some-page"
      )),
      validateAtsEndpoint: vi.fn(async () => null),
    });
    const result = await resolveCompanyAts(
      { companyName: "Acme", domain: "acme.com", careersUrl: "https://acme.com/careers" },
      deps
    );
    expect(result.resolved).toBe(false);
    expect(result.resolutionStatus).toBe("stale_or_inactive_company");
  });

  it("8c. a structured provider hint with no extractable/validatable endpoint (Monday.com-style: embedded JSON says the ATS, but exposes no public board) stays unresolved — NEVER resolved, and NOT no_supported_ats_evidence (a hint IS evidence)", async () => {
    // Mirrors a real Dry Run C finding: a company's careers page embeds
    // server-rendered job data tagged `"source":"ashby"` on every posting,
    // but no jobs.ashbyhq.com URL/slug anywhere on the page — the company
    // has proxied the ATS through its own backend with no public board.
    const deps = fakeDeps({
      fetchPage: vi.fn(async () => page(
        `<script id="__NEXT_DATA__">{"props":{"jobs":[{"title":"Engineer","location":{"city":"NYC"},"source":"ashby"},{"title":"Designer","source":"ashby"}]}}</script>`,
        "https://acme.com/careers"
      )),
      validateAtsEndpoint: vi.fn(async () => null), // no guessable slug ever validates — matches the live finding
    });
    const result = await resolveCompanyAts(
      { companyName: "Acme", domain: "acme.com", careersUrl: "https://acme.com/careers" },
      deps
    );
    expect(result.resolved).toBe(false);
    expect(result.detectedProviderHint).toBe("Ashby");
    // A hint IS evidence — this must NOT be conflated with "we found
    // literally nothing", and it must never be trusted into "resolved"
    // without a validated endpoint.
    expect(result.resolutionStatus).toBe("unresolved");
    expect(result.resolutionStatus).not.toBe("no_supported_ats_evidence");
    expect(result.resolutionStatus).not.toBe("resolved" as any);
    // Telemetry internal consistency: nothing ever validated, so there must
    // be zero successful attempts recorded anywhere.
    const totalSuccessful = Object.values(result.successfulAttemptsBySource).reduce((a, b) => a + b, 0);
    expect(totalSuccessful).toBe(0);
  });

  it("9. the attempt budget never exceeds MAX_CANDIDATE_ENDPOINTS even with meta-refresh + broadened extraction combined", async () => {
    const manySrcs = Array.from({ length: 10 }, (_, i) => `<iframe src="https://jobs.ashbyhq.com/company${i}"></iframe>`).join("\n");
    const validateAtsEndpoint = vi.fn(async () => null);
    const deps = fakeDeps({
      fetchPage: vi.fn(async () => page(manySrcs, "https://redirected.example.com/careers")),
      validateAtsEndpoint,
      generateAiAtsGuess: vi.fn(async () => [
        { provider: "Greenhouse" as const, slug: "x", ats_url: null, confidence: "high" as const, reasoning: "", evidence_type: "other" as const },
      ]),
    });
    const result = await resolveCompanyAts(
      { companyName: "Budget Ceiling Co", domain: "budgetceiling.com", careersUrl: "https://budgetceiling.com/careers" },
      deps
    );
    expect(result.attemptCount).toBeLessThanOrEqual(MAX_CANDIDATE_ENDPOINTS);
    expect(validateAtsEndpoint.mock.calls.length).toBeLessThanOrEqual(MAX_CANDIDATE_ENDPOINTS);
    expect(result.attemptBudgetUsed).toBeLessThanOrEqual(result.attemptBudgetMax);
  });
});

describe("resolveCompanyAts — Phase 2.6 v2.2 regression fixtures", () => {
  it("10. GitLab-style known-pattern resolution still works (domain-derived slug, Greenhouse)", async () => {
    const deps = fakeDeps({
      validateAtsEndpoint: vi.fn(async (provider, slug) =>
        provider === "Greenhouse" && slug === "gitlab" ? [fakeJob()] : null
      ),
    });
    const result = await resolveCompanyAts(
      { companyName: "GitLab Inc.", domain: "gitlab.com", careersUrl: "https://about.gitlab.com/jobs/" },
      deps
    );
    expect(result.resolved).toBe(true);
    expect(result.provider).toBe("Greenhouse");
    expect(result.slug).toBe("gitlab");
    expect(result.resolutionMethod).toBe("known_url_pattern");
  });

  it("11. Airtable-style AI-hint resolution still works (free hint's direct URL validates on the first attempt)", async () => {
    const deps = fakeDeps({
      validateAtsEndpoint: vi.fn(async (provider, slug) =>
        provider === "Greenhouse" && slug === "airtable" ? [fakeJob()] : null
      ),
    });
    const result = await resolveCompanyAts(
      {
        companyName: "Airtable",
        domain: "airtable.com",
        careersUrl: "https://airtable.com/careers",
        aiGuess: { ats_provider_guess: "Greenhouse", ats_url_guess: "https://boards.greenhouse.io/airtable", ats_slug_guess: "airtable" },
      },
      deps
    );
    expect(result.resolved).toBe(true);
    expect(result.provider).toBe("Greenhouse");
    expect(result.resolutionMethod).toBe("ai_hint_validated");
    expect(result.attemptCount).toBe(1);
  });

  it("12. a direct canonical ATS URL still resolves with the highest confidence level", async () => {
    const deps = fakeDeps({
      validateAtsEndpoint: vi.fn(async (provider, slug) =>
        provider === "Greenhouse" && slug === "webflow" ? [fakeJob()] : null
      ),
    });
    const result = await resolveCompanyAts(
      { companyName: "Webflow", domain: "webflow.com", careersUrl: "https://boards.greenhouse.io/webflow" },
      deps
    );
    expect(result.resolved).toBe(true);
    expect(result.resolutionMethod).toBe("canonical_link");
    expect(result.confidence).toBe("high");
  });

  it("13. malformed/truncated HTML never crashes discovery", async () => {
    const malformed =
      `<html><body><script>{"source":"ashby, "unterminated: [1,2,3</script>` +
      `<a href="https://boards.greenhouse.io/  <meta http-equiv="refresh" content="abc; url=" <iframe src=` +
      "x".repeat(2000);
    const deps = fakeDeps({
      fetchPage: vi.fn(async () => page(malformed)),
      validateAtsEndpoint: vi.fn(async () => null),
    });
    await expect(
      resolveCompanyAts(
        { companyName: "Malformed Co", domain: "malformed.com", careersUrl: "https://malformed.com/careers" },
        deps
      )
    ).resolves.toMatchObject({ resolved: false });
  });
});
