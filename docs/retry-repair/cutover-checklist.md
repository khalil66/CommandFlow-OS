# Step 315D — Production Cutover Checklist (NOT EXECUTED)

Overall: **NO-GO** until every prerequisite below is signed off. Each box needs owner approval + evidence.

## 0. Prerequisites (all required before step 1)
- [ ] Production build verified (see §7 of review report): preview build OK + publish-time build log captured + post-publish smoke on endpoint.
- [ ] Security fixes S1–S3 staged into the migration (usage/queue tables made non-writable by users).
- [ ] Owner written approval for each numbered action.
- [ ] Maintenance window agreed; no Smart Apply runs during window.

## 1. Backup (read-only)
- [ ] Export: `COPY (SELECT * FROM ai_retry_queue ORDER BY id) TO STDOUT CSV HEADER` → `/mnt/documents/ai_retry_queue_pre_cutover_<ts>.csv`
- [ ] Integrity fingerprint, saved alongside:
  `SELECT count(*), sum(retry_attempts), md5(string_agg(id::text||retry_attempts||max_attempts||status||kind||job_id, ',' ORDER BY id)) AS core_hash, md5(string_agg(history::text, ',' ORDER BY id)) AS history_hash, max(updated_at) FROM ai_retry_queue;`
- [ ] Expect: count=25, sum(attempts)=0.
- [ ] Also export `openai_usage` for today (limit evidence).

## 2. Pause job 1 (database)  — prerequisite: §1 done
- [ ] Find: `SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname='ai-retry-queue-heartbeat';` (expect jobid 1, active true)
- [ ] Pause (reversible, preferred over unschedule): `SELECT cron.alter_job(1, active := false);` via the data-change tool (privileged role; app/psql role cannot touch `cron`).
- [ ] Verify: `SELECT active FROM cron.job WHERE jobid=1;` → false
- [ ] Do NOT re-enable as rollback.

## 3. Publish app (retires endpoint)  — prerequisite: §2 verified
- [ ] Publish current source; `/api/public/hooks/retry-queue` POST must return 410 with no writes.
- [ ] Smoke: one POST without credentials → 410; re-run fingerprint → identical.
- [ ] Confirm `RETRY_REPAIR_ENABLED` and `AUTONOMOUS_RETRY_ENABLED` unset/false in production.
- [ ] Confirm active `wrangler.jsonc` has no `triggers.crons`.

## 4. Apply staged migration  — prerequisite: §3 verified, S1–S3 included
- [ ] Apply `docs/retry-repair/review-migration.sql` (additive only).
- [ ] Verify tables/columns/functions exist; `has_function_privilege('anon', ...)` false for all `retry_*`.
- [ ] Fingerprint: core_hash and history_hash unchanged (new columns NULL/0).

## 5. Post-cutover proof job 1 no longer writes (T+0, +15, +30, +60 min)
- [ ] `SELECT max(start_time), status FROM cron.job_run_details WHERE jobid=1 AND start_time > '<pause_ts>';` → no rows
- [ ] Fingerprint history_hash and max(updated_at) unchanged at each check.
- [ ] `SELECT count(*) FROM ai_retry_queue WHERE updated_at > '<pause_ts>';` → 0

## 6. Unschedule job 1 permanently — prerequisite: 24h clean §5
- [ ] `SELECT cron.unschedule(1);` then verify absent from `cron.job`.

## 7. Replacement scheduler — SEPARATE APPROVAL, out of scope
- [ ] Remains disabled: flags off, no cron trigger, records unprocessed.

## Rollback (never re-enables heartbeat)
- App: republish previous build only if it is the 410 version; otherwise keep current. Never restore the mutating endpoint.
- DB: keep job 1 paused/unscheduled. Migration rollback = leave additive objects (unused); optional drop only with backup + destructive approval (see report).
- Data: if fingerprint diverges, stop; compare with CSV backup; restoration requires separate approval.
