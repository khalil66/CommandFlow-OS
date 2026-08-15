# Phase 2.6 — Local Live Validation: Run This On Your Mac

Everything here runs on **your machine**, with **your own real internet access and your own
Supabase/OpenAI credentials**. Nothing in this package talks to Anthropic's sandbox — it's a
plain checkout of the `phase-2-company-scout` branch plus the Phase 2.5 tooling. `dryRun` is
hardcoded `true` inside `scripts/phase2_5-dry-run-cli.ts` itself (not a flag), so nothing here
can write to `companies`/`job_sources`/`applications` no matter what you pass on the command line.

## What's in this package

- The full repo, checked out on `phase-2-company-scout` (Phase 0 through Phase 2, 5 commits,
  nothing pushed/merged — this is a local-only branch).
- `scripts/phase2_5-dry-run-cli.ts` — the Dry Run A/B/C tool.
- `scripts/phase2_5/verify_phase1_schema.sql` — read-only Phase 1 schema check.
- `scripts/phase2_5/baseline_sourcing_concentration.sql` — read-only sourcing baseline.
- `scripts/phase2_5/candidates-sample-dry-run-a.json` — smoke-test seed list for Dry Run A
  (career-page URLs/slugs from my training knowledge, not live-verified — expect some to be
  stale; that's fine, it exercises the same failure-isolation path a real run would use).
- `scripts/run-phase2-6-validation.sh` — runs steps 2-9 below in sequence, writes
  `phase2_6-report.txt` + 3 JSON result files.

## Environment variables — names only, set the values yourself, never send them to me

**Required for Supabase** (both the app build and the dry-run CLI need these):
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`
- `SUPABASE_SERVICE_ROLE_KEY` — **only needed for the dry-run CLI**, not the build. This key
  bypasses Row Level Security, so: prefer a staging/dev Supabase project over production if
  you have one (per the Phase 2.6 authorization's "Confirm Environment Safety" — staging/dev
  preferred, production only if that's all you have, and dry-run mode makes that safe either
  way since nothing is written). Treat this key exactly like a production secret — don't
  paste it into chat, a commit, or anywhere else it'll persist.

**Required for ATS access:** none. Greenhouse/Lever/Ashby/Breezy's public job-board APIs
(what `ingest.functions.ts` / the dry-run CLI call) don't require an API key.

**Required for AI/OpenAI:** `OPENAI_API_KEY` — only needed if you pass `--use-ai` to the CLI
(Dry Run B/C's organic candidate discovery). Dry Run A works without it via the provided seed
file.

**Optional:**
- `PHASE26_USER_ID` — your `auth.users.id` (a UUID) in the target Supabase project. Needed
  for the dry-run CLI and the helper script's steps 6-8; without it those steps are skipped
  (install/test/build still run). Find it in Supabase Studio → Authentication → Users, or
  `select id from auth.users where email = 'you@example.com';` in the SQL Editor.
- `SUPABASE_DB_URL` — a direct Postgres connection string, only useful if you want to run the
  baseline SQL via `psql` instead of pasting it into the Supabase SQL Editor (either works).

## Exact commands, in order (macOS, zsh/bash)

```bash
# 0) Unpack and enter the repo
tar xzf commandflow-os-phase2-6-package.tar.gz
cd commandflow-os-phase2-6-package

# Confirm you're on the right branch (should already be checked out)
git status
git log --oneline -5
```

```bash
# 1) Set your environment variables (values are yours — never paste them back to me)
export SUPABASE_URL="..."
export SUPABASE_PUBLISHABLE_KEY="..."
export VITE_SUPABASE_URL="..."
export VITE_SUPABASE_PUBLISHABLE_KEY="..."
export VITE_SUPABASE_PROJECT_ID="..."
export SUPABASE_SERVICE_ROLE_KEY="..."     # prefer a staging/dev project
export OPENAI_API_KEY="..."                 # optional, for --use-ai
export PHASE26_USER_ID="..."                # your auth.users.id
```

```bash
# 2) Install dependencies (real npm registry access — this is the step that
#    was blocked in the cloud sandbox)
bun install
```
**Copy back:** the full output, or at minimum the final line (success, or the exact error).

```bash
# 3) Run the real test suite
bun run test
```
**Copy back:** pass/fail counts and any failing test names + error messages.

```bash
# 4) TypeScript check — package.json has no dedicated "typecheck" script, so
#    this calls the compiler directly (same one `bun run build` uses)
bunx tsc --noEmit
```
**Copy back:** exit code and any errors (empty output = 0 errors).

```bash
# 5) Production build
bun run build
```
**Copy back:** success/failure and any build errors.

```bash
# (lint, if you want it — package.json has "lint": "eslint .")
bun run lint
```
**Copy back:** pass/fail and any errors (this one's optional/informational, not a GO/NO-GO gate).

```bash
# 6) Baseline sourcing concentration (read-only) — paste the contents of
#    scripts/phase2_5/baseline_sourcing_concentration.sql into the Supabase
#    SQL Editor for your project and run it, OR:
psql "$SUPABASE_DB_URL" -f scripts/phase2_5/baseline_sourcing_concentration.sql

# Also worth running once:
psql "$SUPABASE_DB_URL" -f scripts/phase2_5/verify_phase1_schema.sql
```
**Copy back:** the result of each of the 9 queries in `baseline_sourcing_concentration.sql`
(total active sources, unique companies, ATS breakdown, DEFAULT_SOURCES-still-active count,
7d/30d import counts, eligible jobs by company, Auto Apply by company, top-5/top-10
concentration) and the results of `verify_phase1_schema.sql`'s checks.

```bash
# 7) Dry Run A — existing ecosystem (25/10/5, expansion off)
bun run scripts/phase2_5-dry-run-cli.ts --user-id "$PHASE26_USER_ID" --run dry-run-a \
  --candidates-file scripts/phase2_5/candidates-sample-dry-run-a.json
```
**Copy back:** the printed JSON report, or the saved `phase2_5-dry-run-a-result.json`.

```bash
# 8) Dry Run B — broader discovery (50/15/7, expansion off), organic AI candidates
bun run scripts/phase2_5-dry-run-cli.ts --user-id "$PHASE26_USER_ID" --run dry-run-b --use-ai
```
**Copy back:** `phase2_5-dry-run-b-result.json`.

```bash
# 9) Dry Run C — EXPANSION MODE (100/25/10) — the critical run for the 70%
#    seed-escape threshold
bun run scripts/phase2_5-dry-run-cli.ts --user-id "$PHASE26_USER_ID" --run dry-run-c --use-ai
```
**Copy back:** `phase2_5-dry-run-c-result.json`, especially the `original_seed_escape` block
(`pct_of_proposed_new_sources_that_are_new`, `meets_70pct_target`).

```bash
# 10) Or, run everything at once (steps 2-9, minus the SQL step) and get one
#     consolidated report:
./scripts/run-phase2-6-validation.sh
```
**Copy back:** `phase2_6-report.txt` in full, plus the 3
`phase2_6-dry-run-{a,b,c}-result.json` files it produces.

## What to send back, minimum viable set

1. `phase2_6-report.txt` (or the raw output of steps 2-5 if you ran them individually)
2. The 3 dry-run JSON files (or their `original_seed_escape`, `us_remote_*`, `ats_mix`, and
   `candidates_evaluated`/`validated_companies`/`rejected_companies` fields at minimum)
3. The 9 baseline SQL query results
4. For the U.S.-remote accuracy audit (Phase 2.6 §10): pick ~20 companies from Dry Run
   B/C's `candidates` array spanning the eligibility classes it assigned, open their actual
   career pages, and note whether the classification matches what the page says — especially
   flag any `us_confirmed` result where the real page does NOT actually confirm US
   eligibility (that's the one true GO-blocking false-positive category).

Once I have these, I'll write the Phase 2.6 Live Validation Report per the original
authorization's 15-item deliverable and give a real GO/NO-GO — with actual numbers instead of
"blocked" next to most of them.
