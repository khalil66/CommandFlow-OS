import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generatePacket, confidenceLabel } from "./packet.functions";
import { evaluateAutoReview, AUTO_THRESHOLDS } from "./auto-review-scoring";
import { sendSmsInternal } from "./sms.functions";
import { runFinalQC, assignResumeVariant } from "./qc-gate";
import { freshnessBucket } from "./freshness";
import { QuotaExhaustedError, RateLimitExhaustedError } from "./openai-fetch";
import { enqueueRetryRow } from "./retry-queue.functions";

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
        per_ats_daily_cap: settings?.per_ats_daily_cap ?? 50,
        company_cooldown_days: settings?.company_cooldown_days ?? 30,
      },
    };
  });

// ----- Run Smart-Apply daily batch ----- //
export const runSmartApply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    batch_size: z.number().int().min(1).max(50).optional(),
  }).optional().parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const batchSize = data?.batch_size ?? 5;
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
    const autoCap = s.auto_review_daily_cap ?? 5;
    const packetCap = s.packet_daily_cap ?? 25;
    const globalAtsCap = s.per_ats_daily_cap ?? 50;
    const atsCapMap: Record<string, number> = {
      Greenhouse: 50, Lever: 50, Ashby: 50, Breezy: 50, Workday: 30, other: 25,
      ...(s.per_ats_caps ?? {}),
    };
    const capFor = (ats: string) => atsCapMap[ats] ?? atsCapMap.other ?? globalAtsCap;
    const cooldownDays = s.company_cooldown_days ?? 30;
    const mode: "manual_review" | "auto_review" = s.application_mode ?? "manual_review";

    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const cutoff = new Date(Date.now() - AUTO_GATES.freshDays * 86400000).toISOString();
    const cooldownCutoff = new Date(Date.now() - cooldownDays * 86400000).toISOString();

    // Safe Auto-Submit configuration (OFF by default)
    // Real submission requires: enabled AND dry-run mode OFF AND a prior passing dry run.
    const dryRunMode = s.safe_auto_submit_dry_run !== false;
    const dryRunPassedAt = s.safe_auto_submit_dry_run_passed_at;
    const dryRunFresh = !!dryRunPassedAt &&
      (Date.now() - new Date(dryRunPassedAt).getTime()) <= 24 * 3600 * 1000;
    const dryRunReport = s.safe_auto_submit_dry_run_report ?? null;
    const dryRunNoBlocks = !dryRunReport || (dryRunReport.blocked ?? 0) === 0;
    const realConfirmedAt = s.safe_auto_submit_confirmed_at;
    const realConfirmFresh = !!realConfirmedAt &&
      (Date.now() - new Date(realConfirmedAt).getTime()) <= 24 * 3600 * 1000;
    const realSubmitAllowed = !!s.safe_auto_submit_enabled && !dryRunMode &&
      dryRunFresh && dryRunNoBlocks && realConfirmFresh;
    const safeSubmitEnabled = !!s.safe_auto_submit_enabled;
    const safeSubmitDailyCap = s.safe_auto_submit_daily_cap ?? 3;
    const safeSubmitPerAtsCap = 2;
    const safeAtsAllowed = new Set(["Greenhouse", "Lever", "Ashby", "Breezy"]);
    const { count: autoSubmittedToday } = await (supabase as any)
      .from("applications").select("id", { count: "exact", head: true })
      .eq("user_id", userId).eq("status", "submitted_automatically")
      .gte("auto_submitted_at", startOfDay.toISOString());
    let safeSubmittedSoFar = autoSubmittedToday ?? 0;
    const safeAtsCounts = new Map<string, number>();

    // Limit to the user-selected batch size (default 5) so bulk runs do not
    // hammer OpenAI in a single pass. Remaining jobs stay in the pipeline
    // and get picked up on the next Run.
    const { data: jobs } = await (supabase as any).from("job_listings")
      .select("*, companies(*)")
      .eq("user_id", userId)
      .gte("posted_at", cutoff)
      .order("interview_probability", { ascending: false })
      .limit(Math.max(1, Math.min(50, batchSize)));

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
    let quotaExhausted = false; // set when OpenAI returns insufficient_quota
    let rateLimitedQueued = 0;  // jobs sent to needs_review after retries exhausted
    let cacheHits = 0;
    // Detailed routing counters
    let packet_attempted = 0, packet_failed = 0, scored = 0;
    let rejected_by_scoring = 0, rejected_by_qc = 0;
    let fallback_unresolved = 0;
    const rejectReasons = new Map<string, number>();
    const manualReasons = new Map<string, number>();
    const routingFailures = new Map<string, number>();
    const processedJobIds: string[] = [];
    const bestFit: Array<{ title: string; company: string; interview: number }> = [];
    const generateFn = (data: any) => generatePacket({ data });

    const scanned = (jobs ?? []).length;
    const cutoffMs = Date.now() - AUTO_GATES.freshDays * 86400000;
    const freshImported = (jobs ?? []).filter((j: any) =>
      j.posted_at && new Date(j.posted_at).getTime() >= cutoffMs).length;

    // Ensure an application row exists so subsequent .update() calls take effect.
    const ensureApp = async (job: any, initialStatus = "manual_review") => {
      const { data: exists } = await (supabase as any).from("applications")
        .select("id").eq("user_id", userId).eq("job_id", job.id).maybeSingle();
      if (!exists) {
        await (supabase as any).from("applications").insert({
          user_id: userId, job_id: job.id, status: initialStatus, priority: "manual",
        });
      }
    };
    const trackFailure = (reason: string) =>
      routingFailures.set(reason, (routingFailures.get(reason) ?? 0) + 1);

    for (const j of jobs ?? []) {
      processedJobIds.push(j.id);
      if (prepared >= packetCap) { skipped++; trackFailure("packet_cap_reached"); continue; }
      if (mode === "auto_review" && approved >= autoCap) { skipped++; trackFailure("auto_cap_reached"); continue; }

      const ats = j.ats ?? "";
      const perAtsCap = capFor(ats);
      if ((atsCounts.get(ats) ?? 0) >= perAtsCap) {
        // Preserve the job by parking the application in `skipped_cap` so it
        // remains visible in the Skipped / Capped tab and can be reviewed.
        await ensureApp(j, "manual_review");
        await (supabase as any).from("applications").update({
          status: "skipped_cap", priority: "manual",
          notes: `Per-ATS cap reached (${perAtsCap}/day for ${ats}) — Review Anyway to re-queue`,
        }).eq("user_id", userId).eq("job_id", j.id);
        await log({
          job_id: j.id, job_title: j.title, company_name: j.company_name, ats,
          action: "skipped", reason: `Per-ATS cap reached (${perAtsCap}/day for ${ats})`, gates: {},
        });
        skipped++; trackFailure("per_ats_cap"); continue;
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

      // Always create an application row so routing is observable.
      await ensureApp(j, "manual_review");

      // If a prior job exhausted OpenAI quota, do not call AI again — queue this job for later.
      if (quotaExhausted) {
        rateLimitedQueued++;
        trackFailure("queued_quota_exhausted");
        manualReasons.set("queued_quota_exhausted", (manualReasons.get("queued_quota_exhausted") ?? 0) + 1);
        await (supabase as any).from("applications").update({
          status: "manual_review", priority: "manual",
          notes: "[queued] AI quota/rate limit reached. Remaining jobs are safely queued and can be retried later.",
        }).eq("user_id", userId).eq("job_id", j.id);
        await log({
          job_id: j.id, job_title: j.title, company_name: j.company_name, ats,
          action: "prepared",
          reason: "Queued — AI quota/rate limit reached; will retry on next run.",
          gates: { queue_state: "queued" },
        });
        continue;
      }

      let packet: any;
      packet_attempted++;
      try {
        console.log(`[smart-apply] packet start job=${j.id} (${j.company_name})`);
        packet = await generateFn({ job_id: j.id });
        prepared++;
      } catch (e: any) {
        packet_failed++;
        if (e instanceof QuotaExhaustedError) {
          quotaExhausted = true;
          rateLimitedQueued++;
          const reason = "Rate limit reached after retries — queued for manual review.";
          trackFailure("quota_exhausted");
          manualReasons.set("quota_exhausted", (manualReasons.get("quota_exhausted") ?? 0) + 1);
          await (supabase as any).from("applications").update({
            status: "manual_review", priority: "manual",
            notes: `[needs_review] ${reason}`,
          }).eq("user_id", userId).eq("job_id", j.id);
          await log({
            job_id: j.id, job_title: j.title, company_name: j.company_name, ats,
            action: "prepared", reason, gates: { queue_state: "needs_review", cause: "quota_exhausted" },
          });
          continue;
        }
        if (e instanceof RateLimitExhaustedError) {
          rateLimitedQueued++;
          const reason = "Rate limit reached after retries — queued for manual review.";
          trackFailure("rate_limit_exhausted");
          manualReasons.set("rate_limit_exhausted", (manualReasons.get("rate_limit_exhausted") ?? 0) + 1);
          await (supabase as any).from("applications").update({
            status: "manual_review", priority: "manual",
            notes: `[needs_review] ${reason}`,
          }).eq("user_id", userId).eq("job_id", j.id);
          await log({
            job_id: j.id, job_title: j.title, company_name: j.company_name, ats,
            action: "prepared", reason, gates: { queue_state: "needs_review", cause: "rate_limit_exhausted", attempts: e.attempts },
          });
          continue;
        }
        const reason = `Packet generation failed: ${e.message?.slice(0, 200)}`;
        trackFailure("packet_generation_failed");
        manualReasons.set("packet_generation_failed", (manualReasons.get("packet_generation_failed") ?? 0) + 1);
        await (supabase as any).from("applications").update({
          status: "manual_review", priority: "manual",
          notes: reason,
        }).eq("user_id", userId).eq("job_id", j.id);
        await log({
          job_id: j.id, job_title: j.title, company_name: j.company_name, ats,
          action: "prepared", reason, gates: {},
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
      scored++;

      const detection = [
        atsCheck?.has_captcha && "captcha",
        atsCheck?.has_mfa && "mfa",
        atsCheck?.requires_login && "login_required",
      ].filter(Boolean) as string[];

      evaluated++;
      const liveRate = evaluated >= 5 ? approved / evaluated : 0;
      if (mode === "auto_review" && liveRate > AUTO_GATES.passRateCap) {
        guardTripped = true;
      }

      bestFit.push({
        title: j.title, company: j.company_name,
        interview: j.interview_probability ?? 0,
      });

      if (detection.length > 0) {
        await (supabase as any).from("applications").update({
          status: "safety_blocked", priority: "manual",
          notes: `Safety blocked: ${detection.join(", ")}`,
        }).eq("user_id", userId).eq("job_id", j.id);
        await log({
          job_id: j.id, job_title: j.title, company_name: j.company_name, ats,
          action: "safety_blocked",
          reason: `Detection signals: ${detection.join(", ")} — Manual Review. No retry.`,
          gates: { detection, ...review },
        });
        blocked++;
        trackFailure(`safety:${detection[0]}`);
      } else if (review.decision === "reject") {
        for (const r of review.rejected_for) {
          rejectReasons.set(r, (rejectReasons.get(r) ?? 0) + 1);
          trackFailure(`reject:${r}`);
        }
        rejected_by_scoring++;
        await (supabase as any).from("applications").update({
          status: "rejected", priority: "manual",
          notes: `Hard reject: ${review.rejected_for.join("; ")}`,
        }).eq("user_id", userId).eq("job_id", j.id);
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
        const qc = runFinalQC({
          job: j, company: j.companies, packet,
          resume_id: (packet as any).resume?.resume_id ?? (packet as any).resume_id ?? null,
          cover_id: (packet as any).cover?.cover_id ?? (packet as any).cover_id ?? null,
        });
        const variantKey = assignResumeVariant(j.role_category, j.title);
        const bucket = freshnessBucket(j.posted_at);
        if (!qc.passed) {
          rejected_by_qc++;
          for (const f of qc.failures) {
            manualReasons.set(f, (manualReasons.get(f) ?? 0) + 1);
            trackFailure(`qc:${f}`);
          }
          await (supabase as any).from("applications").update({
            status: "manual_review", priority: "manual",
            qc_passed: false, qc_failures: qc.failures,
            resume_variant_key: variantKey, freshness_bucket: bucket,
            notes: `QC failed: ${qc.failures.slice(0, 3).join("; ")}`,
          }).eq("user_id", userId).eq("job_id", j.id);
          await log({
            job_id: j.id, job_title: j.title, company_name: j.company_name, ats,
            action: "prepared",
            reason: `Final QC failed → Manual Review: ${qc.failures.join(", ")}`,
            gates: { ...review, qc_failures: qc.failures },
          });
          atsCounts.set(ats, (atsCounts.get(ats) ?? 0) + 1);
        } else {
          await (supabase as any).from("applications").update({
            status: "approved", priority: "high",
            qc_passed: true, qc_failures: [],
            resume_variant_key: variantKey, freshness_bucket: bucket,
            notes: `Auto-approved · quality ${packet.quality?.score} · QC clean`,
          }).eq("user_id", userId).eq("job_id", j.id);
          await log({
            job_id: j.id, job_title: j.title, company_name: j.company_name, ats,
            action: "auto_approved",
            reason: `All gates + QC passed · quality ${packet.quality?.score} · ${confidenceLabel(packet.quality?.score ?? 0)}`,
            gates: { ...review, qc: "passed" },
          });
          approved++;
          atsCounts.set(ats, (atsCounts.get(ats) ?? 0) + 1);

          // ===== Safe Auto-Submit evaluation =====
          if (safeSubmitEnabled) {
            const trustScore = j.companies?.trust_score ?? 0;
            const interviewProb = j.interview_probability ?? 0;
            const qualityScore = packet.quality?.score ?? 0;
            const salaryOk = j.salary_gate_status === "pass";
            const postedFresh = j.posted_at &&
              (Date.now() - new Date(j.posted_at).getTime()) <= 14 * 86400000;
            const atsOk = safeAtsAllowed.has(ats);
            const detectionClean = !atsCheck?.has_captcha && !atsCheck?.has_mfa && !atsCheck?.requires_login;
            const safeAtsCount = safeAtsCounts.get(ats) ?? 0;

            const safeFailed: string[] = [];
            if (trustScore < 95) safeFailed.push(`trust<95(${trustScore})`);
            if (interviewProb < 92) safeFailed.push(`interview<92(${interviewProb})`);
            if (qualityScore < 92) safeFailed.push(`quality<92(${qualityScore})`);
            if (!salaryOk) safeFailed.push(`salary_gate_${j.salary_gate_status}`);
            if (!postedFresh) safeFailed.push("not_fresh_14d");
            if (!atsOk) safeFailed.push(`ats_unsupported(${ats})`);
            if (!detectionClean) safeFailed.push("detection_signals");
            if (duplicate) safeFailed.push("duplicate");
            if (recentCompany) safeFailed.push("company_cooldown");
            if (safeSubmittedSoFar >= safeSubmitDailyCap) safeFailed.push(`daily_cap(${safeSubmitDailyCap})`);
            if (safeAtsCount >= safeSubmitPerAtsCap) safeFailed.push(`per_ats_cap(${safeSubmitPerAtsCap})`);

            if (safeFailed.length === 0 && realSubmitAllowed) {
              // All Safe Auto-Submit gates passed — record as submitted_automatically
              const submitTime = new Date().toISOString();
              const followUpAt = new Date(Date.now() + 7 * 86400000).toISOString();
              await (supabase as any).from("applications").update({
                status: "submitted_automatically",
                submitted_at: submitTime,
                auto_submitted_at: submitTime,
                auto_submit_result: "submitted",
                application_url: j.source_url,
                follow_up_due_at: followUpAt,
                submission_notes: `Safe Auto-Submit · trust ${trustScore} · interview ${interviewProb} · quality ${qualityScore} · ${ats}`,
              }).eq("user_id", userId).eq("job_id", j.id);
              await log({
                job_id: j.id, job_title: j.title, company_name: j.company_name, ats,
                action: "auto_approved",
                reason: `Safe Auto-Submit success · ${ats} · trust ${trustScore}`,
                gates: {
                  safe_auto_submit: "submitted",
                  resume_variant: variantKey,
                  application_url: j.source_url,
                  submit_time: submitTime,
                  trust: trustScore, interview: interviewProb, quality: qualityScore,
                },
              });
              safeSubmittedSoFar++;
              safeAtsCounts.set(ats, safeAtsCount + 1);

              if (s.sms_enabled && (s.sms_notify_auto_mode ?? true)) {
                await sendSmsInternal({
                  supabase, userId,
                  to: s.phone_number || process.env.USER_PHONE_NUMBER,
                  body: `Safe Auto-Submit: ${j.title} @ ${j.company_name} (${ats}). Follow-up scheduled in 7d.`,
                  kind: "auto_submit",
                });
              }
            } else if (safeFailed.length === 0 && !realSubmitAllowed) {
              // Dry-run mode or no prior passing dry run — simulate only, no submission.
              const dryReason = dryRunMode
                ? "dry_run_mode_on"
                : (!dryRunFresh ? "dry_run_stale_>24h"
                  : (!dryRunNoBlocks ? "dry_run_has_blocks"
                    : (!realConfirmFresh ? "user_confirmation_required" : "real_submit_disabled")));
              await (supabase as any).from("applications").update({
                auto_submit_result: `dry_run:${dryReason}`,
              }).eq("user_id", userId).eq("job_id", j.id);
              await log({
                job_id: j.id, job_title: j.title, company_name: j.company_name, ats,
                action: "auto_approved",
                reason: `Safe Auto-Submit DRY RUN · all gates passed · ${dryReason} · no submission`,
                gates: { safe_auto_submit: "dry_run", trust: trustScore, interview: interviewProb, quality: qualityScore },
              });
            } else {
              // Gates failed — leave as approved (Manual Review fallback for actual click)
              await (supabase as any).from("applications").update({
                auto_submit_result: `gates_failed:${safeFailed.slice(0,3).join(",")}`,
              }).eq("user_id", userId).eq("job_id", j.id);
            }
          }
        }
      } else {
        let note: string;
        if (guardTripped) note = `Pass-rate guard tripped (>${Math.round(AUTO_GATES.passRateCap*100)}%) — sent to Manual Review`;
        else if (mode === "auto_review" && fridayPrepareOnly) note = "Friday prepare-only — Manual Review required";
        else if (mode === "auto_review") note = `Failed gates: ${review.failed.join(", ")}`;
        else note = "Manual Review mode — packet ready for approval";
        for (const r of review.failed) {
          manualReasons.set(r, (manualReasons.get(r) ?? 0) + 1);
          trackFailure(`manual:${r}`);
        }
        if (review.failed.length === 0) trackFailure("manual:mode_default");
        await (supabase as any).from("applications").update({
          status: "manual_review", priority: "manual",
          notes: note,
        }).eq("user_id", userId).eq("job_id", j.id);
        await log({
          job_id: j.id, job_title: j.title, company_name: j.company_name, ats,
          action: "prepared", reason: note, gates: review,
        });
        atsCounts.set(ats, (atsCounts.get(ats) ?? 0) + 1);
      }
    }

    // Fallback: if scan found jobs but nothing got routed, force-assign
    // every processed job to Manual Review so nothing is left in limbo.
    if (scanned > 0 && approved === 0 && blocked === 0 && rejected === 0 &&
        (prepared - approved) === 0 && processedJobIds.length > 0) {
      for (const jid of processedJobIds) {
        await ensureApp({ id: jid }, "manual_review");
        await (supabase as any).from("applications").update({
          status: "manual_review", priority: "manual",
          notes: "routing_unresolved — forced to Manual Review by fallback",
        }).eq("user_id", userId).eq("job_id", jid);
        await log({
          job_id: jid, action: "prepared",
          reason: "routing_unresolved — fallback to Manual Review", gates: {},
        });
        fallback_unresolved++;
      }
      manualReasons.set("routing_unresolved", fallback_unresolved);
      trackFailure("routing_unresolved");
      prepared += fallback_unresolved;
    }

    // Build daily summary
    const topReasons = (m: Map<string, number>) =>
      [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([reason, count]) => ({ reason, count }));

    const passRate = evaluated > 0 ? +(approved / evaluated).toFixed(3) : 0;

    // Follow-ups due (next 24h)
    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    const { count: followUpsDue } = await (supabase as any).from("applications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId).lte("follow_up_due_at", tomorrow).not("follow_up_due_at", "is", null);

    // OpenAI usage today
    const { data: usageToday } = await (supabase as any).from("openai_usage")
      .select("estimated_cost_cents")
      .eq("user_id", userId).gte("created_at", startOfDay.toISOString());
    const openaiGenerations = usageToday?.length ?? 0;
    const openaiCostCents = (usageToday ?? []).reduce((a: number, r: any) => a + Number(r.estimated_cost_cents ?? 0), 0);

    const topCompanies = [...bestFit]
      .sort((a, b) => b.interview - a.interview).slice(0, 5);

    const summary = {
      jobs_scanned: scanned,
      fresh_imported: freshImported,
      auto_reviewed: approved,
      manual_review: prepared - approved,
      safety_blocked: blocked,
      auto_submitted: safeSubmittedSoFar,
      safe_auto_submit_enabled: safeSubmitEnabled,
      safe_auto_submit_remaining: Math.max(0, safeSubmitDailyCap - safeSubmittedSoFar),
      rejected,
      duplicates_skipped: skipped,
      scored,
      packet_attempted,
      packet_failed,
      rejected_by_scoring,
      rejected_by_qc,
      fallback_unresolved,
      top_routing_failure: [...routingFailures.entries()]
        .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      top_routing_failures: topReasons(routingFailures),
      top_rejection_reasons: topReasons(rejectReasons),
      top_manual_reasons: topReasons(manualReasons),
      best_fit_roles: topCompanies,
      follow_ups_due: followUpsDue ?? 0,
      openai_generations: openaiGenerations,
      openai_cost_cents: +openaiCostCents.toFixed(2),
      pass_rate: passRate,
      mode, fridayPrepareOnly, guardTripped,
      batch_size: batchSize,
      quota_exhausted: quotaExhausted,
      rate_limited_queued: rateLimitedQueued,
    };

    // Send completion SMS (best-effort, never throws)
    let smsResult: any = { ok: false, status: "skipped:disabled" };
    if (s.sms_enabled && (s.sms_notify_batch_complete ?? true)) {
      const body = `Smart Apply complete: ${scanned} scanned, ${freshImported} imported, ${approved} auto-reviewed, ${prepared - approved} manual, ${blocked} safety-blocked. Pass rate ${(passRate * 100).toFixed(1)}%. Review dashboard.`;
      smsResult = await sendSmsInternal({
        supabase, userId,
        to: s.phone_number || process.env.USER_PHONE_NUMBER,
        body, kind: "batch_complete",
      });
    }

    return {
      ok: true, processed: prepared, approved, blocked, rejected, skipped,
      mode, fridayPrepareOnly, guardTripped, pass_rate: passRate,
      summary, sms: smsResult,
    };
  });

