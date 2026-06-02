/**
 * Throttled + retrying OpenAI fetch helper.
 *
 * - Global concurrency cap (default 1, max 2) so bulk jobs never fan-out.
 * - Minimum gap between requests (default 1.8s) to avoid TPM bursts.
 * - Exponential backoff with jitter on 429 and 5xx (1s, 2s, 4s, 8s, 16s).
 * - Respects the Retry-After header when present.
 * - Throws a typed RateLimitExhaustedError after retries are exhausted so
 *   callers can route jobs to a queued/needs-review state instead of failing.
 *
 * IMPORTANT: this is per-Worker-instance state — Cloudflare may spin up
 * additional instances under load. That is acceptable here; the goal is to
 * smooth the common-case bulk run, not to enforce a hard global limit.
 */

export class RateLimitExhaustedError extends Error {
  code = "rate_limit_exhausted" as const;
  status: number;
  attempts: number;
  retryAfterMs: number | null;
  constructor(message: string, status: number, attempts: number, retryAfterMs: number | null) {
    super(message);
    this.name = "RateLimitExhaustedError";
    this.status = status;
    this.attempts = attempts;
    this.retryAfterMs = retryAfterMs;
  }
}

export class QuotaExhaustedError extends Error {
  code = "quota_exhausted" as const;
  status = 429 as const;
  constructor(message = "OpenAI quota exhausted (insufficient_quota)") {
    super(message);
    this.name = "QuotaExhaustedError";
  }
}

interface ThrottleConfig {
  concurrency: number;
  minGapMs: number;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const cfg: ThrottleConfig = {
  concurrency: 1,
  minGapMs: 1800,
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 16000,
};

let active = 0;
let lastStartAt = 0;
const waiters: Array<() => void> = [];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function acquire() {
  if (active < cfg.concurrency) {
    active++;
  } else {
    await new Promise<void>((resolve) => waiters.push(resolve));
    active++;
  }
  const gap = cfg.minGapMs - (Date.now() - lastStartAt);
  if (gap > 0) await sleep(gap);
  lastStartAt = Date.now();
}

function release() {
  active = Math.max(0, active - 1);
  const next = waiters.shift();
  if (next) next();
}

function parseRetryAfter(h: string | null): number | null {
  if (!h) return null;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(h);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

function backoffDelay(attempt: number, retryAfterMs: number | null): number {
  if (retryAfterMs != null) return Math.min(cfg.maxDelayMs, retryAfterMs);
  const base = Math.min(cfg.maxDelayMs, cfg.baseDelayMs * Math.pow(2, attempt));
  const jitter = Math.floor(Math.random() * 500);
  return base + jitter;
}

export interface OpenAIFetchOptions {
  /** Tag for logs (e.g. "packet:prep", "resume:tailor"). */
  label: string;
  /** Override max retries (default 5). */
  maxRetries?: number;
}

/**
 * Throttled fetch that auto-retries 429/5xx with backoff.
 *
 * Returns the successful Response. Throws RateLimitExhaustedError after
 * the final 429, QuotaExhaustedError immediately on insufficient_quota,
 * or a plain Error for non-retryable failures.
 */
export async function openAIFetch(
  url: string,
  init: RequestInit,
  opts: OpenAIFetchOptions
): Promise<Response> {
  const maxRetries = opts.maxRetries ?? cfg.maxRetries;
  const startedAt = Date.now();
  console.log(`[openai] ${opts.label} request started`);

  await acquire();
  try {
    let lastStatus = 0;
    let lastRetryAfterMs: number | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const resp = await fetch(url, init);
        if (resp.ok) {
          console.log(`[openai] ${opts.label} ok in ${Date.now() - startedAt}ms (attempt ${attempt + 1})`);
          return resp;
        }
        lastStatus = resp.status;
        // Peek body to detect insufficient_quota — clone so caller can still read.
        const cloned = resp.clone();
        const bodyText = await cloned.text().catch(() => "");
        if (resp.status === 429 && /insufficient_quota|exceeded your current quota/i.test(bodyText)) {
          console.warn(`[openai] ${opts.label} quota exhausted — not retrying`);
          throw new QuotaExhaustedError(`OpenAI quota exhausted: ${bodyText.slice(0, 200)}`);
        }
        const retryable = resp.status === 429 || (resp.status >= 500 && resp.status < 600);
        if (!retryable) {
          throw new Error(`OpenAI ${resp.status}: ${bodyText.slice(0, 200)}`);
        }
        if (attempt >= maxRetries) {
          lastRetryAfterMs = parseRetryAfter(resp.headers.get("retry-after"));
          break;
        }
        const retryAfterMs = parseRetryAfter(resp.headers.get("retry-after"));
        const wait = backoffDelay(attempt, retryAfterMs);
        console.warn(
          `[openai] ${opts.label} ${resp.status} attempt ${attempt + 1}/${maxRetries + 1} — retrying in ${wait}ms`
        );
        await sleep(wait);
      } catch (e: any) {
        if (e instanceof QuotaExhaustedError) throw e;
        // Network error — retry
        if (attempt >= maxRetries) {
          console.error(`[openai] ${opts.label} final failure: ${e?.message ?? e}`);
          throw e;
        }
        const wait = backoffDelay(attempt, null);
        console.warn(`[openai] ${opts.label} network error attempt ${attempt + 1} — retrying in ${wait}ms: ${e?.message ?? e}`);
        await sleep(wait);
      }
    }
    console.error(`[openai] ${opts.label} rate-limit exhausted after ${maxRetries + 1} attempts`);
    throw new RateLimitExhaustedError(
      `OpenAI rate limit exhausted after ${maxRetries + 1} attempts`,
      lastStatus || 429,
      maxRetries + 1,
      lastRetryAfterMs
    );
  } finally {
    release();
  }
}

export function isRateLimitError(e: unknown): e is RateLimitExhaustedError | QuotaExhaustedError {
  return e instanceof RateLimitExhaustedError || e instanceof QuotaExhaustedError;
}
