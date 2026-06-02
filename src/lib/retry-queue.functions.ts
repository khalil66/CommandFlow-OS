import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generatePacketCore } from "./packet.functions";
import { QuotaExhaustedError, RateLimitExhaustedError } from "./openai-fetch";

const RETRY_DELAYS_MIN = [15, 30, 45, 60, 120]; // backoff per attempt

function nextRetryFor(attempt: number): Date {
  const minutes = RETRY_DELAYS_MIN[Math.min(attempt, RETRY_DELAYS_MIN.length - 1)];
  return new Date(Date.now() + minutes * 60_000);
}

/** Internal helper — used both by smart-apply and the public cron route. */
export async function enqueueRetryRow(
  supabase: any,
  userId: string,
  args: { job_id: string; reason: string; status?: "queued" | "quota_limited"; kind?: string; max_attempts?: number },
) {
  const status = args.status ?? "queued";
  const kind = args.kind ?? "packet";
  const next = nextRetryFor(0);
  const { data: existing } = await supabase
    .from("ai_retry_queue")
    .select("id, retry_attempts, history")
    .eq("user_id", userId).eq("job_id", args.job_id).eq("kind", kind)
    .maybeSingle();
  if (existing) {
    // Re-arm an existing row; do not reset attempts
    await supabase.from("ai_retry_queue").update({
      status, retry_reason: args.reason, next_retry_at: next.toISOString(),
      retry_status: "rearmed",
    }).eq("id", existing.id);
    return existing.id;
  }
  const { data: inserted } = await supabase.from("ai_retry_queue").insert({
    user_id: userId, job_id: args.job_id, kind, status,
    retry_reason: args.reason, next_retry_at: next.toISOString(),
    max_attempts: args.max_attempts ?? 5,
    history: [{ ts: new Date().toISOString(), event: "enqueued", reason: args.reason }],
  }).select("id").single();
  return inserted?.id;
}

export const enqueueRetry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    job_id: z.string().uuid(),
    reason: z.string().min(1).max(500),
    status: z.enum(["queued", "quota_limited"]).optional(),
  }).parse(d))
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
      .select(`id, job_id, kind, status, retry_attempts, max_attempts,
               next_retry_at, last_retry_at, retry_reason, retry_status, last_error,
               history, created_at, updated_at,
               job_listings (id, title, company_name, ats)`)
      .eq("user_id", userId)
      .order("next_retry_at", { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);
    return { items: data ?? [] };
  });

export const getRetryQueueMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase.from("ai_retry_queue")
      .select("status, next_retry_at, retry_attempts, max_attempts")
      .eq("user_id", userId);
    const rows = data ?? [];
    const by = (s: string) => rows.filter((r: any) => r.status === s).length;
    const queued = by("queued");
    const retrying = by("retrying");
    const completed = by("completed");
    const failed = by("failed");
    const quotaLimited = by("quota_limited");
    const now = Date.now();
    const due = rows.filter((r: any) =>
      (r.status === "queued" || r.status === "quota_limited") &&
      new Date(r.next_retry_at).getTime() <= now).length;
    const nearMax = rows.filter((r: any) => r.retry_attempts >= r.max_attempts - 1).length;

    let health: "healthy" | "throttled" | "quota_limited" | "paused" = "healthy";
    if (quotaLimited > 0) health = "quota_limited";
    else if (retrying > 0 || due >= 5) health = "throttled";
    if (queued + retrying + quotaLimited === 0 && completed + failed > 0) health = "healthy";

    return {
      queued, retrying, completed, failed,
      quota_limited: quotaLimited,
      due_now: due,
      near_max: nearMax,
      total: rows.length,
      health,
    };
  });

async function attemptRetry(supabase: any, userId: string, queueId: string) {
  const { data: row } = await supabase.from("ai_retry_queue")
    .select("*").eq("id", queueId).eq("user_id", userId).maybeSingle();
  if (!row) throw new Error("Queue item not found");
  if (row.status === "completed") return { ok: true, status: "completed", row };
  if (row.retry_attempts >= row.max_attempts) {
    await supabase.from("ai_retry_queue").update({
      status: "failed", retry_status: "max_attempts_reached",
      history: [...(row.history ?? []), {
        ts: new Date().toISOString(), event: "max_attempts", attempt: row.retry_attempts,
      }],
    }).eq("id", queueId);
    return { ok: false, status: "failed", reason: "max_attempts_reached" };
  }
  const attempt = row.retry_attempts + 1;
  const startedAt = Date.now();
  await supabase.from("ai_retry_queue").update({
    status: "retrying", last_retry_at: new Date().toISOString(),
    retry_status: "in_progress",
  }).eq("id", queueId);
  try {
    await generatePacketCore(supabase, userId, row.job_id);
    const elapsed = Date.now() - startedAt;
    await supabase.from("ai_retry_queue").update({
      status: "completed", retry_attempts: attempt,
      retry_status: "success", last_error: null,
      history: [...(row.history ?? []), {
        ts: new Date().toISOString(), event: "success", attempt, duration_ms: elapsed,
      }],
    }).eq("id", queueId);
    return { ok: true, status: "completed" };
  } catch (e: any) {
    const elapsed = Date.now() - startedAt;
    const isQuota = e instanceof QuotaExhaustedError;
    const isRate = e instanceof RateLimitExhaustedError;
    const errCode = isQuota ? "quota_exhausted" : isRate ? "rate_limit" : "error";
    const message = (e?.message ?? String(e)).slice(0, 400);
    const reachedMax = attempt >= row.max_attempts;
    const next = reachedMax ? null : nextRetryFor(attempt);
    await supabase.from("ai_retry_queue").update({
      status: reachedMax ? "failed" : (isQuota ? "quota_limited" : "queued"),
      retry_attempts: attempt,
      retry_status: errCode,
      last_error: message,
      next_retry_at: next ? next.toISOString() : row.next_retry_at,
      history: [...(row.history ?? []), {
        ts: new Date().toISOString(), event: errCode, attempt,
        duration_ms: elapsed, error: message,
        ...(next ? { next_retry_at: next.toISOString() } : {}),
      }],
    }).eq("id", queueId);
    return { ok: false, status: reachedMax ? "failed" : "queued", reason: errCode };
  }
}

export const retryQueueItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    return attemptRetry(context.supabase, context.userId, data.id);
  });

export const retryAllQueued = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: rows } = await supabase.from("ai_retry_queue")
      .select("id, status, next_retry_at")
      .eq("user_id", userId)
      .in("status", ["queued", "quota_limited"]);
    const all = rows ?? [];
    let succeeded = 0, failed = 0;
    for (const r of all) {
      const res = await attemptRetry(supabase, userId, r.id);
      if (res.ok) succeeded++; else failed++;
    }
    return { ok: true, processed: all.length, succeeded, failed };
  });

export const removeQueueItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await supabase.from("ai_retry_queue").delete()
      .eq("id", data.id).eq("user_id", userId);
    return { ok: true };
  });
