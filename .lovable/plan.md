# Smart Apply — Final Optimization Upgrades

A focused, non-destructive expansion of the existing Smart Apply pipeline. No
auto-submit, no browser automation, no CAPTCHA/MFA bypass. Auto Review cap stays
at 5/day. Manual override stays available everywhere.

## 1. Schema additions (one migration)

New columns / tables to support ranking, A/B testing, follow-ups, QC, and
learning reports:

- `job_sources`: add `response_count`, `interview_count`, `rejection_count`,
  `safety_block_count`, `high_prob_count`, `quality_score_avg`,
  `priority_score` (computed at run-time), `last_quality_recalc_at`.
- `resume_versions`: add `variant_key` (text: `data_analyst | operations |
  customer_success | product_ops | generic`), `is_template` (bool).
- `applications`: add `resume_variant_key`, `response_received_at`,
  `interview_requested_at`, `rejected_at`, `ghosted_at`, `offer_at`,
  `qc_passed` (bool), `qc_failures` (text[]), `freshness_bucket` (text).
- `job_listings`: add `freshness_bucket` (text: `0-3 | 4-7 | 8-14 | stale`)
  populated at ingest + on read.
- New table `follow_up_tasks`:
  `id, user_id, application_id, job_id, kind (followup_5d | followup_10d |
  linkedin_connect), due_at, status (pending | done | dismissed),
  completed_at, created_at`. RLS owner-only.
- New table `interview_prep`:
  `id, user_id, application_id, job_id, brief jsonb, generated_at`.
  RLS owner-only. (Reuses existing `interview_briefs` if compatible — check.)
- New table `weekly_learning_reports`:
  `id, user_id, week_start, week_end, payload jsonb, recommendations text[],
  created_at`. RLS owner-only.

## 2. Source ranking (`src/lib/source-ranking.ts` + serverFn)

- Aggregate per-source metrics from `applications`, `automation_safety_logs`,
  `job_listings`.
- `priority_score = response_rate*40 + interview_rate*30 + quality_avg*0.2 -
  safety_block_rate*30 - rejection_rate*10`.
- `recomputeSourcePriority` serverFn — called nightly + at start of each
  Smart Apply run. Persists `priority_score` on `job_sources`.
- Smart Apply ingest loop already iterates sources; sort by `priority_score
  desc` before iterating, and skip sources whose `safety_block_rate > 0.2`.

## 3. Resume A/B testing

- Seed 4 variant templates in `resume_versions` with `is_template=true` and
  `variant_key` set per category (one-time seed serverFn).
- `assignResumeVariant(role_category)` helper picks the right template.
- `tailorResume` accepts `variant_key`, persists it on the new resume row.
- `applications.resume_variant_key` populated when packet generated.
- Analytics route gets a "Response rate by resume variant" card driven by a
  `getResumeVariantStats` serverFn.

## 4. Job freshness priority

- `computeFreshnessBucket(posted_at)` utility (0-3 / 4-7 / 8-14 / stale).
- Ingest sets `freshness_bucket`; jobs with `stale` are auto-rejected at
  ingest (matches existing 14-day gate, just makes it explicit).
- Queue / Review / Smart Apply rows get a `<FreshnessBadge>` component.
- Auto Review scoring already enforces ≤14d; adds a small bonus for 0–3d.

## 5. Follow-up scheduling

- When an application transitions to `submitted` (manual mark), a serverFn
  `scheduleFollowUps(application_id)` inserts three `follow_up_tasks` rows:
  +5d, +10d, +3d LinkedIn connect.
- `Follow-Ups` route lists `follow_up_tasks` ordered by `due_at`, with
  Mark-Done / Dismiss / Snooze buttons.
- Dashboard "Follow-Ups Scheduled" card counts pending tasks due within 7d.

## 6. Final QC gate (auto review)

- New `src/lib/qc-gate.ts` `runFinalQC(packet)` returns `{ passed, failures[]
  }` with checks for: no fabricated metrics (cross-check vs KHALIL_PROOF),
  no keyword stuffing (>15% repetition), company/title/salary/ATS/portfolio
  presence, resume_id + cover_id non-null.
- Smart Apply `auto` decision now requires `qc_passed === true`. Failures
  push the application to `manual_review` with `qc_failures` populated and
  surface in Review UI.

## 7. Interview prep automation

- Trigger: when `applications.status` changes to `interview_requested`
  (handled in `decideApplication` + a new `markInterviewRequested` serverFn).
- Calls existing OpenAI prep logic (already in `packet.functions.ts`) +
  expands to include 60-second pitch and salary talking points; persists to
  `interview_prep` (or extended `interview_briefs`).
- Interview prep visible on the packet page + linked from dashboard.

## 8. Weekly learning report

- `generateWeeklyLearningReport` serverFn (extends existing
  `weekly-report.functions.ts`): aggregates the last 7d into a
  `weekly_learning_reports` row with best role category, best variant,
  best company type, best/worst source, avg interview prob, response rate,
  and a `recommendations[]` array.
- pg_cron Sunday 09:00 → `/api/public/hooks/weekly-report` route that runs
  the report for every user with `sms_enabled=true` and optionally SMS-es
  the headline. (Cron is optional polish; serverFn is callable from UI too.)

## 9. Dashboard updates

`src/routes/index.tsx` gets six new cards driven by one `getDashboardSummary`
serverFn:
- Best Source This Week
- Best Resume Version
- Fresh Jobs 0–3 Days
- Follow-Ups Scheduled
- Interviews Requested
- Weekly Recommendation (latest row from `weekly_learning_reports`)

## 10. Guardrails preserved

- `application_mode='auto_review'` remains capped at `auto_review_daily_cap=5`.
- No `submitted_at` is ever auto-set.
- No browser automation code paths added.
- Safety-block fallback + manual override unchanged.

---

## Build order

1. Migration (schema for all features).
2. Utilities (`source-ranking.ts`, `qc-gate.ts`, freshness helper, variant
   assignment).
3. ServerFns: `recomputeSourcePriority`, `scheduleFollowUps`,
   `markInterviewRequested`, `generateWeeklyLearningReport`,
   `getDashboardSummary`, `getResumeVariantStats`, resume variant seed.
4. Wire into existing pipeline: ingest sets freshness, source ranking gates
   ingest order, packet generation runs QC + assigns variant, decision flow
   schedules follow-ups + triggers prep.
5. UI: FreshnessBadge, Follow-Ups page, Analytics resume-variant card,
   Dashboard six new cards.
6. Optional cron route for weekly report.

Estimated touch: 1 migration + ~6 new files + edits to ~8 existing files.
