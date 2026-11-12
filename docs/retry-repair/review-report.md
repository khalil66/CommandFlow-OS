# Step 315B — Independent Final Verification

Verification date: 2026-11-11 UTC. Immutable comparison: pre-Step-315 `9140dbd` → staged Step-315 `15e46174f6cd70f3998aa2224ccb453e9022c080`. Do not use moving HEAD as the baseline; the workspace creates commits during verification.

## Verdict: HOLD — not independently ready for activation

No new product features, application behavior fixes, production deployment, production migration, queued-retry execution, attempt reset or scheduler activation were performed in Step 315B. Only verification tests, evidence documents and roadmap/report were added/updated. **It is not accurate to say all queue data remained unchanged or all production scheduling is inactive.** Existing production automation is active and changed history during the read-only checks. No workaround or unauthorized fix was applied.

## Verification matrix
| Check | Actual result |
|---|---|
| Atomic queue claims | PASS locally: 24 concurrent workers, 36 distinct queue rows, no duplicates, each attempt increased once. Separate locked-row test proves SKIP LOCKED returns another row without waiting for a 2-second lock. |
| Daily quota contention | PASS for cooperative callers: 100 mixed authenticated/service-role requests, 32 threads, exactly 25 accepted reservations. Existing 25 successful resumes or covers also block service-role requests. End-to-end tamper-proof enforcement FAILS; see blockers. |
| Existing queue preservation | 25 records retained; all quota_limited; sum of attempts remains 0. Full-row fingerprint changed due to existing live heartbeat. |
| Authentication | Signed-out /ai-queue redirects to /auth; authenticated readback shows 25 rows, retry/remove controls disabled; no runtime errors or mobile overflow. |
| Ownership isolation | Local foreign-owner claims/finish/reservation rejected; controls owner read works, other-owner read returns 0; anonymous claim denied. Live tables have RLS and auth.uid() owner policies. |
| Privileged execution protection | Service-role job/owner mismatch denied; native handler double flag gate and lazy privileged import. No credentials logged, returned or written into documents. Usage certification and client-write privileges remain security blockers. |
| Targeted tests | 13 Vitest + 11 existing SQL + 7 independent local checks executed successfully. Two independent checks successfully reproduce unsafe behavior, **not** safety passes. |
| Focused lint | Exit 0, retry core/wrappers/entry/retired hook and TypeScript tests. |
| Full lint | Exit 1, 5,439 errors / 45 warnings. Pre-315: 5,719 errors / 45 warnings. 164 unmatched new formatting findings; no unmatched new non-format findings. |
| Separate production build | **NOT RUN; actual exit code: N/A (no process launched).** Workspace instruction prohibits manual app builds/typechecks. Latest automatic validation says build OK, but is not a separate production build. |
| Native cron in production artifact | UNVERIFIED: no dist/.output production artifact exists; build blocked above. Review JSONC contains */15 * * * * with both flags false; active wrangler.jsonc has no triggers. Cannot claim cron is in build output. |
| Production cron inactive | New native cron was not activated by this work. Existing database cron job 1 is active every 15 minutes and targets the legacy retry hook. Total production scheduling is therefore NOT inactive. Native provider deployment settings cannot be independently read here. |

## Production preservation evidence (read-only)
- Initial read around 06:58 UTC: 25 records, all `quota_limited`, all `retry_attempts=0`; complete-row MD5 fingerprint `d86649d644130840338bec139b4b94af`. Latest updated_at: `2026-11-11T06:30:02.225585Z`.
- After 07:00 UTC: 25 records, all `quota_limited`, sum of attempts 0; complete-row fingerprint `8c74eb2fc27519819a5c3615e9fc8afc`; latest updated_at `2026-11-11T07:00:04.264470Z`; 21,593 total history events.
- Repeat at approximately 07:02 UTC matched the latter fingerprint. This proves mutation occurred during verification, not that the records were lost or attempts reset. Historical whole-row snapshots from before Step 315 are unavailable; cannot certify unchanged since that earlier stage.
- Read-only cron inspection: job 1, schedule `*/15 * * * *`, active true, legacy-hook target true, command fingerprint `063238bde8513321e8b7a60d6d1a7dbe`. Destination/auth material not printed. This strongly attributes the timed history changes to the existing heartbeat; no provider/packet execution was triggered by verification.
- Live `retry_controls` and `retry_claim(uuid,uuid,integer,integer)` are absent. The candidate schema was NOT applied. No live migration/data-write/cron-change tool was called.

## Complete Step 315 file-by-file change inventory
71 files, 3,071 added / 1,372 removed lines, including generated and managed changes (not all handwritten retry work). No changed file is intentionally omitted; secret configuration values are excluded.

| File | + / − lines | Change |
|---|---:|---|
| `.env` | 1 / 0 | Managed configuration: added server project-name variable only; values intentionally omitted. No activation flag introduced. |
| `.lovable/north-star/north-star.md` | 9 / 0 | Private goal/metric metadata; no retry behavior. |
| `AGENTS.md` | 5 / 0 | Architecture constraints for server-only helpers, staged schema/cron, atomic enforcement and disposable tests. |
| `bun.lock` | 261 / 233 | 261 added / 233 removed lines; complete dependency/integrity diff provided separately. |
| `docs/retry-repair/change-plan.md` | 30 / 0 | Exact staged repair plan and restrictions. |
| `docs/retry-repair/review-migration.sql` | 204 / 0 | 204-line unapplied additive schema/RPC candidate; full SQL reproduced below. |
| `docs/retry-repair/review-report.md` | 78 / 0 | Original Step 315 report, superseded by this independent report. |
| `docs/retry-repair/wrangler.review.jsonc` | 15 / 0 | Review-only 15-minute native cron proposal with both flags false. |
| `package.json` | 5 / 5 | Five version declarations changed; scripts and dependency names unchanged. |
| `roadmap.md` | 9 / 0 | Repair task list and blocked approval gates. |
| `src/integrations/supabase/client.ts` | 2 / 1 | Generated preview session storage hookup; API configuration unchanged. |
| `src/integrations/supabase/previewAuthStorage.ts` | 144 / 0 | Generated trusted-editor session broker with constrained target/reply origins and local-storage fallback. |
| `src/integrations/supabase/types.ts` | 10 / 10 | Generated conditional-generic parenthesization only; no retry schema added. |
| `src/lib/applications.functions.ts` | 2 / 2 | Approval calls internal packet helper with authenticated client/owner, not RPC stub. |
| `src/lib/generation-contracts.ts` | 42 / 0 | Reusable validated resume inputs/outputs and interview-preparation contract. |
| `src/lib/packet-generation.server.ts` | 357 / 0 | Internal owner-scoped packet helper; lease, cache, prep generation/persistence, manual-review readback. |
| `src/lib/packet-quality.ts` | 41 / 0 | Browser-safe deterministic packet quality and confidence scoring extracted. |
| `src/lib/packet.functions.ts` | 56 / 292 | Authenticated thin generation wrapper and existing manual decision/read operations. |
| `src/lib/page-metadata.ts` | 13 / 0 | Shared app-specific leaf metadata helper. |
| `src/lib/resume-generation.server.ts` | 422 / 0 | Internal owner-scoped resume/cover generation; repaired reservation path plus legacy flag-off path. |
| `src/lib/resume.functions.ts` | 4 / 228 | Thin authenticated wrapper delegates to internal resume helper. |
| `src/lib/retry-database.server.ts` | 176 / 0 | Review RPC types, fail-closed reservations, packet locks, readback and claim validation. |
| `src/lib/retry-policy.ts` | 38 / 0 | 25/day constants, batch 3, 900-second lease, delays and error classification. |
| `src/lib/retry-processor.server.ts` | 73 / 0 | Flag gate, recovery, single-at-a-time bounded claims, generation and token-fenced finish. |
| `src/lib/retry-queue.functions.ts` | 122 / 105 | Authenticated queue reads/metrics, processor wrappers, eligible rearm without attempt reset, explicit resume. |
| `src/lib/retry-scheduled.server.ts` | 10 / 0 | Double-flag dry-run guard; trusted scheduled execution lazily loads privileged client. |
| `src/lib/smart-apply.functions.ts` | 3 / 2 | Browser-safe quality import; generation calls internal packet helper. |
| `src/routeTree.gen.ts` | 316 / 306 | Generated router tree updated/reformatted after dependency change; not manually edited. |
| `src/routes/__root.tsx` | 3 / 2 | Router ErrorComponentProps compatibility and safe error narrowing; existing auth logic unchanged. |
| `src/routes/admin-recovery.tsx` | 3 / 1 | Leaf app-specific title/description/Open Graph/Twitter metadata; no page redesign. |
| `src/routes/ai-queue.tsx` | 257 / 81 | Approval freeze banner, disabled retry/remove controls, duration/cost/lease metrics and leaf metadata. |
| `src/routes/analytics.tsx` | 3 / 1 | Leaf app-specific title/description/Open Graph/Twitter metadata; no page redesign. |
| `src/routes/api/public/hooks/retry-queue.ts` | 7 / 69 | Legacy unauthenticated mutating heartbeat replaced in source by non-mutating HTTP 410. |
| `src/routes/ats.tsx` | 3 / 1 | Leaf app-specific title/description/Open Graph/Twitter metadata; no page redesign. |
| `src/routes/auth.tsx` | 3 / 1 | Leaf app-specific title/description/Open Graph/Twitter metadata; no page redesign. |
| `src/routes/batches.tsx` | 3 / 1 | Leaf app-specific title/description/Open Graph/Twitter metadata; no page redesign. |
| `src/routes/case-study.tsx` | 1 / 0 | Public leaf: adds Twitter card metadata only; existing content/canonical unchanged. |
| `src/routes/companies.tsx` | 3 / 1 | Leaf app-specific title/description/Open Graph/Twitter metadata; no page redesign. |
| `src/routes/company-intelligence.tsx` | 3 / 1 | Leaf app-specific title/description/Open Graph/Twitter metadata; no page redesign. |
| `src/routes/demo.tsx` | 1 / 0 | Public leaf: adds Twitter card metadata only; existing content/canonical unchanged. |
| `src/routes/engagement.tsx` | 3 / 1 | Leaf app-specific title/description/Open Graph/Twitter metadata; no page redesign. |
| `src/routes/executive.tsx` | 2 / 1 | Leaf app-specific title/description/Open Graph/Twitter metadata; no page redesign. |
| `src/routes/follow-ups.tsx` | 3 / 1 | Leaf app-specific title/description/Open Graph/Twitter metadata; no page redesign. |
| `src/routes/high-probability.tsx` | 3 / 1 | Leaf app-specific title/description/Open Graph/Twitter metadata; no page redesign. |
| `src/routes/index.tsx` | 3 / 1 | Leaf app-specific title/description/Open Graph/Twitter metadata; no page redesign. |
| `src/routes/legitimacy.tsx` | 3 / 1 | Leaf app-specific title/description/Open Graph/Twitter metadata; no page redesign. |
| `src/routes/monitoring.tsx` | 2 / 0 | Leaf app-specific title/description/Open Graph/Twitter metadata; no page redesign. |
| `src/routes/onboarding.tsx` | 3 / 1 | Leaf app-specific title/description/Open Graph/Twitter metadata; no page redesign. |
| `src/routes/outcomes.tsx` | 2 / 6 | Leaf app-specific title/description/Open Graph/Twitter metadata; no page redesign. |
| `src/routes/packet.$jobId.tsx` | 3 / 1 | Leaf app-specific title/description/Open Graph/Twitter metadata; no page redesign. |
| `src/routes/pipeline.tsx` | 3 / 1 | Leaf app-specific title/description/Open Graph/Twitter metadata; no page redesign. |
| `src/routes/portfolio.tsx` | 1 / 0 | Public leaf: adds Twitter card metadata only; existing content/canonical unchanged. |
| `src/routes/queue.tsx` | 3 / 1 | Leaf app-specific title/description/Open Graph/Twitter metadata; no page redesign. |
| `src/routes/recruiters.tsx` | 3 / 1 | Leaf app-specific title/description/Open Graph/Twitter metadata; no page redesign. |
| `src/routes/reset-password.tsx` | 3 / 1 | Leaf app-specific title/description/Open Graph/Twitter metadata; no page redesign. |
| `src/routes/resume-diff.tsx` | 3 / 1 | Optional search parameter type compatibility and leaf metadata. |
| `src/routes/resume-variants.tsx` | 2 / 1 | Leaf app-specific title/description/Open Graph/Twitter metadata; no page redesign. |
| `src/routes/resume.tsx` | 3 / 1 | Leaf app-specific title/description/Open Graph/Twitter metadata; no page redesign. |
| `src/routes/review.tsx` | 3 / 1 | Leaf app-specific title/description/Open Graph/Twitter metadata; no page redesign. |
| `src/routes/safe-auto-submit.tsx` | 3 / 1 | Leaf app-specific title/description/Open Graph/Twitter metadata; no page redesign. |
| `src/routes/sandbox.tsx` | 1 / 0 | Public leaf: adds Twitter card metadata only; existing content/canonical unchanged. |
| `src/routes/settings.tsx` | 3 / 1 | Leaf app-specific title/description/Open Graph/Twitter metadata; no page redesign. |
| `src/routes/smart-apply.tsx` | 3 / 1 | Leaf app-specific title/description/Open Graph/Twitter metadata; no page redesign. |
| `src/routes/sources.tsx` | 3 / 1 | Leaf app-specific title/description/Open Graph/Twitter metadata; no page redesign. |
| `src/routes/system.tsx` | 3 / 1 | Leaf app-specific title/description/Open Graph/Twitter metadata; no page redesign. |
| `src/routes/tracker.tsx` | 3 / 1 | Leaf app-specific title/description/Open Graph/Twitter metadata; no page redesign. |
| `src/server.ts` | 12 / 1 | Native scheduled handler added behind two flags; fetch/error wrapper preserved. |
| `tests/retry-database.test.py` | 118 / 0 | 11 disposable PostgreSQL tests; no production connection. |
| `tests/retry-fixture.sql` | 15 / 0 | Minimal fake roles/auth/artifact tables for isolated SQL testing. |
| `tests/retry-policy.test.ts` | 37 / 0 | Six concrete retry-policy/contract tests. |
| `tests/retry-processor.test.ts` | 81 / 0 | Seven fake-provider orchestration/freeze tests. |

### Step 315B verification-only additions/updates
- `docs/retry-repair/review-report.md`: this final independent report, complete candidate SQL and blockers.
- `docs/retry-repair/rollback-plan.md`: operational rollback and optional complete down SQL; not executed.
- `docs/retry-repair/package-update.diff`: complete package.json/bun.lock patch from pinned baseline.
- `docs/retry-repair/lockfile-changes.md`: every added/removed/version-changed lock entry.
- `docs/retry-repair/lint-comparison.md`: complete per-file baseline/current lint counts.
- `docs/retry-repair/verification-results.txt`: actual test/lint/build status summary.
- `docs/retry-repair/dependency-audit.json`: raw current advisory result, no credentials.
- `docs/retry-repair/dependency-audit-before.json`: raw pinned-baseline advisory result.
- `tests/retry-independent.test.py`: local stress checks and security reproductions; fake records only.
- `roadmap.md`: marks verification complete and names unresolved approval/verification gates.

## Package security update review
Five declaration changes, no scripts or package names changed:
| Package | Before | After |
|---|---|---|
| @tanstack/react-router | ^1.168.25 | 1.170.41 |
| @tanstack/react-start | ^1.167.50 | 1.168.60 |
| @tanstack/router-plugin | ^1.167.28 | 1.168.42 |
| nitro | 3.0.260429-beta | 3.0.260603-beta |
| @lovable.dev/vite-tanstack-config | 2.3.1 | 2.26.5 |

The prior summary mentioned three TanStack updates but the actual patch also updates Nitro and the shared Vite configuration package. Lock entries: 733 → 747, 127 added, 113 removed, 36 version-changed common keys. Some add/remove keys reflect nested resolver deduplication, not 127 independent new products. Entire integrity/dependency-edge patch is in `package-update.diff`; complete entry table in `lockfile-changes.md`. Important changes include seroval 1.5.4 → 1.6.7, router/start cores, devtools tooling and OXC parser bindings; unrelated unchanged libraries remain.

`bun audit --json` current exit **1**; baseline exit **1**. Unique (package, advisory URL, severity) findings: 91 → 80, no newly unmatched advisory, 11 removed; current 33 high / 33 moderate / 14 low, zero critical in this audit. Raw results contain repeated advisories across package variants (86 raw entries), so do not confuse raw with unique counts. Removed findings include critical TanStack server and seroval issues. This is an improvement, **not a clean security audit or proof of production exploitability**. Dependency scanning is advisory; Worker bundle reachability remains unverified.

| Package | Unique advisories | Highest severity |
|---|---:|---|
| `@babel/core` | 1 | low |
| `baseline-browser-mapping` | 1 | moderate |
| `brace-expansion` | 7 | high |
| `browserslist` | 2 | high |
| `dompurify` | 13 | high |
| `esbuild` | 1 | low |
| `fflate` | 1 | moderate |
| `js-yaml` | 4 | high |
| `minimatch` | 1 | moderate |
| `nanoid` | 3 | high |
| `postcss` | 3 | high |
| `sharp` | 3 | high |
| `source-map-js` | 1 | high |
| `undici` | 29 | high |
| `vite` | 7 | high |
| `ws` | 2 | high |
| `zod` | 1 | high |

Hashes (SHA-256):
- package.json `8a1b6de468cc4be349b78446dfd61c0d0f57db53b93b2ec9f9e269ecda1c2b8f`
- bun.lock `cd9a1e8adcc4e82e3f9b7e8fe2680a2d90931ff0750ca3a1a95db41455c85782`
- active wrangler.jsonc `44a244a3817413d9641b9d4fde8bfdd7d3293e26db5a39b5cee7aa946e51a163` (unchanged)
- review wrangler JSONC `175956c904df2549251183ef419b917ac716366d1e972e4cdaf5084564064320`

## Test details and limitations
- `bunx vitest run tests/retry-policy.test.ts tests/retry-processor.test.ts`: exit 0, 13 pass; provider helper mocked, no paid calls. Includes freeze, due gating, batch 3, failed prep, quota stop, lost lease, scheduled flag-off dry run.
- `python3 tests/retry-database.test.py`: exit 0, 11 pass on disposable PostgreSQL 17.11 at `/tmp/retry-pg:55439`, never the managed production database. Includes advisory-lock limits, due claims, ownership/RLS, token fencing, persisted prep requirement, abandoned leases and single flight.
- `python3 tests/retry-independent.test.py`: seven local checks; checks 5 safe properties and reproduces 2 unsafe properties. Multi-row queue test uses distinct jobs to obey the real unique constraint. Initial fixture failed because it reused a job; fixture corrected, application SQL unchanged.
- Local fixture simplifies artifact tables/auth functions. No full provider-success packet workflow or published Worker scheduled event was independently executed. The existing orchestration prep test mocks the whole helper; contract and SQL checks validate prep failure separately, not a full provider integration.
- Focused ESLint: exit 0. Full `bunx eslint . --format json`: exit 1. Same current tooling/rules used on immutable pre315 source; no baseline dependency installation performed.
- Full lint: 4,820 formatting, 603 explicit-any, 14 no-empty, 1 prefer-const, 1 no-unused-expressions, 2 parser findings (Python files); warnings 31 hook dependencies / 12 refresh / 2 formatting. The old 5,415-error report was not reproduced; actual current is 5,439. New unmatched 164 findings all formatting; includes 42 managed/generated-file findings and metadata additions in existing pages. Detailed per-file counts in `lint-comparison.md`. Baseline attribution uses message multiplicities, not proof that each same-text issue is identical code.
- Read-only authenticated browser flow: exit 0, /ai-queue, 25 rows, paused banner, global/row retry disabled, no toast errors/page errors, 390px no document overflow. No controls which write or generate were clicked. Signed-out protection checked first.

## Build and native scheduled execution: explicit unresolved blockers
Requested command is `bun run build` (vite build), but **it was not invoked** because workspace-level instructions forbid manual Lovable app builds or typechecks. Actual independent build exit code is **N/A**, not 0, not an inferred code. Automatic log at `2026-11-11T06:59:05Z`: `build OK`. No independent TypeScript exit code; automatic validation is the only available signal. No production deployment/dry-run workaround attempted.

No local production output was available to inspect, so presence of `scheduled` export and cron metadata in the generated Worker bundle cannot be certified. The source handler exists, and the review proposal is present only outside active deployment paths. Active configuration has **no** cron trigger. It would be misleading to claim both a bundled 15-minute trigger and untouched active configuration without an approved isolated build configuration.

Source also mixes scheduled `env` flags with `process.env` in the processor/lease/resume helpers. Source review cannot prove runtime binding consistency; it needs an isolated Worker event test after an authorized build. No native Cloudflare production settings read was available. Existing database heartbeat is verified active independently of native cron.

## Security review and unresolved blockers (no fixes made)
1. **Usage evidence is caller-writable.** Live openai_usage owner policies permit INSERT/UPDATE/DELETE, and effective authenticated privileges include all CRUD. Thus an owner can erase their 25 successful usage records and obtain another reservation. Reproduced against local fake tables with the same owner-policy privilege pattern. Cooperative concurrency serialization is sound, but “cannot exceed 25 under every execution path” is NOT proven while evidence can be erased.
2. **Authenticated callers can certify results themselves.** Candidate grants authenticated EXECUTE on `retry_finish_usage` and accepts caller-supplied success, tokens/cost and IDs without provider evidence. Local authenticated request with fake success and no saved artifacts writes successful usage. This invalidates strong audit-integrity assurances; fail-closed ownership alone is insufficient.
3. **Review freeze is not server-enforced for all writes.** UI removes/retries disabled and processor blocks generation flag-off, but `removeQueueItem` lacks flag gate and queue owner CRUD remains permitted; `enqueueRetryRow` can rearm eligible existing records. Did not invoke these on production. “No code can mutate existing records during review” is false; no deletion occurred in verification.
4. **Native scheduling not independently bundled/tested.** See build blocker and env/process.env split above. Active legacy database heartbeat already mutates rows; it remains unchanged per user restriction. Preview’s “scheduled execution inactive” describes new processor gating, not total production automation.
5. **Service-role enforcement is not active on production.** Staged functions reject foreign jobs and enforce quota for honest service-role calls; privileged role intentionally bypasses RLS. No credential exposure detected in reviewed code, but client-bundle absence is unverified without artifact. Owner job lookup exists in server-only helpers; wrappers use validated auth context, not client user IDs.
6. **SQL artifact completion check is weaker than full prep contract.** `retry_finish` accepts non-empty JSON brief, not the full prep schema. `validateSavedPacket` checks truthiness; cached resume/cover are selected by existence then validated later. Normal repaired helper validates prep schema, but a direct RPC caller can supply own data. No unsafe completion was triggered on production.
7. **Unknown recovery/cost completeness.** Packet locks deliberately are not stolen when expired, so recovery may require manual inspection. Failure prep logging records automation failure but does not always record provider attempt tokens/cost; total cost may undercount failed/unknown calls. No workaround/refund/reset performed.
8. **Legacy path remains selected flag-off.** It has non-atomic read-then-generate caps and is not protected by the staged reservations. Cannot advertise global quota enforcement as currently deployed.
9. Missing Steps 314AV–314AW audit documents remain an approval blocker. Available history references them but does not contain the audits.
10. Full lint/new formatting debt and 80 unique dependency advisory findings remain; scope prohibits unrelated repair.

New candidate tables each follow CREATE TABLE → explicit authenticated/service_role GRANT → ENABLE RLS → owner SELECT policy. New SECURITY DEFINER RPCs set fixed search_path and revoke PUBLIC EXECUTE; authorization checks are present. These positive properties do not negate blockers 1–3. Public /demo and /case-study auth whitelist is unchanged. No application submission code was added or executed.

## Complete review-only migration (unapplied, not approved as safe for activation)
Location: `docs/retry-repair/review-migration.sql`; 204 lines; SHA-256 `a907a53bd79ec42fc25bc338b7a622a20dd73b2941f8afb960e86d71b10d862d`. It is outside automatically applied migration/deployment paths. Creates retry_controls, retry_usage_reservations and retry_packet_leases; adds five queue columns and nine RPCs. Adds no controls seed rows or retry records; never updates existing attempts. Default execution is disabled/no owner controls.

The candidate is reproduced **verbatim** below, including identified weaknesses; changing it would exceed verification-only scope. Do not apply before follow-up security repair and explicit approval.

```sql
-- REVIEW ONLY. Do not apply to the shared production backend before approval.
CREATE TABLE public.retry_controls (
  user_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  paused boolean NOT NULL DEFAULT false,
  pause_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.retry_controls TO authenticated;
GRANT ALL ON public.retry_controls TO service_role;
ALTER TABLE public.retry_controls ENABLE ROW LEVEL SECURITY;
CREATE POLICY retry_controls_owner_read ON public.retry_controls FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.retry_usage_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  job_id uuid,
  usage_day date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  status text NOT NULL DEFAULT 'reserved',
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
GRANT SELECT ON public.retry_usage_reservations TO authenticated;
GRANT ALL ON public.retry_usage_reservations TO service_role;
ALTER TABLE public.retry_usage_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY retry_usage_owner_read ON public.retry_usage_reservations FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX retry_usage_day ON public.retry_usage_reservations(user_id, usage_day);

CREATE TABLE public.retry_packet_leases (
  user_id uuid NOT NULL,
  job_id uuid NOT NULL,
  token uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(user_id, job_id)
);
GRANT SELECT ON public.retry_packet_leases TO authenticated;
GRANT ALL ON public.retry_packet_leases TO service_role;
ALTER TABLE public.retry_packet_leases ENABLE ROW LEVEL SECURITY;
CREATE POLICY retry_packet_owner_read ON public.retry_packet_leases FOR SELECT TO authenticated USING (auth.uid() = user_id);

ALTER TABLE public.ai_retry_queue ADD COLUMN lease_token uuid;
ALTER TABLE public.ai_retry_queue ADD COLUMN lease_expires_at timestamptz;
ALTER TABLE public.ai_retry_queue ADD COLUMN started_at timestamptz;
ALTER TABLE public.ai_retry_queue ADD COLUMN duration_ms bigint;
ALTER TABLE public.ai_retry_queue ADD COLUMN estimated_cost_cents numeric NOT NULL DEFAULT 0;

-- Shared authorization inside every SECURITY DEFINER RPC, including service-role calls.
CREATE FUNCTION public.retry_assert_user(p_user uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_user IS NULL OR (auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user) THEN
    RAISE EXCEPTION 'Unauthorized retry owner' USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.retry_assert_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retry_assert_user(uuid) TO authenticated, service_role;

CREATE FUNCTION public.retry_reserve_usage(p_user uuid, p_job uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_day date := (now() AT TIME ZONE 'UTC')::date;
  v_since timestamptz := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_resumes integer; v_covers integer; v_reserved integer; v_id uuid;
BEGIN
  PERFORM public.retry_assert_user(p_user);
  IF p_job IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.job_listings WHERE id = p_job AND user_id = p_user) THEN
    RAISE EXCEPTION 'Job not found';
  END IF;
  -- Serialize reservations across all Worker instances and interactive requests.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text || ':usage:' || v_day::text, 0));
  SELECT count(*) INTO v_resumes FROM public.openai_usage WHERE user_id=p_user AND kind='resume' AND success AND created_at>=v_since;
  SELECT count(*) INTO v_covers FROM public.openai_usage WHERE user_id=p_user AND kind='cover_letter' AND success AND created_at>=v_since;
  -- Completed successes are already in usage logs. Failures/unknowns consume reservations conservatively.
  SELECT count(*) INTO v_reserved FROM public.retry_usage_reservations WHERE user_id=p_user AND usage_day=v_day AND status <> 'succeeded';
  IF v_resumes + v_reserved >= 25 OR v_covers + v_reserved >= 25 THEN
    RAISE EXCEPTION 'DAILY_LIMIT: 25 resumes and 25 cover letters per user per UTC day';
  END IF;
  INSERT INTO public.retry_usage_reservations(user_id, job_id, usage_day) VALUES(p_user,p_job,v_day) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.retry_reserve_usage(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retry_reserve_usage(uuid,uuid) TO authenticated,service_role;

CREATE FUNCTION public.retry_finish_usage(p_user uuid, p_reservation uuid, p_result jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.retry_usage_reservations; v_success boolean := coalesce((p_result->>'success')::boolean,false);
BEGIN
  PERFORM public.retry_assert_user(p_user);
  SELECT * INTO r FROM public.retry_usage_reservations WHERE id=p_reservation AND user_id=p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  IF r.status <> 'reserved' THEN RETURN true; END IF;
  INSERT INTO public.openai_usage(user_id,job_id,kind,model,success,error,prompt_tokens,completion_tokens,estimated_cost_cents,resume_version_id,match_score)
    VALUES(p_user,r.job_id,'resume',p_result->>'model',v_success,left(p_result->>'error',200),coalesce((p_result->>'prompt_tokens')::integer,0),coalesce((p_result->>'completion_tokens')::integer,0),coalesce((p_result->>'estimated_cost_cents')::numeric,0)/2,(p_result->>'resume_id')::uuid,(p_result->>'match_score')::integer);
  INSERT INTO public.openai_usage(user_id,job_id,kind,model,success,error,prompt_tokens,completion_tokens,estimated_cost_cents,cover_letter_id,match_score)
    VALUES(p_user,r.job_id,'cover_letter',p_result->>'model',v_success,left(p_result->>'error',200),0,0,coalesce((p_result->>'estimated_cost_cents')::numeric,0)/2,(p_result->>'cover_id')::uuid,(p_result->>'match_score')::integer);
  UPDATE public.retry_usage_reservations SET status=CASE WHEN v_success THEN 'succeeded' ELSE 'failed' END, result=p_result, completed_at=now() WHERE id=r.id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.retry_finish_usage(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retry_finish_usage(uuid,uuid,jsonb) TO authenticated,service_role;

CREATE FUNCTION public.retry_packet_lock(p_user uuid,p_job uuid,p_token uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_count integer;
BEGIN
  PERFORM public.retry_assert_user(p_user);
  IF NOT EXISTS(SELECT 1 FROM public.job_listings WHERE id=p_job AND user_id=p_user) THEN RAISE EXCEPTION 'Job not found'; END IF;
  -- Expired locks are not stolen: a provider may still be running. Recovery requires review.
  INSERT INTO public.retry_packet_leases(user_id,job_id,token,expires_at) VALUES(p_user,p_job,p_token,now()+interval '15 minutes') ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END $$;
REVOKE ALL ON FUNCTION public.retry_packet_lock(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retry_packet_lock(uuid,uuid,uuid) TO authenticated,service_role;

CREATE FUNCTION public.retry_packet_unlock(p_user uuid,p_job uuid,p_token uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public.retry_assert_user(p_user);
  DELETE FROM public.retry_packet_leases WHERE user_id=p_user AND job_id=p_job AND token=p_token;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.retry_packet_unlock(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retry_packet_unlock(uuid,uuid,uuid) TO authenticated,service_role;

CREATE FUNCTION public.retry_claim(p_user uuid DEFAULT NULL,p_id uuid DEFAULT NULL,p_limit integer DEFAULT 3,p_lease_seconds integer DEFAULT 900) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_rows jsonb;
BEGIN
  IF auth.role() <> 'service_role' OR p_user IS NOT NULL THEN PERFORM public.retry_assert_user(p_user); END IF;
  IF p_limit < 1 OR p_limit > 3 OR p_lease_seconds <> 900 THEN RAISE EXCEPTION 'Invalid claim bounds'; END IF;
  WITH candidates AS (
    SELECT q.id FROM public.ai_retry_queue q JOIN public.retry_controls c ON c.user_id=q.user_id
    WHERE (p_user IS NULL OR q.user_id=p_user) AND (p_id IS NULL OR q.id=p_id)
      AND c.enabled AND NOT c.paused AND q.kind='packet'
      AND q.status IN ('queued','quota_limited') AND q.next_retry_at<=now()
      AND q.retry_attempts<q.max_attempts AND q.lease_token IS NULL
      AND NOT EXISTS(SELECT 1 FROM public.retry_packet_leases l WHERE l.user_id=q.user_id AND l.job_id=q.job_id)
    ORDER BY q.next_retry_at,q.id FOR UPDATE OF q SKIP LOCKED LIMIT p_limit
  ), claimed AS (
    UPDATE public.ai_retry_queue q SET status='retrying',lease_token=gen_random_uuid(),
      lease_expires_at=now()+make_interval(secs=>p_lease_seconds), started_at=now(),last_retry_at=now(),
      retry_attempts=q.retry_attempts+1,retry_status='in_progress',
      history=q.history || jsonb_build_array(jsonb_build_object('ts',now(),'event','claimed','attempt',q.retry_attempts+1))
    FROM candidates c WHERE q.id=c.id RETURNING q.*
  ) SELECT coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) INTO v_rows FROM claimed;
  RETURN v_rows;
END $$;
REVOKE ALL ON FUNCTION public.retry_claim(uuid,uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retry_claim(uuid,uuid,integer,integer) TO authenticated,service_role;

CREATE FUNCTION public.retry_finish(p_user uuid,p_id uuid,p_token uuid,p_result jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.ai_retry_queue; v_success boolean:=coalesce((p_result->>'success')::boolean,false); v_status text;
BEGIN
  PERFORM public.retry_assert_user(p_user);
  SELECT * INTO r FROM public.ai_retry_queue WHERE id=p_id AND user_id=p_user FOR UPDATE;
  IF NOT FOUND OR r.status<>'retrying' OR r.lease_token IS DISTINCT FROM p_token OR r.lease_expires_at<=now() THEN RETURN false; END IF;
  IF v_success AND NOT EXISTS (
    SELECT 1 FROM public.applications a
    JOIN public.resume_versions rv ON rv.id=a.resume_version_id AND rv.user_id=a.user_id AND rv.job_id=a.job_id
    JOIN public.cover_letters cl ON cl.id=a.cover_letter_id AND cl.user_id=a.user_id AND cl.job_id=a.job_id
    JOIN public.interview_prep ip ON ip.application_id=a.id AND ip.user_id=a.user_id AND ip.job_id=a.job_id
    WHERE a.user_id=p_user AND a.job_id=r.job_id AND a.status='manual_review'
      AND length(coalesce(rv.summary,''))>0 AND cardinality(rv.bullets)>0 AND length(coalesce(cl.body,''))>0 AND ip.brief<>'{}'::jsonb
  ) THEN RAISE EXCEPTION 'Packet artifacts missing'; END IF;
  v_status := CASE WHEN v_success THEN 'completed' WHEN r.retry_attempts>=r.max_attempts THEN 'failed' ELSE p_result->>'status' END;
  IF v_status NOT IN ('completed','failed','queued','quota_limited','paused') THEN RAISE EXCEPTION 'Invalid result status'; END IF;
  UPDATE public.ai_retry_queue SET status=v_status,retry_status=p_result->>'code',last_error=left(p_result->>'message',400),
    next_retry_at=CASE WHEN v_success THEN next_retry_at ELSE coalesce((p_result->>'next_retry_at')::timestamptz,next_retry_at) END,
    duration_ms=greatest(0,(extract(epoch FROM now()-started_at)*1000)::bigint),
    estimated_cost_cents=coalesce((SELECT sum(estimated_cost_cents) FROM public.openai_usage WHERE user_id=p_user AND job_id=r.job_id AND created_at>=r.started_at),0),
    lease_token=NULL,lease_expires_at=NULL,
    history=history || jsonb_build_array(p_result || jsonb_build_object('ts',now(),'attempt',r.retry_attempts)) WHERE id=p_id;
  IF coalesce((p_result->>'pause')::boolean,false) THEN
    UPDATE public.retry_controls SET paused=true,pause_reason=p_result->>'code',updated_at=now() WHERE user_id=p_user;
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.retry_finish(uuid,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retry_finish(uuid,uuid,uuid,jsonb) TO authenticated,service_role;

CREATE FUNCTION public.retry_recover_leases(p_user uuid DEFAULT NULL) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_count integer;
BEGIN
  IF auth.role()<>'service_role' OR p_user IS NOT NULL THEN PERFORM public.retry_assert_user(p_user); END IF;
  -- Never replay an abandoned/unknown inference automatically. Preserve packet locks for inspection.
  WITH abandoned AS (
    UPDATE public.ai_retry_queue SET status='paused',retry_status='abandoned_lease',last_error='Unknown provider outcome: review required',
      lease_token=NULL,lease_expires_at=NULL,
      history=history || jsonb_build_array(jsonb_build_object('ts',now(),'event','abandoned_lease'))
    WHERE (p_user IS NULL OR user_id=p_user) AND status='retrying' AND lease_expires_at<=now() RETURNING user_id
  ) UPDATE public.retry_controls SET paused=true,pause_reason='abandoned_lease',updated_at=now()
    WHERE user_id IN(SELECT user_id FROM abandoned);
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.retry_recover_leases(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retry_recover_leases(uuid) TO authenticated,service_role;

CREATE FUNCTION public.retry_resume(p_user uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public.retry_assert_user(p_user);
  IF EXISTS(SELECT 1 FROM public.retry_packet_leases WHERE user_id=p_user) THEN RAISE EXCEPTION 'Inspect outstanding packet leases before resuming'; END IF;
  UPDATE public.retry_controls SET paused=false,pause_reason=NULL,updated_at=now() WHERE user_id=p_user AND enabled;
  UPDATE public.ai_retry_queue SET status='queued',next_retry_at=now() WHERE user_id=p_user AND status IN('paused','quota_limited') AND retry_attempts<max_attempts;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.retry_resume(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retry_resume(uuid) TO authenticated,service_role;
```

## Complete rollback plan

**Not executed. Do not apply without separate authorization. The candidate migration has NOT been applied, so no database rollback is needed now.**

## Safe operational rollback after a future approved activation
1. Set both execution flags to false through the approved deployment process; stop new native scheduled events. This is a future procedure, not authorization.
2. Stop interactive repaired generation; wait for in-flight requests and 900-second queue leases to settle. Do not reset attempts or blindly replay unknown provider outcomes.
3. Export protected audit snapshots of queue rows, controls, usage reservations, packet locks, and usage logs using authorized private storage. Preserve history, counters, and generated artifacts; never put credentials or private exports in public files.
4. Restore the previously approved application artifact and its exact package/lockfile pair through the release system, not ad-hoc Git commands. Keep additive schema and records in place; old source does not require dropping them.
5. Reconcile outstanding packet locks and unknown outcomes manually before any future resume. Do not delete usage reservations to reclaim quota. Do not automatically restore the old HTTP heartbeat: it was unsafe and is currently active in production.
6. Read back queue fingerprints and attempts; verify signed-out protection and owner isolation. Record changes made by in-flight work separately.

## Optional schema withdrawal — only after backup, quiescence and explicit destructive-change approval
Preferred rollback is **retain additive schema**, with flags off. The following complete down SQL is a disposable-environment review script, not an automatically applied migration. Dropping audit tables/columns loses metadata; it must not run against production under current restrictions. No CASCADE; unexpected dependencies must stop the rollback. Existing queue rows, retry_attempts, history, status, and next_retry_at are not updated. There are no replacements of existing functions to restore.

```sql
BEGIN;
DROP FUNCTION public.retry_resume(uuid);
DROP FUNCTION public.retry_recover_leases(uuid);
DROP FUNCTION public.retry_finish(uuid,uuid,uuid,jsonb);
DROP FUNCTION public.retry_claim(uuid,uuid,integer,integer);
DROP FUNCTION public.retry_packet_unlock(uuid,uuid,uuid);
DROP FUNCTION public.retry_packet_lock(uuid,uuid,uuid);
DROP FUNCTION public.retry_finish_usage(uuid,uuid,jsonb);
DROP FUNCTION public.retry_reserve_usage(uuid,uuid);
DROP FUNCTION public.retry_assert_user(uuid);
ALTER TABLE public.ai_retry_queue
  DROP COLUMN lease_token,
  DROP COLUMN lease_expires_at,
  DROP COLUMN started_at,
  DROP COLUMN duration_ms,
  DROP COLUMN estimated_cost_cents;
DROP TABLE public.retry_packet_leases;
DROP TABLE public.retry_usage_reservations;
DROP TABLE public.retry_controls;
COMMIT;
```

This optional down script has not been executed or validated as a production rollback. Rollback of partial SQL application should be transaction-level, not guesswork; application tooling manages migration transactions. Active cron registration is a separate resource and is not changed by this SQL. Do not deactivate or restore production schedules without separate approval.


## Stop / approval boundary
**STOPPED at verification/reporting.** No deployment, migration application, generation/provider execution, queue-processing call, attempt reset or scheduler activation occurred in Step 315B. Production configuration was not changed. All 25 records still exist with zero attempts, but existing production heartbeat changed history; unchanged-data confirmation is explicitly withheld. New native scheduler remains unactivated by this work; total production scheduling is not inactive. Resolve security/audit/build/legacy-heartbeat blockers through separately authorized work, not by quietly changing flags, records or schedules.

## Step 315C — Production schedule and queue integrity investigation (read-only, 2026-11-12 13:39 UTC)

### Active schedules
| ID | Name | Frequency | Active | Target | Credentials |
|---|---|---|---|---|---|
| 1 | `ai-retry-queue-heartbeat` | `*/15 * * * *` | yes | published app `/api/public/hooks/retry-queue` (stable production URL) | header token stored in job command — referenced only, not exposed |

- Execution history: 15,607 recorded runs; last run 2026-11-12 13:30:00 UTC, status `succeeded`.
- No other database schedules exist. The Step 315 native Worker cron is **not** in active `wrangler.jsonc` (only in `docs/retry-repair/wrangler.review.jsonc`). External/third-party schedulers could not be inventoried from this workspace.

### Which schedule modified the 25 records
Job 1. The published (pre-Step-315) app still serves the old mutating heartbeat; the 410 retirement exists only in preview source and is not deployed. Observed earlier: 07:00 run appended history to 22 records, 06:30 to two, 06:00 to one.

### Fields changed
- `history` (appended entries; current length 874–880 per record), `updated_at` (latest 2026-11-12 13:00:07 UTC), and heartbeat-driven `next_retry_at`/`retry_status`/`last_retry_at` nudges.
- **Unchanged:** row count 25, `retry_attempts` sum 0, `max_attempts`, `kind`, `job_id`, `user_id`.

### Backups / audit comparison
No point-in-time backup, row-level audit trigger, or pre-change snapshot of `ai_retry_queue` is accessible from this workspace. Comparison is limited to the in-row `history` array and cron run records. History is growing roughly every 15 minutes, so the "unchanged history" requirement is being violated by the live legacy job, not by Step 315 code.

### Security blockers by severity
- **High:** live legacy heartbeat endpoint on production mutates queue rows and is reachable via `/api/public/*`; protection depends solely on a shared header token.
- **High:** unbounded `history` growth (~96 entries/day/record) — storage and readability risk.
- **Medium:** quota/usage evidence rows are user-writable under current RLS, so limit evidence is not tamper-proof until the staged reservation tables are applied.
- **Medium:** staged migration not applied; atomic reservations/fenced claims are not active in production.
- **Low:** `is_admin` security-definer warning (accepted, documented); full-project lint debt.

### Why the production build cannot be independently verified
Workspace rules forbid manually running project builds/typechecks; only automatic preview validation is available (build OK). No isolated deployed environment exists to run a scheduled Worker dry-run, and deploying is prohibited in this step.

### Could new and legacy schedulers run simultaneously?
**Yes, if activated as-is.** Job 1 is independent of the Worker cron. If the review cron were enabled without first disabling job 1 and deploying the 410 endpoint, both would act every 15 minutes: the legacy job would rewrite `next_retry_at`/history while the new processor claims rows, defeating lease fencing assumptions. Required order before activation: (1) deploy retired endpoint, (2) unschedule job 1, (3) apply migration, (4) enable flags + cron.

### Restrictions honored
No schedules modified, no queue writes, no attempts reset, no retries executed, no deploy, no migrations, no automation activated.
