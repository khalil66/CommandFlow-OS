import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// In-memory cache of last validation (per worker instance).
let cached: { ok: boolean; checkedAt: number; status: number | null; message: string | null } | null = null;
const CACHE_MS = 5 * 60 * 1000;

export interface OpenAiHealth {
  ok: boolean;
  configured: boolean;
  env_var: string;
  status: number | null;
  message: string | null;
  checked_at: string;
  cached: boolean;
}

async function runValidation(force = false): Promise<OpenAiHealth> {
  const envVar = "OPENAI_API_KEY";
  const apiKey = process.env.OPENAI_API_KEY;
  const now = Date.now();
  if (!apiKey) {
    cached = { ok: false, checkedAt: now, status: null, message: "OPENAI_API_KEY is not set in runtime env" };
    return {
      ok: false, configured: false, env_var: envVar,
      status: null, message: cached.message,
      checked_at: new Date(now).toISOString(), cached: false,
    };
  }
  if (!force && cached && now - cached.checkedAt < CACHE_MS) {
    return {
      ok: cached.ok, configured: true, env_var: envVar,
      status: cached.status, message: cached.message,
      checked_at: new Date(cached.checkedAt).toISOString(), cached: true,
    };
  }
  try {
    const r = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const ok = r.ok;
    let message: string | null = null;
    if (!ok) {
      const txt = await r.text().catch(() => "");
      message = `OpenAI /models ${r.status}: ${txt.slice(0, 180)}`;
    }
    cached = { ok, checkedAt: now, status: r.status, message };
    return {
      ok, configured: true, env_var: envVar,
      status: r.status, message,
      checked_at: new Date(now).toISOString(), cached: false,
    };
  } catch (e: any) {
    cached = { ok: false, checkedAt: now, status: null, message: e?.message || String(e) };
    return {
      ok: false, configured: true, env_var: envVar,
      status: null, message: cached.message,
      checked_at: new Date(now).toISOString(), cached: false,
    };
  }
}

/** Fast helper for other server fns. Uses cached value when fresh. */
export async function isOpenAiHealthy(): Promise<{ ok: boolean; reason: string | null }> {
  const h = await runValidation(false);
  return { ok: h.ok, reason: h.ok ? null : (h.message || "OpenAI unavailable") };
}

export const validateOpenAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => runValidation(true));

export const getOpenAiHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => runValidation(false));
