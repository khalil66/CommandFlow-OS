import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Heartbeat for the AI retry queue. Runs every 15 minutes via pg_cron.
 *
 * Responsibilities:
 *  - Mark queued / quota_limited rows as "due" by leaving them with
 *    next_retry_at <= now() so the dashboard / Smart Apply runs pick them up.
 *  - Push retry_attempts forward on rows that have been overdue for >2h
 *    without progress, eventually transitioning to status='failed' once
 *    max_attempts is reached.
 *
 * Actual AI execution still happens through authenticated paths (dashboard
 * "Retry Now", "Retry All", or the next Smart Apply run) because the OpenAI
 * call chain reads per-user secrets and usage caps from the auth context.
 */
export const Route = createFileRoute("/api/public/hooks/retry-queue")({
  server: {
    handlers: {
      POST: async () => {
        const startedAt = Date.now();
        const nowIso = new Date().toISOString();
        const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000).toISOString();

        // 1. Mark rows that have exceeded max_attempts as failed.
        const { data: stuck } = await supabaseAdmin
          .from("ai_retry_queue")
          .select("id, user_id, history, retry_attempts, max_attempts")
          .in("status", ["queued", "quota_limited", "retrying"])
          .lte("next_retry_at", twoHoursAgo);

        let nudged = 0, failed = 0;
        for (const r of stuck ?? []) {
          if (r.retry_attempts >= r.max_attempts) {
            await supabaseAdmin.from("ai_retry_queue").update({
              status: "failed", retry_status: "max_attempts_reached",
              history: [...(r.history ?? []), {
                ts: nowIso, event: "cron_max_attempts", attempt: r.retry_attempts,
              }],
            }).eq("id", r.id);
            failed++;
          } else {
            // Push next_retry_at forward by 15min and log a cron heartbeat.
            const next = new Date(Date.now() + 15 * 60_000).toISOString();
            await supabaseAdmin.from("ai_retry_queue").update({
              next_retry_at: next, retry_status: "cron_nudged",
              history: [...(r.history ?? []), {
                ts: nowIso, event: "cron_nudge",
                attempt: r.retry_attempts, next_retry_at: next,
              }],
            }).eq("id", r.id);
            nudged++;
          }
        }

        const { count: totalQueued } = await supabaseAdmin
          .from("ai_retry_queue")
          .select("*", { count: "exact", head: true })
          .in("status", ["queued", "quota_limited"]);

        const result = {
          ok: true,
          checked_at: nowIso,
          scanned: stuck?.length ?? 0,
          nudged, failed,
          total_queued: totalQueued ?? 0,
          duration_ms: Date.now() - startedAt,
        };
        console.log("[retry-queue-cron]", JSON.stringify(result));
        return new Response(JSON.stringify(result), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
