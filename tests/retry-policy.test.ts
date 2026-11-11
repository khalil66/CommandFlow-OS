import { describe, expect, it } from "vitest";
import {
  DAILY_COVER_LIMIT,
  DAILY_RESUME_LIMIT,
  RETRY_BATCH_SIZE,
  RETRY_LEASE_SECONDS,
  retryDueAt,
  retryFailure,
} from "../src/lib/retry-policy";
import { prepOutputSchema } from "../src/lib/generation-contracts";

describe("retry rules", () => {
  it("preserves both daily limits at 25", () => {
    expect(DAILY_RESUME_LIMIT).toBe(25);
    expect(DAILY_COVER_LIMIT).toBe(25);
  });
  it("bounds processing and preserves a 15-minute lease", () => {
    expect(RETRY_BATCH_SIZE).toBe(3);
    expect(RETRY_LEASE_SECONDS).toBe(900);
    expect(retryDueAt(0, Date.UTC(2026, 10, 11))).toBe("2026-11-11T00:15:00.000Z");
  });
  it("pauses quota failures instead of replaying", () => {
    expect(retryFailure(new Error("OpenAI quota exhausted")).pause).toBe(true);
  });
  it("pauses denied provider calls", () => {
    expect(retryFailure(Object.assign(new Error("Provider denied"), { status: 403 })).pause).toBe(
      true,
    );
  });
  it("pauses unknown network outcomes", () => {
    expect(retryFailure(new Error("fetch failed")).code).toBe("unknown_outcome");
    expect(retryFailure(new Error("fetch failed")).pause).toBe(true);
  });
  it("rejects missing interview preparation", () => {
    expect(prepOutputSchema.safeParse({ _error: "prep failed" }).success).toBe(false);
  });
});
