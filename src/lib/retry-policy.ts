export const RETRY_BATCH_SIZE = 3;
export const RETRY_LEASE_SECONDS = 900;
export const DAILY_RESUME_LIMIT = 25;
export const DAILY_COVER_LIMIT = 25;
export const RETRY_DELAYS_MINUTES = [15, 30, 45, 60, 120];

export function retryDueAt(attempt: number, now = Date.now()) {
  const index = Math.min(Math.max(0, attempt), RETRY_DELAYS_MINUTES.length - 1);
  return new Date(now + RETRY_DELAYS_MINUTES[index] * 60000).toISOString();
}

export function retryFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "Packet generation failed";
  const status =
    typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
  const daily = message.includes("DAILY_LIMIT");
  const quota = message.includes("quota") || status === 402;
  const denied = status === 403 || /refusal|refused|denied/i.test(message);
  const rate = status === 429 || /rate.limit/i.test(message);
  // Unknown inference outcomes must not be replayed by a scheduler.
  const unknown = /network|timeout|fetch failed|lease|unknown|5\d\d/i.test(message);
  return {
    code: daily
      ? "daily_limit"
      : quota
        ? "quota_exhausted"
        : denied
          ? "provider_denied"
          : rate
            ? "rate_limit"
            : unknown
              ? "unknown_outcome"
              : "packet_failed",
    pause: quota || denied || unknown,
    status: quota || daily ? "quota_limited" : denied || unknown ? "paused" : "queued",
    message: message.slice(0, 400),
  };
}
