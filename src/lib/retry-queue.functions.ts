import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const RETRY_DELAYS_MIN = [15, 30, 45, 60, 120]; // backoff per attempt

function nextRetryFor(attempt: number): Date {
  const minutes = RETRY_DELAYS_MIN[Math.min(attempt, RETRY_DELAYS_MIN.length - 1)];
  return new Date(Date.now() + minutes * 60_000);
}

/** Internal helper — used both by smart-apply and the public cron route. */
export async function enqueueRetryRow(
  supabase: any,
  userId: string,
  args: {
    job_id: string;
    reason: string;
    status?: "queued" | "quota_limited";
    kind?: string;
    max_attempts?: number;
  },
) {
  const status = args.status ?? "queued";
  const kind = args.kind ?? "packet";
  const next = nextRetryFor(0);
  const { data: existing } = await supabase
    .from("ai_retry_queue")
    .select("id, status, retry_attempts, max_attempts, history")
    .eq("user_id", userId)
    .eq("job_id", args.job_id)
    .eq("kind", kind)
    .maybeSingle();
  if (existing) {
    if (
      ["completed", "retrying", "paused", "failed"].includes(existing.status) ||
      existing.retry_attempts >= existing.max_attempts
    )
      return existing.id;
    // Re-arm only eligible rows; do not reset attempts
    await supabase
      .from("ai_retry_queue")
      .update({
        status,
        retry_reason: args.reason,
        next_retry_at: next.toISOString(),
        retry_status: "rearmed",
      })
      .eq("id", existing.id);
    return existing.id;
  }
  const { data: inserted } = await supabase
    .from("ai_retry_queue")
    .insert({
      user_id: userId,
      job_id: args.job_id,
      kind,
      status,
      retry_reason: args.reason,
      next_retry_at: next.toISOString(),
      max_attempts: args.max_attempts ?? 5,
      history: [{ ts: new Date().toISOString(), event: "enqueued", reason: args.reason }],
    })
    .select("id")
    .single();
  return inserted?.id;
}

export const enqueueRetry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        job_id: z.string().uuid(),
        reason: z.string().min(1).max(500),
        status: z.enum(["queued", "quota_limited"]).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const id = await enqueueRetryRow(context.supabase, context.userId, data);
    return { ok: true, id };
  });

export const listRetryQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("ai_retry_queue")
      .select(
        `id, job_id, kind, status, retry_attempts, max_attempts,
               next_retry_at, last_retry_at, retry_reason, retry_status, last_error,
               history, created_at, updated_at`,
      )
      .eq("user_id", userId)
      .order("next_retry_at", { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    const jobIds = [...new Set(rows.map(row => row.job_id))];
    const { data: jobs, error: jobError } = jobIds.length
      ? await supabase.from("job_listings").select("id, title, company_name, ats")
          .eq("user_id", userId).in("id", jobIds)
      : { data: [], error: null };
    if (jobError) throw new Error(jobError.message);
    const byId = new Map((jobs ?? []).map(job => [job.id, job]));
    return { items: rows.map(row => ({ ...row, job_listings: byId.get(row.job_id) ?? null })) };
  });

export const getRetryQueueMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const repaired = process.env["RETRY_REPAIR_ENABLED"] === "true";
    const { data, error } = await supabase
      .from("ai_retry_queue")
      .select(
        repaired
          ? "status, next_retry_at, retry_attempts, max_attempts, duration_ms, estimated_cost_cents, lease_expires_at, retry_status"
          : "status, next_retry_at, retry_attempts, max_attempts",
      )
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as Array<{
      status: string;
      next_retry_at: string;
      retry_attempts: number;
      max_attempts: number;
      duration_ms?: number;
      estimated_cost_cents?: number;
      lease_expires_at?: string;
      retry_status?: string;
    }>;
    const by = (s: string) => rows.filter((r: any) => r.status === s).length;
    const queued = by("queued");
    const retrying = by("retrying");
    const completed = by("completed");
    const failed = by("failed");
    const quotaLimited = by("quota_limited");
    const now = Date.now();
    const due = rows.filter(
      (r: any) =>
        (r.status === "queued" || r.status === "quota_limited") &&
        new Date(r.next_retry_at).getTime() <= now,
    ).length;
    const nearMax = rows.filter((r: any) => r.retry_attempts >= r.max_attempts - 1).length;

    let health: "healthy" | "throttled" | "quota_limited" | "paused" = "healthy";
    if (quotaLimited > 0) health = "quota_limited";
    else if (retrying > 0 || due >= 5) health = "throttled";
    if (queued + retrying + quotaLimited === 0 && completed + failed > 0) health = "healthy";

    if (!repaired || by("paused") > 0) health = "paused";
    return {
      awaiting_approval: !repaired,
      paused: by("paused"),
      abandoned: rows.filter((r) => r.retry_status === "abandoned_lease").length,
      total_duration_ms: rows.reduce((sum, r) => sum + (r.duration_ms ?? 0), 0),
      total_cost_cents: rows.reduce((sum, r) => sum + Number(r.estimated_cost_cents ?? 0), 0),
      queued,
      retrying,
      completed,
      failed,
      quota_limited: quotaLimited,
      due_now: due,
      near_max: nearMax,
      total: rows.length,
      health,
    };
  });

export const retryQueueItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { processRetries } = await import("./retry-processor.server");
    return processRetries(context.supabase, context.userId, data.id);
  });

export const retryAllQueued = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { processRetries } = await import("./retry-processor.server");
    return processRetries(context.supabase, context.userId);
  });

export const removeQueueItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await supabase.from("ai_retry_queue").delete().eq("id", data.id).eq("user_id", userId);
    return { ok: true };
  });

export const resumeRetryQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (process.env["RETRY_REPAIR_ENABLED"] !== "true")
      throw new Error("Awaiting activation approval");
    const { retryDb } = await import("./retry-database.server");
    const { data, error } = await retryDb(context.supabase).rpc("retry_resume", {
      p_user: context.userId,
    });
    if (error || !data) throw new Error(error?.message ?? "Queue could not be resumed");
    return { ok: true };
  });
