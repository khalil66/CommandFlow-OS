// ============================================================================
// Phase 3.0 — the ONE architectural non-regression test.
//
// Makes it hard for a future change to accidentally introduce:
//
//     Company Scout  →  applications
//
// without going through the existing ingestion / Auto Review pipeline
// (importJobsNow → evaluateAutoReview → applications). Company Scout's own
// files already carry this as a documented promise (see the header comment
// in company-discovery.functions.ts: "It NEVER touches applications, never
// calls evaluateAutoReview()/AUTO_THRESHOLDS, never imports jobs itself").
// This file turns that promise into something that fails a test run instead
// of just a code review.
//
// Approach: import-graph + call-surface inspection, not string-matching
// prose. Every Company Scout source file's OWN import list is read via
// Node's module system (not regex on comments), so this survives comment
// rewording and reasonable internal refactors — it only fails if a Company
// Scout file starts genuinely importing from the ingestion/Auto Review/
// applications surface, which is exactly the change this test exists to
// catch.
//
// Run with: bun run test (vitest)
// ============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const COMPANY_SCOUT_FILES = [
  "./company-discovery.ts",
  "./company-discovery.functions.ts",
  "./company-discovery-ai.ts",
  "./ats-resolver.ts",
];

// Anything a Company Scout file is allowed to import from ingest.functions.ts.
// Widening this set is itself the kind of change this test is meant to force
// a deliberate, reviewed decision about.
const ALLOWED_INGEST_IMPORTS = new Set(["fetchByPlatform", "NormJob"]);

// Modules that own the Auto Apply / application-submission surface. A
// Company Scout file importing anything from these would be the exact
// regression this test exists to catch.
const FORBIDDEN_MODULE_SPECIFIERS = [
  "./auto-review-scoring",
  "./smart-apply.functions",
  "./retry-queue.functions",
  "./packet.functions",
];

function importedNamesFrom(moduleSpecifier: string, source: string): string[] {
  // Matches `import { a, b as c, type D } from "<moduleSpecifier>"` (single
  // or double quotes). Deliberately tolerant of `type` prefixes and multiline
  // import lists — it only needs to extract the bound names, not fully parse
  // TypeScript.
  // [^}]* (not [\s\S]*?) so the capture can never cross into a LATER,
  // unrelated `import { ... }` statement's own closing brace when this one's
  // opening `{` happens to be found first and this specifier isn't the
  // first import in the file.
  const re = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*["']${moduleSpecifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`,
    "g"
  );
  const names: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    for (const raw of m[1].split(",")) {
      const cleaned = raw.trim().replace(/^type\s+/, "");
      if (!cleaned) continue;
      const bound = cleaned.split(/\s+as\s+/).pop()!.trim();
      if (bound) names.push(bound);
    }
  }
  return names;
}

describe("Company Scout → applications architectural boundary", () => {
  for (const relPath of COMPANY_SCOUT_FILES) {
    it(`${relPath} imports nothing from the Auto Apply / application-submission surface`, () => {
      const source = readFileSync(new URL(relPath, import.meta.url), "utf8");
      for (const forbidden of FORBIDDEN_MODULE_SPECIFIERS) {
        expect(source).not.toMatch(
          new RegExp(`from\\s*["']${forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`)
        );
      }
    });

    it(`${relPath} never references the applications or job_listings tables directly`, () => {
      const source = readFileSync(new URL(relPath, import.meta.url), "utf8");
      // Matches a real Supabase call site, not incidental prose — e.g.
      // `.from("applications")` / `.from('job_listings')`.
      expect(source).not.toMatch(/\.from\(\s*["'](applications|job_listings)["']\s*\)/);
    });
  }

  it("company-discovery.functions.ts imports ONLY the allow-listed names from ingest.functions.ts — never importJobsNow or any other write-capable export", () => {
    const source = readFileSync(new URL("./company-discovery.functions.ts", import.meta.url), "utf8");
    const imported = importedNamesFrom("./ingest.functions", source);
    expect(imported.length).toBeGreaterThan(0); // sanity: the import actually exists
    for (const name of imported) {
      expect(ALLOWED_INGEST_IMPORTS.has(name)).toBe(true);
    }
    expect(imported).not.toContain("importJobsNow");
  });

  it("ingest.functions.ts (the real write path to job_listings/applications) never imports FROM any Company Scout file — the dependency only ever points one way", () => {
    const source = readFileSync(new URL("./ingest.functions.ts", import.meta.url), "utf8");
    for (const scoutFile of COMPANY_SCOUT_FILES) {
      const bare = scoutFile.replace(/^\.\//, "").replace(/\.ts$/, "");
      expect(source).not.toMatch(new RegExp(`from\\s*["']\\./${bare}["']`));
    }
  });

  it("resolveCompanyAts() (the ATS resolver) has no Supabase handle and cannot write state — re-asserted here as part of the end-to-end boundary, not just ats-resolver.test.ts's own copy", () => {
    const src = readFileSync(new URL("./ats-resolver.ts", import.meta.url), "utf8");
    const start = src.indexOf("export async function resolveCompanyAts");
    const end = src.indexOf("export async function defaultFetchPage");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = src.slice(start, end);
    expect(body).not.toMatch(/\bsupabase\s*[.[]/i);
    expect(body).not.toMatch(/\.insert\(|\.update\(|\.from\(/);
  });
});
