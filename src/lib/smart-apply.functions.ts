import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generatePacket, computeQuality, confidenceLabel } from "./packet.functions";
import { SUPPORTED_ATS, SALARY_FLOOR } from "./scoring";

// Auto-Review safety constants. Tightened intentionally — see "Auto Review Safety Gates".
export const AUTO_GATES = {
  trust: 95,
  interview: 88,
  quality: 88,
  salary: 55000,
  freshDays: 14,
  atsAllowed: ["Greenhouse", "Lever", "Ashby", "Breezy"],
};

export const DETECTION_FLAGS = [
  "captcha", "mfa", "login_required", "rate_limit",
  "bot_detected", "account_verification", "blocked", "unusual_traffic",
] as const;

const todayKey = () => new Date().toISOString().slice(0, 10);

// ----- Gate evaluation ----- //
export interface GateResult {
  pass: boolean;
  failed: string[];
  passed: string[];
  scores: Record<string, number>;
}

function ageDays(iso?: string | null) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export function evaluateGates(args: {
  job: any;
  company: any;
  quality: number;
  ats_check?: any;
  duplicate?: boolean;
  recent_company_app?: boolean;
}): GateResult {
  const failed: string[] = [];
  const passed: string[] = [];
  const j = args.job, c = args.company || {};
  const trust = c.trust_score ?? 0;
  const interview = j.interview_probability ?? 0;
  const salary = j.salary_min ?? 0;
  const age = ageDays(j.posted_at ?? j.created_at);
  const ats = j.ats ?? "";
  const ac = args.ats_check ?? {};
  const scamFlags = (c.red_flags ?? []).length;

  const check = (cond: boolean, label: string) =>
    cond ? passed.push(label) : failed.push(label);

  check(trust >= AUTO_GATES.trust, `trust ≥ ${AUTO_GATES.trust} (got ${trust})`);
  check(interview >= AUTO_GATES.interview, `interview ≥ ${AUTO_GATES.interview} (got ${interview})`);
  check(args.quality >= AUTO_GATES.quality, `quality ≥ ${AUTO_GATES.quality} (got ${args.quality})`);
  check(salary >= AUTO_GATES.salary, `salary ≥ $${AUTO_GATES.salary} (got $${salary})`);
  check(j.remote === true, "remote-only");
  check(AUTO_GATES.atsAllowed.includes(ats), `ATS in {${AUTO_GATES.atsAllowed.join(",")}} (got ${ats || "n/a"})`);
  check(age != null && age <= AUTO_GATES.freshDays, `posted ≤ ${AUTO_GATES.freshDays}d (age ${age ?? "unknown"})`);
  check(!ac.requires_login, "no login wall");
  check(!ac.has_mfa, "no MFA");
  check(!ac.has_captcha, "no CAPTCHA");
  check(!scamFlags, "no scam flags");
  check(!args.duplicate, "no duplicate application");
  check(!args.recent_company_app, "no application to same company in last 30d");

  return {
    pass: failed.length === 0,
    failed, passed,
    scores: { trust, interview, quality: args.quality, salary, age: age ?? -1 },
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

    const autoCap = settings?.auto_review_daily_cap ?? 10;
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

    let approved = 0, blocked = 0, prepared = 0, skipped = 0;
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

      // 30-day per-company cooldown
      const { data: recentApp } = await (supabase as any).from("applications")
        .select("id, created_at, job_listings!inner(company_name)")
        .eq("user_id", userId)
        .gte("created_at", cooldownCutoff)
        .eq("job_listings.company_name", j.company_name)
        .limit(1).maybeSingle();
      const recentCompany = !!recentApp;

      // Existing application = duplicate
      const { data: existing } = await (supabase as any).from("applications")
        .select("id").eq("user_id", userId).eq("job_id", j.id).maybeSingle();
      const duplicate = !!existing;

      // Generate packet (this enforces packet creation; counts toward packetCap)
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

      const gate = evaluateGates({
        job: j, company: j.companies, quality: packet.quality?.score ?? 0,
        ats_check: atsCheck, duplicate, recent_company_app: recentCompany,
      });

      // Detection flags
      const detection = [
        atsCheck?.has_captcha && "captcha",
        atsCheck?.has_mfa && "mfa",
        atsCheck?.requires_login && "login_required",
      ].filter(Boolean) as string[];

      if (mode === "auto_review" && !fridayPrepareOnly && gate.pass && detection.length === 0) {
        await (supabase as any).from("applications")
          .update({ status: "approved", priority: "high", notes: `Auto-approved · quality ${packet.quality?.score}` })
          .eq("user_id", userId).eq("job_id", j.id);
        await log({
          job_id: j.id, job_title: j.title, company_name: j.company_name, ats,
          action: "auto_approved",
          reason: `All gates passed · quality ${packet.quality?.score} · ${confidenceLabel(packet.quality?.score ?? 0)}`,
          gates: gate,
        });
        approved++;
        atsCounts.set(ats, (atsCounts.get(ats) ?? 0) + 1);
      } else if (detection.length > 0) {
        await log({
          job_id: j.id, job_title: j.title, company_name: j.company_name, ats,
          action: "safety_blocked",
          reason: `Detection signals: ${detection.join(", ")} — moved to Manual Review. Will not retry automatically.`,
          gates: { detection, ...gate },
        });
        blocked++;
      } else {
        const note = mode === "auto_review"
          ? (fridayPrepareOnly ? "Friday — prepare-only mode, manual review required" : `Failed gates: ${gate.failed.join(", ")}`)
          : "Manual Review mode — packet ready for approval";
        await log({
          job_id: j.id, job_title: j.title, company_name: j.company_name, ats,
          action: "prepared", reason: note, gates: gate,
        });
        atsCounts.set(ats, (atsCounts.get(ats) ?? 0) + 1);
      }
    }

    return { ok: true, processed: prepared, approved, blocked, skipped, mode, fridayPrepareOnly };
  });
