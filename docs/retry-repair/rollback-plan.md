# Step 315B review-only rollback plan

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
