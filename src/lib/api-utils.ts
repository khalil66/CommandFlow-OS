import { toast } from "sonner";

function isUnauthorized(err: any): boolean {
  const msg = (err?.message ?? String(err ?? "")).toLowerCase();
  return msg.includes("unauthorized") || msg.includes("no authorization header") || /\b401\b/.test(msg);
}

let redirecting = false;
function handleUnauthorized() {
  if (redirecting) return;
  if (typeof window === "undefined") return;
  redirecting = true;
  try { toast.error("Please sign in to view dashboard."); } catch {}
  if (!window.location.pathname.startsWith("/auth")) {
    window.location.replace("/auth");
  }
  setTimeout(() => { redirecting = false; }, 2000);
}

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
      if (isUnauthorized(err)) {
        handleUnauthorized();
        break;
      }
      const msg = err?.message ?? String(err);
      // Don't retry on client errors
      if (/4\d\d/.test(msg) || /unauth|forbidden|not found/i.test(msg)) break;
      if (attempt < retries) await new Promise(r => setTimeout(r, 300 * 2 ** attempt));
    }
  }
  if (!silent && !isUnauthorized(lastErr)) toast.error(`${label} failed: ${lastErr?.message ?? "unknown error"}`);
  throw lastErr;
}
