import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Safe Auto-Submit confirmation dashboard data.
 * Aggregates dry run status, gating preconditions, daily cap usage, and
 * recent safety blocks needed to decide whether real submissions can run.
 */
export const getSafeAutoSubmitDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const { data: settings } = await (supabase as any).from("user_settings")
      .select("safe_auto_submit_enabled, safe_auto_submit_daily_cap, safe_auto_submit_dry_run, safe_auto_submit_dry_run_passed_at, safe_auto_submit_dry_run_report, safe_auto_submit_confirmed_at, automation_paused")
      .eq("user_id", userId).maybeSingle();
    const s = settings ?? {};

    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const { count: submittedToday } = await (supabase as any)
      .from("applications").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("status", "submitted_automatically")
      .gte("auto_submitted_at", startOfDay.toISOString());

    const cap = s.safe_auto_submit_daily_cap ?? 3;
    const used = submittedToday ?? 0;
    const passedAt = s.safe_auto_submit_dry_run_passed_at as string | null;
    const dryRunFresh = !!passedAt && (Date.now() - new Date(passedAt).getTime()) <= 24 * 3600 * 1000;
    const report = s.safe_auto_submit_dry_run_report ?? null;
    const blocked = report?.blocked ?? 0;
    const confirmedAt = s.safe_auto_submit_confirmed_at as string | null;
    const confirmFresh = !!confirmedAt && (Date.now() - new Date(confirmedAt).getTime()) <= 24 * 3600 * 1000;

    const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: recentBlocks } = await (supabase as any)
      .from("automation_safety_logs")
      .select("id, action, reason, job_title, company_name, ats, created_at")
      .eq("user_id", userId).in("action", ["blocked", "skipped"])
      .gte("created_at", since24h)
      .order("created_at", { ascending: false }).limit(20);

    const preconditions = {
      dry_run_passed_within_24h: dryRunFresh,
      user_confirmed_within_24h: confirmFresh,
      daily_cap_available: used < cap,
      no_safety_blocks_in_last_run: blocked === 0,
      dry_run_mode_off: s.safe_auto_submit_dry_run === false,
      not_paused: !s.automation_paused,
    };
    const real_submit_enabled = !!s.safe_auto_submit_enabled &&
      Object.values(preconditions).every(Boolean);

    return {
      dry_run: {
        passed: dryRunFresh,
        last_run_at: passedAt,
        ready: report?.ready_for_submit ?? 0,
        blocked,
        missing_fields: report?.missing_fields ?? 0,
        manual_review_required: report?.manual_review_required ?? 0,
        total: report?.total_candidates ?? 0,
      },
      submit: {
        enabled_setting: !!s.safe_auto_submit_enabled,
        real_submit_enabled,
        daily_cap: cap,
        used_today: used,
        remaining: Math.max(0, cap - used),
        confirmed_at: confirmedAt,
        confirm_fresh: confirmFresh,
        dry_run_mode: s.safe_auto_submit_dry_run !== false,
        automation_paused: !!s.automation_paused,
      },
      preconditions,
      recent_blocks: recentBlocks ?? [],
    };
  });

export const confirmRealSubmit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const stamp = new Date().toISOString();
    await (supabase as any).from("user_settings")
      .update({ safe_auto_submit_confirmed_at: stamp })
      .eq("user_id", userId);
    await (supabase as any).from("automation_logs").insert({
      user_id: userId, action: "safe_auto_submit_confirmed",
      status: "success", details: { confirmed_at: stamp },
    });
    return { confirmed_at: stamp };
  });

export const setEmergencyPause = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) => ({ paused: !!d?.paused }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await (supabase as any).from("user_settings")
      .update({ automation_paused: data.paused })
      .eq("user_id", userId);
    await (supabase as any).from("automation_logs").insert({
      user_id: userId, action: "emergency_pause",
      status: "success", details: { paused: data.paused },
    });
    return { paused: data.paused };
  });
