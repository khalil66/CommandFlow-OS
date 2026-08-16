// ============================================================================
// Company Discovery Intelligence Layer — Phase 2.6 v2 regression tests for
// candidate-generation dedup (src/lib/company-discovery-ai.ts).
//
// generateCandidateCompanies()/generateSimilarCompanies() themselves call
// the real network (openai-fetch.ts) and aren't unit-tested here — per the
// same "prefer dependency-injectable/exported pure functions over fragile
// Vitest module mocking" approach used throughout Phase 2.6
// (see ats-resolver.test.ts), the deterministic dedup backstop is exported
// and tested directly instead.
//
// Run with: bun run test  (vitest)
// ============================================================================

import { describe, it, expect } from "vitest";
import { dedupeByNormalizedName, CANDIDATE_SYSTEM } from "./company-discovery-ai";

describe("dedupeByNormalizedName", () => {
  it("collapses exact duplicate company names, keeping the first occurrence", () => {
    const items = [
      { name: "Acme Inc", confidence: "high" },
      { name: "Acme Inc", confidence: "low" },
    ];
    const result = dedupeByNormalizedName(items);
    expect(result).toHaveLength(1);
    expect(result[0].confidence).toBe("high");
  });

  it("collapses duplicates that differ only by casing, punctuation, or legal suffix", () => {
    const items = [
      { name: "Acme Inc." },
      { name: "ACME, INC" },
      { name: "acme corp" },
      { name: "Acme" },
    ];
    const result = dedupeByNormalizedName(items);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Acme Inc.");
  });

  it("keeps genuinely distinct companies", () => {
    const items = [{ name: "Acme Inc" }, { name: "Widgets Co" }, { name: "Zapier" }];
    const result = dedupeByNormalizedName(items);
    expect(result).toHaveLength(3);
  });

  it("is a no-op on an already-unique list", () => {
    const items = [{ name: "Alpha" }, { name: "Beta" }, { name: "Gamma" }];
    expect(dedupeByNormalizedName(items)).toEqual(items);
  });

  it("handles an empty list", () => {
    expect(dedupeByNormalizedName([])).toEqual([]);
  });
});

describe("CANDIDATE_SYSTEM prompt — uniqueness instruction (Phase 2.6 v2)", () => {
  it("explicitly instructs the model never to repeat a company within one batch", () => {
    expect(CANDIDATE_SYSTEM).toMatch(/must be unique/i);
    expect(CANDIDATE_SYSTEM).toMatch(/never return the same company more than once/i);
  });
});
