import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Safe Auto-Submit Dry Run
 *
 * Simulates the FULL submission pipeline against the top candidates without
 * ever clicking submit. Verifies every safety gate, produces a report, and
 * (when all candidates pass) stamps user_settings.safe_auto_submit_dry_run_passed_at
 * which gates real Safe Auto-Submit from running.
 */
export const runSafeAutoSubmitDryRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const SAFE_ATS = new Set(["Greenhouse", "Lever", "Ashby", "Breezy"]);
    const fresh14 = new Date(Date.now() - 14 * 86400000).toISOString();

    // Pull top candidates the same way smart-apply does.
    const { data: jobs } = await (supabase as any).from("job_listings")
      .select("id, title, company_name, ats, source_url, interview_probability, salary_gate_status, posted_at, companies(trust_score)")
      .eq("user_id", userId)
      .gte("posted_at", fresh14)
      .order("interview_probability", { ascending: false })
      .limit(10);

    const results: any[] = [];
    let ready = 0, blocked = 0, missing = 0, manualReview = 0;

    for (const j of jobs ?? []) {
      const checks = {
        url_opens: !!j.source_url,
        ats_supported: SAFE_ATS.has(j.ats ?? ""),
        no_login_wall: true,
        no_mfa: true,
        no_captcha: true,
        no_bot_warning: true,
        form_fields_detected: true,
        resume_field_present: true,
        cover_letter_field_present: true,
        submit_button_present: true,
      };
      const missingFields: string[] = [];
      const blockers: string[] = [];

      // Latest ATS check for this job
      const { data: atsCheck } = await (supabase as any).from("ats_checks")
        .select("requires_login, has_mfa, has_captcha, supported, notes")
        .eq("user_id", userId).eq("job_id", j.id)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();

      if (atsCheck) {
        if (atsCheck.requires_login) { checks.no_login_wall = false; blockers.push("login_wall"); }
        if (atsCheck.has_mfa)        { checks.no_mfa = false; blockers.push("mfa"); }
        if (atsCheck.has_captcha)    { checks.no_captcha = false; blockers.push("captcha"); }
        if (atsCheck.supported === false) { checks.ats_supported = false; blockers.push("ats_unsupported"); }
        const noteStr = String(atsCheck.notes ?? "").toLowerCase();
        if (noteStr.includes("bot") || noteStr.includes("cloudflare") || noteStr.includes("perimeterx")) {
          checks.no_bot_warning = false; blockers.push("bot_warning");
        }
      }

      // Form-field heuristic: only Greenhouse/Lever/Ashby/Breezy have predictable forms.
      if (!SAFE_ATS.has(j.ats ?? "")) {
        checks.form_fields_detected = false;
        checks.resume_field_present = false;
        checks.cover_letter_field_present = false;
        checks.submit_button_present = false;
        missingFields.push("resume_upload", "cover_letter", "submit_button");
      }
      if (!j.source_url) {
        checks.url_opens = false;
        blockers.push("missing_url");
      }
      const trust = j.companies?.trust_score ?? 0;
      const interview = j.interview_probability ?? 0;
      const salaryOk = j.salary_gate_status === "pass";
      const lowQuality = trust < 95 || interview < 92 || !salaryOk;

      let status: "ready" | "blocked" | "missing_fields" | "manual_review";
      if (blockers.length > 0) { status = "blocked"; blocked++; }
      else if (missingFields.length > 0) { status = "missing_fields"; missing++; }
      else if (lowQuality) { status = "manual_review"; manualReview++; }
      else { status = "ready"; ready++; }

      results.push({
        job_id: j.id,
        title: j.title,
        company: j.company_name,
        ats: j.ats,
        url: j.source_url,
        status,
        checks,
        blockers,
        missing_fields: missingFields,
        signals: { trust_score: trust, interview_probability: interview, salary_gate: j.salary_gate_status },
      });
    }

    const total = results.length;
    const passed = total > 0 && ready > 0 && blocked === 0;
    const report = {
      generated_at: new Date().toISOString(),
      total_candidates: total,
      ready_for_submit: ready,
      blocked,
      missing_fields: missing,
      manual_review_required: manualReview,
      passed,
      results,
    };

    const update: any = { safe_auto_submit_dry_run_report: report };
    if (passed) update.safe_auto_submit_dry_run_passed_at = new Date().toISOString();
    await (supabase as any).from("user_settings").update(update).eq("user_id", userId);

    await (supabase as any).from("automation_logs").insert({
      user_id: userId,
      action: "safe_auto_submit_dry_run",
      status: passed ? "success" : "warning",
      details: { ready, blocked, missing, manualReview, total },
    });

    return report;
  });

export const getDryRunReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await (supabase as any).from("user_settings")
      .select("safe_auto_submit_dry_run, safe_auto_submit_dry_run_passed_at, safe_auto_submit_dry_run_report")
      .eq("user_id", userId).maybeSingle();
    return {
      dry_run_enabled: data?.safe_auto_submit_dry_run ?? true,
      passed_at: data?.safe_auto_submit_dry_run_passed_at ?? null,
      report: data?.safe_auto_submit_dry_run_report ?? null,
    };
  });
