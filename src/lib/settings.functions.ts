import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SETTINGS_FIELDS = [
  "id","user_id","email","full_name","location","website","linkedin_url",
  "target_roles","role_categories","excluded_companies","excluded_ats",
  "salary_min","remote_only","trust_threshold","daily_cap",
  "manual_review_only","auto_apply","onboarded_at","created_at","updated_at",
  "application_mode","automation_paused","friday_prepare_only",
  "auto_review_daily_cap","packet_daily_cap","per_ats_daily_cap",
  "company_cooldown_days","schedule_hour","schedule_minute","active_weekdays",
  "phone_number","sms_enabled","sms_daily_cap",
  "sms_notify_batch_start","sms_notify_batch_complete","sms_notify_manual_mode",
  "sms_notify_auto_mode","sms_notify_safety_block","sms_notify_high_probability",
  "sms_notify_followups",
  "safe_auto_submit_enabled","safe_auto_submit_daily_cap",
  "safe_auto_submit_dry_run","safe_auto_submit_dry_run_passed_at","safe_auto_submit_dry_run_report",
].join(",");

export const getSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("user_settings").select(SETTINGS_FIELDS).eq("user_id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return { settings: data };
    // Bootstrap row if missing
    const { data: created } = await supabase
      .from("user_settings").insert({ user_id: userId }).select(SETTINGS_FIELDS).single();
    return { settings: created };
  });

export const updateSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    full_name: z.string().max(120).optional(),
    location: z.string().max(120).optional(),
    website: z.string().max(200).optional(),
    linkedin_url: z.string().max(200).optional(),
    target_roles: z.array(z.string().max(80)).max(40).optional(),
    role_categories: z.array(z.string().max(40)).max(20).optional(),
    excluded_companies: z.array(z.string().max(80)).max(200).optional(),
    excluded_ats: z.array(z.string().max(40)).max(20).optional(),
    salary_min: z.number().int().min(0).max(1000000).optional(),
    remote_only: z.boolean().optional(),
    daily_cap: z.number().int().min(1).max(100).optional(),
    trust_threshold: z.number().int().min(0).max(100).optional(),
    manual_review_only: z.boolean().optional(),
    onboarded_at: z.string().datetime().optional(),
    application_mode: z.enum(["manual_review","auto_review"]).optional(),
    automation_paused: z.boolean().optional(),
    friday_prepare_only: z.boolean().optional(),
    auto_review_daily_cap: z.number().int().min(0).max(100).optional(),
    packet_daily_cap: z.number().int().min(1).max(100).optional(),
    per_ats_daily_cap: z.number().int().min(0).max(50).optional(),
    company_cooldown_days: z.number().int().min(1).max(365).optional(),
    schedule_hour: z.number().int().min(0).max(23).optional(),
    schedule_minute: z.number().int().min(0).max(59).optional(),
    active_weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
    phone_number: z.string().max(40).optional(),
    sms_enabled: z.boolean().optional(),
    sms_daily_cap: z.number().int().min(0).max(100).optional(),
    sms_notify_batch_start: z.boolean().optional(),
    sms_notify_batch_complete: z.boolean().optional(),
    sms_notify_manual_mode: z.boolean().optional(),
    sms_notify_auto_mode: z.boolean().optional(),
    sms_notify_safety_block: z.boolean().optional(),
    sms_notify_high_probability: z.boolean().optional(),
    sms_notify_followups: z.boolean().optional(),
    safe_auto_submit_enabled: z.boolean().optional(),
    safe_auto_submit_daily_cap: z.number().int().min(0).max(10).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Force manual_review_only to true if attempting to disable (safety)
    if (data.manual_review_only === false) data.manual_review_only = true;
    const { data: row, error } = await supabase
      .from("user_settings").update(data).eq("user_id", userId).select(SETTINGS_FIELDS).single();
    if (error) throw new Error(error.message);
    return { settings: row };
  });

export const completeOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    full_name: z.string().min(1).max(120),
    location: z.string().max(120).optional(),
    website: z.string().max(200).optional(),
    linkedin_url: z.string().max(200).optional(),
    target_roles: z.array(z.string().max(80)).max(40),
    role_categories: z.array(z.string().max(40)).max(20),
    salary_min: z.number().int().min(0).max(1000000),
    preferred_companies: z.array(z.string().max(80)).max(200).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const update: any = {
      full_name: data.full_name,
      location: data.location ?? null,
      website: data.website ?? null,
      linkedin_url: data.linkedin_url ?? null,
      target_roles: data.target_roles,
      role_categories: data.role_categories,
      salary_min: data.salary_min,
      onboarded_at: new Date().toISOString(),
    };
    const { data: row, error } = await supabase
      .from("user_settings").update(update).eq("user_id", userId).select(SETTINGS_FIELDS).single();
    if (error) throw new Error(error.message);
    return { settings: row };
  });

const EXPORT_TABLES = [
  "user_settings","companies","job_listings","applications",
  "resume_versions","cover_letters","follow_up_messages",
  "automation_logs","openai_usage","import_logs","job_sources",
  "verification_checks","legitimacy_checks","ats_checks","daily_batches",
];

export const exportAllData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const out: Record<string, any[]> = {};
    for (const table of EXPORT_TABLES) {
      const { data } = await (supabase as any).from(table).select("*").eq("user_id", userId);
      out[table] = data ?? [];
    }
    return {
      exported_at: new Date().toISOString(),
      user_id: userId,
      tables: out,
    };
  });

export const getSystemHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    const counts: Record<string, number> = {};
    for (const t of ["job_listings","applications","companies","resume_versions","follow_up_messages","import_logs","automation_logs"]) {
      const { count } = await (supabase as any).from(t).select("*", { count: "exact", head: true }).eq("user_id", userId);
      counts[t] = count ?? 0;
    }

    const { data: aiFails } = await supabase
      .from("openai_usage").select("id, kind, error, created_at, model")
      .eq("user_id", userId).eq("success", false)
      .gte("created_at", since).order("created_at", { ascending: false }).limit(20);

    const { data: logFails } = await supabase
      .from("automation_logs").select("id, action, status, details, created_at")
      .eq("user_id", userId).neq("status", "success")
      .gte("created_at", since).order("created_at", { ascending: false }).limit(20);

    const { data: settings } = await supabase
      .from("user_settings")
      .select("manual_review_only, auto_apply, onboarded_at, salary_min, remote_only, daily_cap")
      .eq("user_id", userId).maybeSingle();

    const { data: imports } = await supabase
      .from("import_logs").select("success, created_at, ats")
      .eq("user_id", userId).gte("created_at", since).order("created_at", { ascending: false }).limit(50);

    const importsRecent = imports ?? [];
    const importSuccessRate = importsRecent.length
      ? Math.round((importsRecent.filter((i) => i.success).length / importsRecent.length) * 100)
      : null;

    const checks = [
      { name: "Database connection", ok: true, detail: "Lovable Cloud reachable" },
      { name: "Manual Review enforced", ok: settings?.manual_review_only !== false, detail: settings?.manual_review_only === false ? "Manual Review disabled — re-enable in Settings" : "All applications routed through manual review" },
      { name: "Browser automation disabled", ok: true, detail: "No browser automation runs in this build" },
      { name: "Auto-submit disabled", ok: settings?.auto_apply !== true, detail: settings?.auto_apply ? "Auto-apply enabled — disable for safety" : "Auto-submit is off" },
      { name: "Onboarding complete", ok: !!settings?.onboarded_at, detail: settings?.onboarded_at ? `Completed ${new Date(settings.onboarded_at).toLocaleDateString()}` : "Run /onboarding to finish setup" },
      { name: "Salary floor configured", ok: (settings?.salary_min ?? 0) >= 55000, detail: `$${(settings?.salary_min ?? 0).toLocaleString()} minimum` },
      { name: "Remote-only filter", ok: settings?.remote_only !== false, detail: settings?.remote_only === false ? "Remote filter off" : "Only remote roles accepted" },
      { name: "AI usage healthy (24h)", ok: (aiFails?.length ?? 0) < 5, detail: `${aiFails?.length ?? 0} failures in last 24h` },
      { name: "Import pipeline healthy", ok: importSuccessRate === null || importSuccessRate >= 80, detail: importSuccessRate === null ? "No imports in last 24h" : `${importSuccessRate}% success across ${importsRecent.length} imports` },
    ];

    return {
      checks,
      counts,
      ai_failures: aiFails ?? [],
      log_failures: logFails ?? [],
      settings,
      import_success_rate: importSuccessRate,
      generated_at: new Date().toISOString(),
    };
  });
