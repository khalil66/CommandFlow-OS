# Step 315 exact change plan and review boundaries

The referenced 314AV–314AW audit documents are not present in the project, uploads, or accessible conversation history. The uploaded Step 315 specification and inspected implementation are used; audit reconciliation remains a review blocker.

## Stage 1: server boundaries
- `src/lib/resume.functions.ts`: authenticated wrapper around extracted server helper.
- `src/lib/resume-generation.server.ts`: shared resume/cover generation with validated owner and arguments.
- `src/lib/packet.functions.ts`: authenticated wrappers only.
- `src/lib/packet-generation.server.ts`: shared generation, persisted interview preparation, read-back checks and cache reuse.
- `src/lib/packet-quality.ts`, `src/lib/generation-contracts.ts`: browser-safe scoring and validated contracts.
- `src/lib/smart-apply.functions.ts`: direct internal helper rather than nested RPC.

## Stage 2: staged additive schema
- `docs/retry-repair/review-migration.sql`: unapplied production migration candidate; adds usage reservations, owner controls, packet locks, queue lease/duration/cost columns, owner-authorized RPCs for reserve/finish/claim/recover/resume.
- Never put this SQL in automatically applied migration paths or call live migration tools before approval. Local disposable PostgreSQL validation only.
- Daily limits remain 25 resumes and 25 covers per UTC day. Uncertain/failed provider attempts consume a reservation conservatively; recorded successful generations are not double counted.

## Stage 3: bounded execution and monitoring
- `src/lib/retry-policy.ts`, `src/lib/retry-database.server.ts`, `src/lib/retry-processor.server.ts`, `src/lib/retry-scheduled.server.ts`.
- `src/lib/retry-queue.functions.ts`, `src/routes/ai-queue.tsx`: authenticated bounded retries, explicit resume, monitoring; no attempt reset, no automatic application submission.
- `src/server.ts`: native scheduled handler requires two off-by-default activation flags.
- `docs/retry-repair/wrangler.review.jsonc`: proposed 15-minute schedule only in an inactive review configuration, not the active `wrangler.jsonc`.
- Retire `src/routes/api/public/hooks/retry-queue.ts`: old unprotected mutating heartbeat becomes a non-mutating 410 response.

## Stage 4: checks and blockers
- Add local SQL concurrency/auth/limit/fencing/recovery tests and fake-provider orchestration tests.
- Existing preview type error in optional `/resume-diff` search parameters requires a minimal type-only correction.
- Inspect and supply unique leaf metadata required by the platform without redesigning pages.
- Package security update is mandatory; preserve every unrelated dependency and behavior.
- No production deployment, live migration, cron activation, or processing of the 25 existing queue records.
