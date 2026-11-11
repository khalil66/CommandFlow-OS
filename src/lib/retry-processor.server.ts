import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { generatePacketCore } from "./packet-generation.server";
import { claimRetries, retryDb } from "./retry-database.server";
import { RETRY_BATCH_SIZE, retryDueAt, retryFailure } from "./retry-policy";

export async function processRetries(client: SupabaseClient<Database>, userId: string | null, queueId: string | null = null) {
  if (process.env["RETRY_REPAIR_ENABLED"] !== "true") {
    return { ok: false, status: "paused", reason: "Awaiting implementation review and activation approval", processed: 0, succeeded: 0, failed: 0 };
  }
  const recovery = await retryDb(client).rpc("retry_recover_leases", { p_user: userId });
  if (recovery.error) throw new Error("Lease recovery unavailable; no jobs processed");
  // Claim just one at a time: a quota/denial pauses before another row is claimed.
  let processed = 0, succeeded = 0, failed = 0;
  let lastReason: string | undefined;
  for (let index = 0; index < (queueId ? 1 : RETRY_BATCH_SIZE); index++) {
    const [row] = await claimRetries(client, userId, queueId, 1);
    if (!row) break;
    let result;
    try {
      await generatePacketCore(client, row.user_id, row.job_id);
      result = { success: true, status: "completed", code: "success" };
    } catch (error) {
      const failure = retryFailure(error);
      lastReason = failure.code;
      const next = failure.code === "daily_limit"
        ? new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1)).toISOString()
        : retryDueAt(row.retry_attempts);
      result = { success: false, ...failure, next_retry_at: next };
    }
    const finish = await retryDb(client).rpc("retry_finish", {
      p_user: row.user_id, p_id: row.id, p_token: row.lease_token, p_result: result,
    });
    if (finish.error || !finish.data) throw new Error("Retry lease completion not confirmed; review required");
    processed++;
    if (result.success) succeeded++; else failed++;
    if (!result.success) break;
  }
  return { ok: failed === 0 && processed > 0, status: processed === 0 ? "not_due" : failed ? "queued" : "completed", reason: lastReason ?? (processed === 0 ? "No due eligible jobs; queue may be paused" : undefined), processed, succeeded, failed };
}
