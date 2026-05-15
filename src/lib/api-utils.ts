import { toast } from "sonner";

/** Retry async ops with exponential backoff. Surface friendly errors via toast. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; label?: string; silent?: boolean } = {},
): Promise<T> {
  const { retries = 2, label = "Request", silent = false } = opts;
  let lastErr: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      const msg = err?.message ?? String(err);
      // Don't retry on client errors
      if (/4\d\d/.test(msg) || /unauth|forbidden|not found/i.test(msg)) break;
      if (attempt < retries) await new Promise(r => setTimeout(r, 300 * 2 ** attempt));
    }
  }
  if (!silent) toast.error(`${label} failed: ${lastErr?.message ?? "unknown error"}`);
  throw lastErr;
}
