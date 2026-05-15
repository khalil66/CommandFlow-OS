# Productivity + Recruiting Intelligence Upgrades

Large scope — phased delivery. All safety rules preserved (no CAPTCHA/MFA/login bypass, no auto-submit, no browser automation, Safety Block + Manual Review fallback, Auto Review cap 5/day).

## Phase 1 — Core CRM + Intelligence (ship first)
1. **Interview CRM Pipeline** (`/pipeline`)
   - Extend `application_status` enum: `imported, reviewed, approved, submitted_manual, recruiter_screen, technical_interview, final_interview, offer, rejected, archived`
   - New columns on `applications`: `recruiter_notes`, `interview_notes`, `salary_expectation`, `next_action_at`, `next_action_label`, plus stage timestamps (`reviewed_at`, `approved_at`, `submitted_manual_at`, `recruiter_screen_at`, `technical_interview_at`, `final_interview_at`, `archived_at` — reuse existing `offer_at`, `rejected_at`)
   - Kanban board with drag-and-drop (dnd-kit) → updates status + writes timestamp
   - Side panel: notes, salary expectation, next action reminder

2. **Recruiter Intelligence**
   - New table `recruiter_contacts` (name, title, company_id, email, response_count, avg_response_hours, last_contact_at)
   - Link from applications via `recruiter_contact_id`
   - Aggregate functions: `getRecruiterStats`, `getCompanyResponseStats`
   - Page `/recruiters` with response-rate / time-to-response leaderboard

3. **Optimization Dashboard cards** (extend dashboard)
   - Avg Time To Response, Best Recruiter Category, Best Application Window, Resume Variant Leader, Interview Conversion Rate, Offer Conversion Rate

4. **Recruiter Response Heatmap**
   - Day-of-week × hour-of-day heatmap of `response_received_at` and `interview_requested_at`
   - Component on `/analytics`

## Phase 2 — Resume + Company Intelligence
5. **Resume Diff Viewer** (`/resume/compare/$variantKey`)
   - Side-by-side master vs tailored using `diff` library
   - Highlight added ATS keywords + role-specific bullets

6. **Company Intelligence Enrichment**
   - Add columns to `companies`: `funding_stage` (already exists), `hiring_signals jsonb`, `remote_culture_score`, `growth_indicators jsonb`, `role_competitiveness` (1–100)
   - Enrichment serverFn using OpenAI with public-info placeholders only
   - Card on company detail page

## Phase 3 — Demo Mode + Reporting
7. **Demo Mode**
   - Toggle in settings → `user_settings.demo_mode boolean`
   - When on, all serverFns return curated mock data from `src/lib/demo-fixtures.ts`
   - Banner across app: "Demo Mode — no real data"
   - No real DB writes while enabled

8. **Weekly Executive PDF Report**
   - ServerFn `generateExecutivePdf` → returns base64 PDF using existing `pdf-export.ts` patterns + jsPDF
   - Sections: KPI cards, applications, interviews, response rates, best resume/company/ATS, weekly recommendations, charts (rendered as data tables in PDF)
   - "Download Executive Report" button on dashboard

## Phase 4 — Optional Google Integrations
9. **Google Calendar** (via Lovable connector `google_calendar`)
   - "Connect Google Calendar" CTA in Settings if `LOVABLE_API_KEY` + `GOOGLE_CALENDAR_API_KEY` not present
   - ServerFn `createCalendarReminder({ kind, when, application_id })` for interview/follow-up/prep
   - `.ics`-style links on interview prep page as fallback

10. **Gmail** (via Lovable connector `google_mail`, scope `gmail.readonly` + `gmail.modify`)
    - ServerFn `scanRecruiterInbox` — list recent threads matching recruiter heuristics, never sends
    - Auto-tag with Gmail label "Job-Search/Recruiter"
    - Extract recruiter/company → suggest CRM status update (user confirms)
    - Strict: no auto-send, no auto-reply

## Safety Layer (cross-cutting)
- Reuse existing `qc-gate.ts` + `automation_safety_logs`
- Add detector hooks in Smart Apply: CAPTCHA / MFA / login wall / bot warning / unsupported ATS / suspicious redirect → immediate Safety Block, no retry
- Manual Review override always available
- Auto Review cap 5/day enforced

## Database migrations needed
- `application_status` enum extension
- `applications` new columns
- New tables: `recruiter_contacts`
- `companies` new columns
- `user_settings.demo_mode`

## Out of scope (explicit non-goals)
- No CAPTCHA/MFA/login-wall bypass
- No browser automation, stealth, or evasion
- No auto-submit, no auto-reply, no auto-send email
- No real recruiter data in Demo Mode

## Recommended ship order
**This turn:** Phase 1 only (CRM Pipeline + Recruiter Intelligence + dashboard cards + heatmap). It's already ~6 files + 1 migration and gives the highest-value visible wins.
**Next turns:** Phase 2 → Phase 3 → Phase 4 (Google connectors require user OAuth approval per integration).
