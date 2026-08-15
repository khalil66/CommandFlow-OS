// ============================================================================
// ATS Resolver (Phase 2.6 addendum) unit tests.
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
  MAX_CANDIDATE_ENDPOINTS,
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

describe("resolveCompanyAts — Stage 1 (direct detectAts)", () => {
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
    expect(result.provider).toBe("Greenhouse");
    expect(result.slug).toBe("acme");
    expect(result.resolutionMethod).toBe("direct");
    expect(result.confidence).toBe("high");
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
    expect(result.resolutionMethod).toBe("direct");
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
    expect(result.resolutionMethod).toBe("direct");
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
    expect(result.resolutionMethod).toBe("direct");
  });
});

describe("resolveCompanyAts — Stage 2 (career page link inspection)", () => {
  it("5. finds a Greenhouse link inside a generic careers page", async () => {
    const deps = fakeDeps({
      fetchPage: vi.fn(async () => ({
        status: 200,
        body: `<html><body><a href="https://boards.greenhouse.io/zapier">Apply</a></body></html>`,
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
    expect(result.careersUrl).toBe("https://boards.greenhouse.io/zapier");
    expect(result.resolutionMethod).toBe("career_page_link");
    expect(result.confidence).toBe("high");
  });

  it("6. finds a Lever link inside a generic careers page", async () => {
    const deps = fakeDeps({
      fetchPage: vi.fn(async () => ({
        status: 200,
        body: `<div>Careers <a href="https://jobs.lever.co/asana">here</a></div>`,
      })),
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

  it("7. finds an Ashby link inside a generic careers page", async () => {
    const deps = fakeDeps({
      fetchPage: vi.fn(async () => ({
        status: 200,
        body: `<a href="https://jobs.ashbyhq.com/monday">Open roles</a>`,
      })),
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

  it("8. finds a Breezy link inside a generic careers page", async () => {
    const deps = fakeDeps({
      fetchPage: vi.fn(async () => ({
        status: 200,
        body: `<a href="https://toggl.breezy.hr">See openings</a>`,
      })),
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
});

describe("resolveCompanyAts — failure and edge-case handling", () => {
  it("9. a URL that LOOKS like a supported ATS but 404s/invalidates is rejected, not trusted on shape alone", async () => {
    const deps = fakeDeps(); // validateAtsEndpoint always null — nothing ever validates
    const result = await resolveCompanyAts(
      { companyName: "Dead Co", domain: null, careersUrl: "https://boards.greenhouse.io/deadco" },
      deps
    );
    expect(result.resolved).toBe(false);
    expect(result.resolutionMethod).toBe("unresolved");
    const directAttempt = result.validationEvidence.find((v) => v.source === "direct");
    expect(directAttempt).toBeDefined();
    expect(directAttempt!.outcome).toBe("not_found");
  });

  it("10. multiple ATS links on one page — skips the invalid one and resolves the valid one", async () => {
    const deps = fakeDeps({
      fetchPage: vi.fn(async () => ({
        status: 200,
        body: `
          <a href="https://jobs.lever.co/fakeslug">broken link</a>
          <a href="https://boards.greenhouse.io/realslug">real link</a>
        `,
      })),
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

  it("11. an AI-proposed endpoint that fails validation is rejected — AI output alone never resolves anything", async () => {
    const generateAiAtsGuess = vi.fn(async () => ({
      provider: "Greenhouse", url: "https://boards.greenhouse.io/fakeslug", slug: "fakeslug",
    }));
    const deps = fakeDeps({ generateAiAtsGuess }); // validateAtsEndpoint always null
    const result = await resolveCompanyAts(
      { companyName: "AI Guess Co", domain: null, careersUrl: "https://aiguessco.com/careers" },
      deps
    );
    expect(result.resolved).toBe(false);
    expect(result.resolutionMethod).toBe("unresolved");
    expect(generateAiAtsGuess).toHaveBeenCalledTimes(1);
    // The AI's suggestion must have been run through the SAME validation
    // function as every other candidate before being rejected.
    expect(deps.validateAtsEndpoint).toHaveBeenCalledWith("Greenhouse", "fakeslug");
  });

  it("12. a company with no resolvable ATS anywhere is rejected cleanly, even with AI assistance unavailable", async () => {
    const deps = fakeDeps(); // no generateAiAtsGuess key at all — must be handled gracefully
    const result = await resolveCompanyAts(
      { companyName: "Totally Unresolvable LLC", domain: null, careersUrl: null },
      deps
    );
    expect(result.resolved).toBe(false);
    expect(result.provider).toBeNull();
    expect(result.careersUrl).toBeNull();
    expect(result.slug).toBeNull();
    expect(result.resolutionMethod).toBe("unresolved");
  });

  it("13. never exceeds the candidate-attempt cap, even when far more candidates are available", async () => {
    const manyLinks = Array.from({ length: 12 }, (_, i) => `<a href="https://boards.greenhouse.io/company${i}">apply</a>`).join("\n");
    const validateAtsEndpoint = vi.fn(async () => null); // nothing ever validates
    const deps = fakeDeps({
      fetchPage: vi.fn(async () => ({ status: 200, body: manyLinks })),
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
  });
});

describe("resolveCompanyAts — architectural guarantees", () => {
  it("14. resolveCompanyAts has no database handle at all and never references Supabase / DB writes", () => {
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

  it("15. existing detectAts() regression — unmodified by this file's addition", () => {
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
