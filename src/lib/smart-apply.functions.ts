import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generatePacket, confidenceLabel } from "./packet.functions";
import { evaluateAutoReview, AUTO_THRESHOLDS } from "./auto-review-scoring";

// Auto-Review safety constants. Source of truth lives in auto-review-scoring.ts.
export const AUTO_GATES = {
  trust: AUTO_THRESHOLDS.trust,
  interview: AUTO_THRESHOLDS.interview,
  quality: AUTO_THRESHOLDS.quality,
  salary: AUTO_THRESHOLDS.salary_min,
  freshDays: AUTO_THRESHOLDS.fresh_days,
  atsAllowed: ["Greenhouse", "Lever", "Ashby", "Breezy"],
  passRateCap: AUTO_THRESHOLDS.daily_pass_rate_cap,
};

export const DETECTION_FLAGS = [
  "captcha", "mfa", "login_required", "rate_limit",
  "bot_detected", "account_verification", "blocked", "unusual_traffic",
] as const;

// Backwards-compat shape for any caller still importing evaluateGates.
export interface GateResult {
  pass: boolean;
  failed: string[];
  passed: string[];
  scores: Record<string, any>;
}

export function evaluateGates(args: {
  job: any; company: any; quality: number;
  ats_check?: any; duplicate?: boolean; recent_company_app?: boolean;
}): GateResult {
  const r = evaluateAutoReview(args);
  return {
    pass: r.decision === "auto",
    failed: [...r.failed, ...r.rejected_for],
    passed: r.passed,
    scores: r.scores as any,
  };
}


// ----- Pause / resume automation ----- //
export const setAutomationPaused = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ paused: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await (supabase as any).from("user_settings")
      .update({ automation_paused: data.paused }).eq("user_id", userId);
    await (supabase as any).from("automation_safety_logs").insert({
      user_id: userId,
      action: data.paused ? "paused" : "resumed",
      reason: data.paused ? "Emergency stop activated" : "Automation resumed by user",
      gates: {},
    });
    return { ok: true, paused: data.paused };
  });

// ----- Set application mode ----- //
export const setApplicationMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ mode: z.enum(["manual_review", "auto_review"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await (supabase as any).from("user_settings")
      .update({ application_mode: data.mode }).eq("user_id", userId);
    return { ok: true, mode: data.mode };
  });

// ----- List safety logs ----- //
export const listSafetyLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await (supabase as any).from("automation_safety_logs")
      .select("*").eq("user_id", userId)
      .order("created_at", { ascending: false }).limit(100);
    return { logs: data ?? [] };
  });

// ----- Smart-Apply metrics for dashboard ----- //
export const getSmartApplyMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const now = new Date();
    const cutoff = new Date(Date.now() - AUTO_GATES.freshDays * 86400000).toISOString();
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);

    const [{ data: settings }, jobsRes, freshRes, missingRes, autoTodayRes, blockedTodayRes, manualRes, packetsTodayRes] =
      await Promise.all([
        (supabase as any).from("user_settings").select("*").eq("user_id", userId).maybeSingle(),
        (supabase as any).from("job_listings").select("id,posted_at", { count: "exact", head: true }).eq("user_id", userId),
        (supabase as any).from("job_listings").select("id", { count: "exact", head: true })
          .eq("user_id", userId).gte("posted_at", cutoff),
        (supabase as any).from("job_listings").select("id", { count: "exact", head: true })
          .eq("user_id", userId).is("posted_at", null),
        (supabase as any).from("automation_safety_logs").select("id", { count: "exact", head: true })
          .eq("user_id", userId).eq("action", "auto_approved").gte("created_at", startOfDay.toISOString()),
        (supabase as any).from("automation_safety_logs").select("id", { count: "exact", head: true })
          .eq("user_id", userId).eq("action", "safety_blocked").gte("created_at", startOfDay.toISOString()),
        (supabase as any).from("applications").select("id", { count: "exact", head: true })
          .eq("user_id", userId).eq("status", "manual_review"),
        (supabase as any).from("resume_versions").select("id", { count: "exact", head: true })
          .eq("user_id", userId).gte("created_at", startOfDay.toISOString()),
      ]);

    const dow = now.getDay(); // 0 Sun..6 Sat
    const activeWeekdays: number[] = settings?.active_weekdays ?? [1,2,3,4,5];
    const isActiveDay = activeWeekdays.includes(dow);
    const isFridayPrepareOnly = dow === 5 && (settings?.friday_prepare_only ?? true);

    const autoCap = settings?.auto_review_daily_cap ?? 5;
    const packetCap = settings?.packet_daily_cap ?? 25;

    return {
      mode: settings?.application_mode ?? "manual_review",
      paused: !!settings?.automation_paused,
      schedule: { hour: settings?.schedule_hour ?? 8, minute: settings?.schedule_minute ?? 30, weekdays: activeWeekdays },
      is_active_day: isActiveDay,
      is_friday_prepare_only: isFridayPrepareOnly,
      total_jobs: jobsRes.count ?? 0,
      fresh_jobs: freshRes.count ?? 0,
      missing_posted_at: missingRes.count ?? 0,
      auto_approved_today: autoTodayRes.count ?? 0,
      safety_blocked_today: blockedTodayRes.count ?? 0,
      manual_review_pending: manualRes.count ?? 0,
      packets_today: packetsTodayRes.count ?? 0,
      auto_remaining: Math.max(0, autoCap - (autoTodayRes.count ?? 0)),
      packet_remaining: Math.max(0, packetCap - (packetsTodayRes.count ?? 0)),
      caps: {
        auto_review_daily_cap: autoCap,
        packet_daily_cap: packetCap,
        per_ats_daily_cap: settings?.per_ats_daily_cap ?? 5,
        company_cooldown_days: settings?.company_cooldown_days ?? 30,
      },
    };
  });

// ----- Run Smart-Apply daily batch ----- //
export const runSmartApply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const log = async (row: any) => {
      await (supabase as any).from("automation_safety_logs").insert({ user_id: userId, ...row });
    };

    const { data: settings } = await (supabase as any).from("user_settings")
      .select("*").eq("user_id", userId).maybeSingle();
    const s = settings ?? {};

    if (s.automation_paused) {
      await log({ action: "skipped", reason: "Automation paused — emergency stop active", gates: {} });
      return { ok: false, reason: "paused", processed: 0, approved: 0, blocked: 0 };
    }

    const dow = new Date().getDay();
    const activeWeekdays: number[] = s.active_weekdays ?? [1,2,3,4,5];
    if (!activeWeekdays.includes(dow)) {
      await log({ action: "skipped", reason: `Inactive weekday (${dow})`, gates: {} });
      return { ok: false, reason: "inactive_day", processed: 0, approved: 0, blocked: 0 };
    }
    const fridayPrepareOnly = dow === 5 && (s.friday_prepare_only ?? true);
    const autoCap = s.auto_review_daily_cap ?? 10;
    const packetCap = s.packet_daily_cap ?? 25;
    const perAtsCap = s.per_ats_daily_cap ?? 5;
    const cooldownDays = s.company_cooldown_days ?? 30;
    const mode: "manual_review" | "auto_review" = s.application_mode ?? "manual_review";

    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const cutoff = new Date(Date.now() - AUTO_GATES.freshDays * 86400000).toISOString();
    const cooldownCutoff = new Date(Date.now() - cooldownDays * 86400000).toISOString();

    const { data: jobs } = await (supabase as any).from("job_listings")
      .select("*, companies(*)")
      .eq("user_id", userId)
      .gte("posted_at", cutoff)
      .order("interview_probability", { ascending: false })
      .limit(50);

    const { data: appsToday } = await (supabase as any).from("automation_safety_logs")
      .select("ats, action")
      .eq("user_id", userId)
      .gte("created_at", startOfDay.toISOString());
    const atsCounts = new Map<string, number>();
    for (const r of appsToday ?? []) {
      if (r.action === "auto_approved" || r.action === "prepared") {
        atsCounts.set(r.ats ?? "", (atsCounts.get(r.ats ?? "") ?? 0) + 1);
      }
    }

    let approved = 0, blocked = 0, prepared = 0, skipped = 0, rejected = 0;
    let evaluated = 0; // jobs evaluated against auto-review (for pass-rate guard)
    let guardTripped = false;
    const generateFn = (data: any) => generatePacket({ data });

    for (const j of jobs ?? []) {
      if (prepared >= packetCap) { skipped++; continue; }
      if (mode === "auto_review" && approved >= autoCap) { skipped++; continue; }

      const ats = j.ats ?? "";
      if ((atsCounts.get(ats) ?? 0) >= perAtsCap) {
        await log({
          job_id: j.id, job_title: j.title, company_name: j.company_name, ats,
          action: "skipped", reason: `Per-ATS cap reached (${perAtsCap}/day for ${ats})`, gates: {},
        });
        skipped++; continue;
      }

      const { data: recentApp } = await (supabase as any).from("applications")
        .select("id, created_at, job_listings!inner(company_name)")
        .eq("user_id", userId)
        .gte("created_at", cooldownCutoff)
        .eq("job_listings.company_name", j.company_name)
        .limit(1).maybeSingle();
      const recentCompany = !!recentApp;

      const { data: existing } = await (supabase as any).from("applications")
        .select("id").eq("user_id", userId).eq("job_id", j.id).maybeSingle();
      const duplicate = !!existing;

      let packet: any;
      try {
        packet = await generateFn({ job_id: j.id });
        prepared++;
      } catch (e: any) {
        await log({
          job_id: j.id, job_title: j.title, company_name: j.company_name, ats,
          action: "error", reason: `Packet generation failed: ${e.message?.slice(0, 200)}`, gates: {},
        });
        continue;
      }

      const { data: atsCheck } = await (supabase as any).from("ats_checks")
        .select("requires_login, has_mfa, has_captcha")
        .eq("user_id", userId).eq("job_id", j.id)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();

      const review = evaluateAutoReview({
        job: j, company: j.companies, quality: packet.quality?.score ?? 0,
        ats_check: atsCheck, duplicate, recent_company_app: recentCompany,
      });

      const detection = [
        atsCheck?.has_captcha && "captcha",
        atsCheck?.has_mfa && "mfa",
        atsCheck?.requires_login && "login_required",
      ].filter(Boolean) as string[];

      // Pass-rate guard: after a small warmup, if today's auto-pass rate
      // exceeds the cap, force remaining jobs to Manual Review.
      evaluated++;
      const liveRate = evaluated >= 5 ? approved / evaluated : 0;
      if (mode === "auto_review" && liveRate > AUTO_GATES.passRateCap) {
        guardTripped = true;
      }

      if (detection.length > 0) {
        await log({
          job_id: j.id, job_title: j.title, company_name: j.company_name, ats,
          action: "safety_blocked",
          reason: `Detection signals: ${detection.join(", ")} — Manual Review. No retry.`,
          gates: { detection, ...review },
        });
        blocked++;
      } else if (review.decision === "reject") {
        await log({
          job_id: j.id, job_title: j.title, company_name: j.company_name, ats,
          action: "rejected", reason: `Hard reject: ${review.rejected_for.join("; ")}`,
          gates: review,
        });
        rejected++;
      } else if (
        mode === "auto_review" && !fridayPrepareOnly &&
        !guardTripped && review.decision === "auto"
      ) {
        await (supabase as any).from("applications")
          .update({ status: "approved", priority: "high",
            notes: `Auto-approved · quality ${packet.quality?.score}` })
          .eq("user_id", userId).eq("job_id", j.id);
        await log({
          job_id: j.id, job_title: j.title, company_name: j.company_name, ats,
          action: "auto_approved",
          reason: `All gates passed · quality ${packet.quality?.score} · ${confidenceLabel(packet.quality?.score ?? 0)}`,
          gates: review,
        });
        approved++;
        atsCounts.set(ats, (atsCounts.get(ats) ?? 0) + 1);
      } else {
        let note: string;
        if (guardTripped) note = `Pass-rate guard tripped (>${Math.round(AUTO_GATES.passRateCap*100)}%) — sent to Manual Review`;
        else if (mode === "auto_review" && fridayPrepareOnly) note = "Friday prepare-only — Manual Review required";
        else if (mode === "auto_review") note = `Failed gates: ${review.failed.join(", ")}`;
        else note = "Manual Review mode — packet ready for approval";
        await log({
          job_id: j.id, job_title: j.title, company_name: j.company_name, ats,
          action: "prepared", reason: note, gates: review,
        });
        atsCounts.set(ats, (atsCounts.get(ats) ?? 0) + 1);
      }
    }

    return {
      ok: true, processed: prepared, approved, blocked, rejected, skipped,
      mode, fridayPrepareOnly, guardTripped,
      pass_rate: prepared > 0 ? +(approved / prepared).toFixed(3) : 0,
    };
  });

