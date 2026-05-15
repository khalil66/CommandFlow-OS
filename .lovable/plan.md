# Daily Verified Remote Hiring Engine — Build Plan

A focused upgrade in 6 layers. Browser automation stays disabled; everything ships in Manual Review mode.

## 1. Database (one migration)

Add columns + tables to support trust scoring, daily batches, interview probability, and follow-ups.

- `companies` — add: `trust_score int`, `verification_status` enum (`verified|manual_review|rejected`), `is_remote_first bool`, `hiring_activity int`, `mba_friendly bool`, `category` enum (`saas|data|cs_ops|product_pm|remote_first|mba_friendly|other`), `funding_stage text`, `careers_url text`, `linkedin_url text`, `red_flags text[]`, `last_applied_at timestamptz`.
- `job_listings` — add: `category` (same enum), `interview_probability int`, `role_category text`, `ready_to_apply bool default false`, `salary_estimated bool`, `posted_at timestamptz`, `dedupe_hash text` (unique per user).
- `applications` — add: `priority` enum (`high|good|manual|skip`), `follow_up_due_at timestamptz`, `portfolio_project text`.
- New table `daily_batches` — `id, user_id, batch_date date, day_of_week text, category text, companies_reviewed int, jobs_found int, jobs_rejected int, applications_prepared int, applications_approved int, applications_submitted int, interview_responses int, status (running|complete), summary jsonb`.
- New table `verification_checks` — `id, user_id, company_id, has_official_site bool, has_careers_page bool, has_linkedin bool, ats_domain_match bool, business_footprint_score int, news_signals_count int, scam_flags text[], personal_email_domain bool, payment_request bool, score int, decision text, raw jsonb`.
- Indexes on `(user_id, last_applied_at)` and unique `(user_id, dedupe_hash)`.

## 2. Server functions (new file `src/lib/engine.functions.ts`)

All gated by `requireSupabaseAuth`. No browser automation.

- `verifyCompany({ name, domain, careers_url?, linkedin_url? })` — runs the trust scoring rubric (deterministic, no external calls in MVP — uses heuristics + fields user provides + scam/red-flag word list). Returns trust score 0–100, decision (verified/manual_review/reject), red flags. Persists to `verification_checks` and updates `companies.trust_score` + `verification_status`.
- `scoreInterviewProbability({ job_id })` — computes 0–100 from the 11 factors listed (resume_match, skills_match, salary_fit, experience_fit, remote_fit, education_fit, mba_relevance, portfolio_relevance, profile_strength, hiring_activity, ats_compat). Returns breakdown + total + priority bucket. Updates job row.
- `runDailyBatch()` — picks today's category by weekday, pulls candidate companies in that category (or seeds them), runs verifyCompany on each, generates job stubs that meet salary + remote + ATS + dedupe rules, runs scoreInterviewProbability per job, marks Ready-to-Apply when all gates pass (trust 90+, prob 85+, salary > $55k, remote, supported ATS), writes a `daily_batches` row, returns counts.
- `getDailyMetrics({ date? })` — aggregates today's batch + roll-up stats for the dashboard cards.
- `listHighProbabilityJobs()` — `interview_probability >= 85 AND ready_to_apply = true`.
- `markFollowUpDue({ application_id, days })` and `listFollowUpsDue()`.
- `getPortfolioProjects({ role_category })` — server-side mapping table from role → 1-2 portfolio projects from khalilhickson.com.

Resume tailoring (`tailorResume`) is extended to:
- pull job's keywords + role category, reuse the verified proof points (10,000+ tickets, 25% escalation reduction, 91% CSAT, 35% efficiency, 50k+ transactions, $1.2M revenue analysis, 24h avg resolution, 92% SLA, forecasting 92% accuracy)
- inject portfolio project + LinkedIn + website
- tag the saved `resume_versions` row with `target_role` so the analytics view can roll up best-performing versions

## 3. Seed data overhaul

Replace `seed.functions.ts` payload with ~30 real-name companies pre-tagged across the 7 categories (Linear, Vercel, Stripe, Notion, Zapier, GitLab, Cloudflare, Datadog, Sentry, Twilio, Asana, Snowflake, Databricks, Mixpanel, Amplitude, PostHog, Retool, Plaid, Brex, Ramp, Mercury, Segment, Loom, HashiCorp, Figma, ClickUp, Monday, Airtable, Greenhouse, Lever) with `category`, `is_remote_first`, `mba_friendly`, `linkedin_url`, `careers_url`. Pre-seed each with a `verification_checks` row so trust scores exist out of the box.

## 4. UI — new + reworked routes

- `src/routes/index.tsx` (Dashboard) — add a top section with the 7 metric cards: Daily Batch Complete, Verified Companies, High-Probability Jobs, Avg Interview Probability, Avg Company Trust Score, Resume Match Score, Follow-ups Due. Add "Run today's batch" button.
- `src/routes/queue.tsx` — split into 3 tabs: **High-Probability Applications** (Ready-to-Apply only), **All Jobs**, **Daily Batch**. Each row shows trust score + interview probability + priority chip.
- `src/routes/companies.tsx` (NEW) — list companies with trust score, verification status, last_applied_at, category. Re-verify button.
- `src/routes/batches.tsx` (NEW) — daily batch history with per-day metrics + the "rotate by weekday" schedule visible.
- `src/routes/analytics.tsx` — add charts for: best-performing resume version, best role category, best company type, applications-by-priority funnel.
- `src/components/app-sidebar.tsx` — add "Companies" and "Daily Batches" links.

## 5. Supporting libraries

- `src/lib/scoring.ts` — pure functions for trust score and interview probability (so the same math is reusable + easy to unit-test mentally).
- `src/lib/portfolio.ts` — Khalil's portfolio project map keyed by role_category.
- `src/lib/scam-signals.ts` — word lists for scam-language detection (payment requests, crypto, training fees, equipment purchases, personal email domains).

## 6. Safety + behavior guarantees

- Default `applications.status` stays `manual_review`. No auto-submit anywhere in the codebase.
- "High-Probability Applications" view is read-only beyond the existing Approve / Reject / Export buttons.
- 30-day reapply guard enforced inside `runDailyBatch` (skips companies whose `last_applied_at` is within 30 days).
- All toasts + loading + empty + error states preserved.

---

## Out of scope (not in this turn)

- Real web crawling / Firecrawl wiring for verification (heuristic only — wiring noted as a future step).
- Email/calendar follow-up reminders (we record the due date, but no notifications).
- Browser automation / auto-submit.

Once approved, I'll ship the migration first, then the server functions + UI in one batch.
