import { processRetries } from "./retry-processor.server";

export async function runScheduledRetry(env: Record<string, unknown>) {
  if (env["AUTONOMOUS_RETRY_ENABLED"] !== "true" || env["RETRY_REPAIR_ENABLED"] !== "true") {
    return { ok: true, dry_run: true, processed: 0, reason: "Activation pending approval" };
  }
  // Invoked only by the trusted scheduled event, never a caller-provided user ID.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return processRetries(supabaseAdmin, null);
}
