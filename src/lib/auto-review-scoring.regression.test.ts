// ============================================================================
// Phase 2 non-regression test — Company Discovery / Company Scout must NEVER
// change job-level Auto Apply thresholds or decision behavior. This test
// pins AUTO_THRESHOLDS to the exact documented snapshot from the Phase 2
// authorization and will fail loudly if anything (including a future
// Company Scout change) ever touches auto-review-scoring.ts's thresholds.
//
// This file intentionally does not import anything from company-discovery*
// — it only proves the pre-existing, untouched file still matches the
// approved snapshot.
// ============================================================================

import { describe, it, expect } from "vitest";
import { AUTO_THRESHOLDS } from "./auto-review-scoring";

describe("AUTO_THRESHOLDS non-regression (Phase 2 must not modify this)", () => {
  it("exactly matches the documented, approved snapshot", () => {
    expect(AUTO_THRESHOLDS).toEqual({
      trust: 95,
      interview: 92,
      quality: 92,
      resume_match: 88,
      portfolio: 80,
      role_fit: 85,
      salary_min: 55000,
      fresh_days: 14,
      daily_pass_rate_cap: 0.15,
    });
  });
});
