# Step 315 review report

## Status
Source implementation is staged. **Not approved for production activation.** No live migration tool, production deployment, scheduler activation, or existing queue processing was performed. Active `wrangler.jsonc` was not edited. All 25 existing queue records were confirmed visible through Khalil's authenticated dashboard; retry/remove buttons are disabled during the review freeze. Attempts were not reset.

## Files changed
### Core source
- `src/lib/resume.functions.ts`
- `src/lib/resume-generation.server.ts` (new)
- `src/lib/packet.functions.ts`
- `src/lib/packet-generation.server.ts` (new)
- `src/lib/packet-quality.ts` (new)
- `src/lib/generation-contracts.ts` (new)
- `src/lib/retry-policy.ts` (new)
- `src/lib/retry-database.server.ts` (new)
- `src/lib/retry-processor.server.ts` (new)
- `src/lib/retry-scheduled.server.ts` (new)
- `src/lib/retry-queue.functions.ts`
- `src/lib/smart-apply.functions.ts`
- `src/lib/applications.functions.ts`
- `src/routes/ai-queue.tsx`
- `src/routes/api/public/hooks/retry-queue.ts`
- `src/server.ts`

### Minimal validation/metadata maintenance
- `src/routes/resume-diff.tsx`: optional search parameter type correction for existing links.
- `src/routes/__root.tsx`: current router error-prop type compatibility, no auth-flow change.
- `src/lib/page-metadata.ts` (new) and every content leaf under `src/routes/*.tsx` except `__root`: required unique title, description, Open Graph type/title/description, Twitter card. Public titles/canonical descriptions preserved. No page redesign.
- `package.json`, `bun.lock`: required package maintenance.

### Review documents and tests
- `AGENTS.md`, `roadmap.md`
- `docs/retry-repair/change-plan.md`
- `docs/retry-repair/review-migration.sql`
- `docs/retry-repair/wrangler.review.jsonc`
- `docs/retry-repair/review-report.md`
- `tests/retry-fixture.sql`
- `tests/retry-database.test.py`
- `tests/retry-policy.test.ts`
- `tests/retry-processor.test.ts`

## Database migration created
One **review-only, unapplied** SQL candidate: `docs/retry-repair/review-migration.sql`. It is intentionally outside the auto-applied migration directory because preview and published application share the same database.

Adds owner-scoped controls, usage reservations, packet locks, queue lease/start/duration/cost fields, and RPCs for reserve/finish usage, lock/unlock packets, claim/finish retries, lease recovery, and explicit resume. It adds no seed rows and does not change any existing retry attempts. Schema validity verified against disposable PostgreSQL 17; the existing retry-table migration was loaded as a local fixture only.

## Security changes
- Nested authenticated RPC calls removed from resume, packet, Smart Apply, and approval generation paths.
- Shared server-only helpers explicitly validate user UUIDs and owner-scoped jobs.
- New SQL RPCs enforce caller/owner authorization and daily limits even for service-role execution; restricted EXECUTE grants, fixed search paths, explicit table grants and RLS.
- Unprotected mutating legacy HTTP heartbeat retired to a non-mutating 410 response. Before: anonymous POST returned 200 with mutation counters; after: 410 with no queue operations.
- Native scheduled event requires two off-by-default activation flags; no public caller-supplied user identity or credential exposure.
- Due-only atomic claims, SKIP LOCKED, three-item run bound, fencing tokens, pauses and explicit recovery; quota/provider denials and unknown outcomes are not blindly replayed.
- Packet completion requires saved resume, cover, interview preparation and manual-review application. Prep failure is logged and cannot complete the queue row.
- Cache reuse includes validated persisted interview prep. No application submission was introduced.

## Test results
- **11 PostgreSQL tests passed**: 25/day concurrent reservation cap, existing resume/cover limits, auth/RLS isolation, concurrent unique claims, due/max/paused gating, stale-token fencing, missing prep prevention, quota pause/resume, abandoned leases, idempotent usage/cost logging, packet single-flight.
- **13 Vitest tests passed**: policy rules, failed prep, batch bound, no due work, freeze guard, quota circuit breaker, lost-lease handling, scheduled dry-run (zero claims and provider calls).
- **Focused ESLint passed** for new/extracted core server helpers, contracts, retry wrappers, server entry, retired endpoint and test files.
- **Full-project ESLint failed** with 5,460 findings (5,415 errors, 45 warnings), predominantly pre-existing formatting and explicit-any issues. Full-project cleanup is outside this architecture-only scope.
- **Authenticated browser check passed**: 25 records visible, no toast/read failures, retry controls disabled, signed-out queue redirects to auth, zero runtime errors, no mobile page overflow at 390px.
- No paid inference calls or production-data writes were used for testing.

## Build results
Latest automatic preview validation: **build OK** (2026-11-11 06:52:17 UTC). Initial pre-existing search-type issue and package-update error-prop mismatch were corrected minimally. Platform validation owns application builds/typechecks; no separate manual production build was invoked. Therefore a distinct production Worker artifact/deployment dry-run is **not independently verified** and remains an activation blocker.

## Remaining blockers / approval gates
1. Steps 314AV–314AW audit documents are not in the available uploads, project, or readable history; reconcile them before approval.
2. Full-project legacy lint debt prevents a completely clean repository-wide lint result.
3. Review and apply the staged additive schema only after explicit approval, then regenerate integration types. Production schema and new owner controls are deliberately unchanged now.
4. Configure approved owner controls, activation flags and native cron only after approval. Review disabling the previous live pg_cron heartbeat at that time; no production job changes were made.
5. Separate production Worker bundle/typecheck validation and a scheduled dry-run on an isolated deployed environment remain unverified. Fake scheduled dry-run passed locally.
6. Inspect unknown provider outcomes before unlocking abandoned packet leases; those are conservatively paused rather than automatically stolen/replayed.
7. Legacy interactive generation remains selected while `RETRY_REPAIR_ENABLED` is off. Atomic reservations apply to all repaired generation paths once enabled; they are not asserted active on production now.

## Explicit freeze confirmation
**Production deployment, production schema/data, all 25 existing retry records and attempt counts, and scheduler activation remain untouched.** The preview source was updated, but no production deployment action was taken.
