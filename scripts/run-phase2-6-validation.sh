#!/usr/bin/env bash
# ============================================================================
# Phase 2.6 — Live Environment Validation runner (macOS, run on your own
# machine with real network access — do NOT run this inside any cloud
# sandbox).
#
# Runs the safe, read-mostly validation sequence: install, test, typecheck,
# build, then Company Scout Dry Runs A/B/C (ALWAYS dryRun=true — hardcoded in
# scripts/phase2_5-dry-run-cli.ts itself, not a flag this script can change).
# Writes a single consolidated report to ./phase2_6-report.txt and each dry
# run's full JSON to ./phase2_6-dry-run-{a,b,c}-result.json.
#
# Safety:
#   - Never prints the VALUE of any secret env var, only whether it's set.
#   - Every step is independent; one failing step does not stop the others
#     (each is wrapped so failures are recorded, not fatal to the script).
#   - Does not run any SQL against your database — the baseline SQL queries
#     are read-only by design (see scripts/phase2_5/*.sql) but this script
#     does not execute them for you, since that requires a direct Postgres
#     connection string this script does not assume you have. Run them
#     yourself in the Supabase SQL Editor (see instructions doc) or via
#     `psql "$SUPABASE_DB_URL" -f scripts/phase2_5/baseline_sourcing_concentration.sql`
#     if you have that connection string set.
#   - Dry runs never mutate `companies`/`job_sources`/`applications` — that
#     guarantee comes from the CLI script itself (dryRun hardcoded true), not
#     from this shell script.
#
# Usage:
#   export SUPABASE_URL=...
#   export SUPABASE_SERVICE_ROLE_KEY=...
#   export SUPABASE_PUBLISHABLE_KEY=...        # needed for `bun run build`
#   export VITE_SUPABASE_URL=...
#   export VITE_SUPABASE_PUBLISHABLE_KEY=...
#   export VITE_SUPABASE_PROJECT_ID=...
#   export OPENAI_API_KEY=...                  # optional, only for --use-ai
#   export PHASE26_USER_ID=<your-auth-users-uuid>
#   ./scripts/run-phase2-6-validation.sh
# ============================================================================

set -u  # error on unset vars we explicitly reference; do NOT use -e (we want to continue past failing steps)

REPORT="./phase2_6-report.txt"
: > "$REPORT"

log() { echo "$@" | tee -a "$REPORT"; }
section() { log ""; log "===================================================================="; log "$1"; log "===================================================================="; }

run_step() {
  local label="$1"; shift
  section "$label"
  local start end
  start=$(date +%s)
  if "$@" >>"$REPORT.tmp" 2>&1; then
    log "RESULT: PASS (exit 0)"
  else
    log "RESULT: FAIL (exit $?)"
  fi
  end=$(date +%s)
  log "Duration: $((end-start))s"
  log "--- output ---"
  cat "$REPORT.tmp" | tee -a "$REPORT"
  rm -f "$REPORT.tmp"
}

section "Phase 2.6 Live Validation — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "Branch: $(git rev-parse --abbrev-ref HEAD 2>&1)"
log "Commit: $(git rev-parse HEAD 2>&1)"

# ---- env var presence check (never print values) --------------------------
section "Environment variable presence check (values never printed)"
for v in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_PUBLISHABLE_KEY VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY VITE_SUPABASE_PROJECT_ID; do
  if [ -n "${!v:-}" ]; then log "  $v: set"; else log "  $v: NOT SET"; fi
done
if [ -n "${OPENAI_API_KEY:-}" ]; then log "  OPENAI_API_KEY: set (optional)"; else log "  OPENAI_API_KEY: not set (optional — only needed for --use-ai)"; fi
if [ -n "${PHASE26_USER_ID:-}" ]; then log "  PHASE26_USER_ID: set"; else log "  PHASE26_USER_ID: NOT SET — dry runs will be skipped below"; fi

# ---- 1. install -------------------------------------------------------------
run_step "1/8 bun install" bun install

# ---- 2. test -----------------------------------------------------------------
run_step "2/8 bun run test" bun run test

# ---- 3. typecheck --------------------------------------------------------
# NOTE: package.json has no "typecheck" script — using `tsc --noEmit` directly
# (the real compiler, same one the project's own build depends on) rather
# than inventing a script that doesn't exist.
run_step "3/8 bunx tsc --noEmit (no 'typecheck' script exists in package.json)" bunx tsc --noEmit

# ---- 4. lint -----------------------------------------------------------------
run_step "4/8 bun run lint" bun run lint

# ---- 5. build ----------------------------------------------------------------
run_step "5/8 bun run build" bun run build

# ---- 6-8. Dry Runs A/B/C -----------------------------------------------------
if [ -z "${PHASE26_USER_ID:-}" ] || [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  section "6-8/8 Dry Runs A/B/C — SKIPPED"
  log "PHASE26_USER_ID / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not all set — skipping dry runs."
  log "Set them and re-run, or run scripts/phase2_5-dry-run-cli.ts directly per-run (see instructions doc)."
else
  run_step "6/8 Dry Run A (25/10/5, expansion off)" \
    bun run scripts/phase2_5-dry-run-cli.ts --user-id "$PHASE26_USER_ID" --run dry-run-a --candidates-file scripts/phase2_5/candidates-sample-dry-run-a.json
  [ -f ./phase2_5-dry-run-a-result.json ] && mv ./phase2_5-dry-run-a-result.json ./phase2_6-dry-run-a-result.json

  run_step "7/8 Dry Run B (50/15/7, expansion off)" \
    bun run scripts/phase2_5-dry-run-cli.ts --user-id "$PHASE26_USER_ID" --run dry-run-b --use-ai
  [ -f ./phase2_5-dry-run-b-result.json ] && mv ./phase2_5-dry-run-b-result.json ./phase2_6-dry-run-b-result.json

  run_step "8/8 Dry Run C (100/25/10, EXPANSION MODE) — the critical run" \
    bun run scripts/phase2_5-dry-run-cli.ts --user-id "$PHASE26_USER_ID" --run dry-run-c --use-ai
  [ -f ./phase2_5-dry-run-c-result.json ] && mv ./phase2_5-dry-run-c-result.json ./phase2_6-dry-run-c-result.json
fi

section "Phase 2.6 validation sequence complete"
log "Full report: $REPORT"
log "Dry-run JSON (if produced): ./phase2_6-dry-run-{a,b,c}-result.json"
log ""
log "Reminder: baseline SQL and the 20-example remote-eligibility manual audit are"
log "NOT automated by this script — run scripts/phase2_5/*.sql yourself (Supabase"
log "SQL Editor or psql) and do the manual spot-check per the instructions doc."
log ""
log "Send back: $REPORT and the 3 phase2_6-dry-run-*-result.json files (if produced)."
