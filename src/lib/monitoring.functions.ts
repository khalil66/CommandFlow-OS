import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sendSmsInternal } from "@/lib/sms.functions";

/**
 * Production monitoring: aggregates failures, latencies, health markers,
 * queue backlog, and recent structured logs across the existing tables.
 * No schema changes required — derives everything from openai_usage,
 * notification_logs, import_logs, automation_logs, automation_safety_logs,
 * applications, job_listings, daily_batches.
 */

type Window = "1h" | "24h" | "7d";
const WINDOW_MS: Record<Window, number> = {
  "1h": 3600_000,
  "24h": 86_400_000,
  "7d": 7 * 86_400_000,
};

export const getMonitoringDashboard = createServerFn({ method: "POST" })
  .inputValidator((d: any) =>
    z.object({ window: z.enum(["1h", "24h", "7d"]).default("24h") }).parse(d ?? {}),
  )
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const since = new Date(Date.now() - WINDOW_MS[data.window]).toISOString();
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();

    const s = supabase as any;

    // Parallel fetch — keep payload bounded
    const [
      openai, notif, imports, autoLogs, safetyLogs,
      latestBatch, queueCounts, appCounts,
    ] = await Promise.all([
      s.from("openai_usage").select("id, kind, model, success, error, estimated_cost_cents, created_at")
        .eq("user_id", userId).gte("created_at", since).order("created_at", { ascending: false }).limit(500),
      s.from("notification_logs").select("id, kind, channel, status, error, to_number, body, created_at")
        .eq("user_id", userId).gte("created_at", since).order("created_at", { ascending: false }).limit(200),
      s.from("import_logs").select("id, ats, source_url, success, message, found, imported, duplicate, skipped, rejected, manual_review, created_at")
        .eq("user_id", userId).gte("created_at", since).order("created_at", { ascending: false }).limit(200),
      s.from("automation_logs").select("id, action, status, details, created_at")
        .eq("user_id", userId).gte("created_at", since).order("created_at", { ascending: false }).limit(300),
      s.from("automation_safety_logs").select("id, action, reason, ats, company_name, job_title, created_at")
        .eq("user_id", userId).gte("created_at", since).order("created_at", { ascending: false }).limit(200),
      s.from("daily_batches").select("id, batch_date, status, created_at")
        .eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      s.from("job_listings").select("status", { count: "exact", head: false })
        .eq("user_id", userId).in("status", ["new", "manual_review", "queued"]).limit(2000),
      s.from("applications").select("status", { count: "exact", head: false })
        .eq("user_id", userId).gte("created_at", dayAgo).limit(2000),
    ]);

    const openaiRows = openai.data ?? [];
    const notifRows = notif.data ?? [];
    const importRows = imports.data ?? [];
    const autoRows = autoLogs.data ?? [];
    const safetyRows = safetyLogs.data ?? [];

    const openaiFailures = openaiRows.filter((r: any) => r.success === false);
    const smsFailures = notifRows.filter((r: any) =>
      r.channel === "sms" && (r.status === "error" || r.status?.startsWith("skipped")));
    const importFailures = importRows.filter((r: any) =>
      r.success === false || r.imported === 0 && (r.found ?? 0) > 0);
    const autoFailures = autoRows.filter((r: any) =>
      r.status === "failed" || r.status === "error" || r.status === "blocked");
    const dryRunFailures = autoRows.filter((r: any) =>
      typeof r.action === "string" && r.action.includes("dry_run") && r.status !== "success");
    const packetFailures = autoRows.filter((r: any) =>
      typeof r.action === "string" && r.action.includes("packet") && r.status !== "success");

    // Latency proxy: Supabase round-trip on a tiny query
    const tStart = Date.now();
    const probe = await s.from("user_settings").select("user_id").eq("user_id", userId).maybeSingle();
    const supabaseLatencyMs = Date.now() - tStart;
    const supabaseHealthy = !probe.error;

    // Health markers
    const lastImportOk = importRows.find((r: any) => r.success && (r.imported ?? 0) > 0) ?? null;
    const lastPacket = autoRows.find((r: any) =>
      typeof r.action === "string" && r.action.includes("packet") && r.status === "success") ?? null;
    const lastSmsOk = notifRows.find((r: any) => r.channel === "sms" && r.status === "sent") ?? null;
    const lastScan = importRows[0] ?? null;

    const errorRate = (() => {
      const total = openaiRows.length + notifRows.length + importRows.length + autoRows.length;
      const fails = openaiFailures.length + smsFailures.length + importFailures.length + autoFailures.length;
      return total === 0 ? 0 : Math.round((fails / total) * 1000) / 10;
    })();

    // Backlog
    const queueRows = queueCounts.data ?? [];
    const backlog = {
      new_jobs: queueRows.filter((r: any) => r.status === "new").length,
      manual_review: queueRows.filter((r: any) => r.status === "manual_review").length,
      queued: queueRows.filter((r: any) => r.status === "queued").length,
    };

    const appRows = appCounts.data ?? [];
    const apps24h = {
      total: appRows.length,
      submitted_manually: appRows.filter((r: any) => r.status === "submitted_manual" || r.status === "submitted").length,
      submitted_automatically: appRows.filter((r: any) => r.status === "submitted_automatically").length,
      manual_review: appRows.filter((r: any) => r.status === "manual_review").length,
    };

    // Recent structured log feed (merged + normalized)
    const feed = [
      ...openaiRows.map((r: any) => ({
        ts: r.created_at, action: `openai:${r.kind}`, status: r.success ? "success" : "failed",
        company: null, ats: null, reason: r.error ?? null,
      })),
      ...notifRows.map((r: any) => ({
        ts: r.created_at, action: `sms:${r.kind}`, status: r.status,
        company: null, ats: null, reason: r.error ?? null,
      })),
      ...importRows.map((r: any) => ({
        ts: r.created_at, action: "import", status: r.success ? "success" : "failed",
        company: null, ats: r.ats ?? null,
        reason: r.message ?? `${r.imported}/${r.found} imported`,
      })),
      ...autoRows.map((r: any) => ({
        ts: r.created_at, action: r.action, status: r.status,
        company: r.details?.company_name ?? null, ats: r.details?.ats ?? null,
        reason: r.details?.reason ?? null,
      })),
      ...safetyRows.map((r: any) => ({
        ts: r.created_at, action: `safety:${r.action}`, status: "blocked",
        company: r.company_name, ats: r.ats, reason: r.reason,
      })),
    ].sort((a, b) => +new Date(b.ts) - +new Date(a.ts)).slice(0, 150);

    return {
      window: data.window,
      generated_at: new Date().toISOString(),
      health: {
        supabase_healthy: supabaseHealthy,
        supabase_latency_ms: supabaseLatencyMs,
        last_successful_scan_at: lastImportOk?.created_at ?? null,
        last_successful_packet_at: lastPacket?.created_at ?? null,
        last_successful_sms_at: lastSmsOk?.created_at ?? null,
        last_scan_attempt_at: lastScan?.created_at ?? null,
        last_batch_at: latestBatch.data?.created_at ?? null,
        error_rate_pct: errorRate,
      },
      failures: {
        openai: { count: openaiFailures.length, recent: openaiFailures.slice(0, 10) },
        sms: { count: smsFailures.length, recent: smsFailures.slice(0, 10) },
        imports: { count: importFailures.length, recent: importFailures.slice(0, 10) },
        automation: { count: autoFailures.length, recent: autoFailures.slice(0, 10) },
        safety_blocks: { count: safetyRows.length, recent: safetyRows.slice(0, 10) },
        dry_run: { count: dryRunFailures.length, recent: dryRunFailures.slice(0, 5) },
        packet: { count: packetFailures.length, recent: packetFailures.slice(0, 5) },
      },
      backlog,
      applications_24h: apps24h,
      structured_logs: feed,
    };
  });

/**
 * Alert evaluator. Sends SMS (best-effort) when thresholds are exceeded.
 * Safe to call from a button or a cron — idempotent within a short window
 * because notification_logs records every send.
 */
export const evaluateAndAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const s = supabase as any;
    const since = new Date(Date.now() - 3600_000).toISOString();

    const [openai, imports, autoLogs, settings] = await Promise.all([
      s.from("openai_usage").select("success, error, created_at").eq("user_id", userId).gte("created_at", since),
      s.from("import_logs").select("success, created_at").eq("user_id", userId).gte("created_at", since),
      s.from("automation_logs").select("status, action, created_at").eq("user_id", userId).gte("created_at", since),
      s.from("user_settings").select("phone_number, sms_enabled, sms_notify_safety_block").eq("user_id", userId).maybeSingle(),
    ]);

    const openaiFails = (openai.data ?? []).filter((r: any) => r.success === false);
    const importFails = (imports.data ?? []).filter((r: any) => r.success === false);
    const autoFails = (autoLogs.data ?? []).filter((r: any) => r.status === "failed" || r.status === "blocked");
    const quotaHits = openaiFails.filter((r: any) =>
      typeof r.error === "string" && /quota|rate limit|429|insufficient_quota/i.test(r.error));

    const alerts: { kind: string; message: string; severity: "warn" | "crit" }[] = [];
    if (importFails.length >= 3) alerts.push({ kind: "imports_failing", severity: "crit",
      message: `[Apply Command] ${importFails.length} import failures in the last hour.` });
    if (quotaHits.length > 0) alerts.push({ kind: "openai_quota", severity: "crit",
      message: `[Apply Command] OpenAI quota / rate-limit hit ${quotaHits.length}x in last hour.` });
    if (autoFails.filter((r: any) => r.action?.includes("auto_submit") || r.action?.includes("safe_auto")).length >= 2)
      alerts.push({ kind: "safe_auto_submit_blocked", severity: "warn",
        message: `[Apply Command] Safe Auto-Submit blocked multiple times in last hour.` });
    const errorRate = (() => {
      const total = (openai.data?.length ?? 0) + (imports.data?.length ?? 0) + (autoLogs.data?.length ?? 0);
      const fails = openaiFails.length + importFails.length + autoFails.length;
      return total === 0 ? 0 : fails / total;
    })();
    if (errorRate >= 0.25 && (openai.data?.length ?? 0) + (imports.data?.length ?? 0) >= 4) {
      alerts.push({ kind: "error_rate_spike", severity: "crit",
        message: `[Apply Command] Error rate ${Math.round(errorRate * 100)}% in last hour.` });
    }

    const phone = settings.data?.phone_number || process.env.USER_PHONE_NUMBER;
    const smsEnabled = !!settings.data?.sms_enabled;

    const sent: any[] = [];
    if (smsEnabled && phone) {
      for (const a of alerts) {
        const r = await sendSmsInternal({
          supabase, userId, to: phone, body: a.message, kind: `alert:${a.kind}`,
        });
        sent.push({ ...a, sms: r });
      }
    }

    return { alerts, sent, evaluated_at: new Date().toISOString() };
  });
