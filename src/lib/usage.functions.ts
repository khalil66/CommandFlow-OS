import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const DAILY_RESUME_CAP = 25;
export const DAILY_COVER_CAP = 25;

function startOfToday() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export const getUsageToday = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const since = startOfToday();
    const { data, error } = await context.supabase
      .from("openai_usage")
      .select("kind, success, estimated_cost_cents, match_score, resume_version_id, created_at")
      .eq("user_id", context.userId)
      .gte("created_at", since);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    const resume = rows.filter((r: any) => r.kind === "resume" && r.success).length;
    const cover = rows.filter((r: any) => r.kind === "cover_letter" && r.success).length;
    const failed = rows.filter((r: any) => !r.success).length;
    const cost = rows.reduce((s: number, r: any) => s + Number(r.estimated_cost_cents ?? 0), 0);
    return {
      daily_resume_generations: resume,
      daily_cover_letter_generations: cover,
      resume_remaining: Math.max(0, DAILY_RESUME_CAP - resume),
      cover_remaining: Math.max(0, DAILY_COVER_CAP - cover),
      resume_cap: DAILY_RESUME_CAP,
      cover_cap: DAILY_COVER_CAP,
      failed_today: failed,
      estimated_cost_cents: Math.round(cost * 100) / 100,
    };
  });

export const getUsageAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: today } = await context.supabase
      .from("openai_usage")
      .select("kind, success, estimated_cost_cents")
      .eq("user_id", context.userId)
      .gte("created_at", startOfToday());
    const { data: best } = await context.supabase
      .from("resume_versions")
      .select("id, label, target_role, match_score, created_at")
      .eq("user_id", context.userId)
      .order("match_score", { ascending: false })
      .limit(5);
    const { data: failures } = await context.supabase
      .from("openai_usage")
      .select("created_at, kind, error")
      .eq("user_id", context.userId)
      .eq("success", false)
      .order("created_at", { ascending: false })
      .limit(10);

    const t = today ?? [];
    return {
      generations_today: t.filter((r: any) => r.success).length,
      failed_today: t.filter((r: any) => !r.success).length,
      estimated_cost_cents: Math.round(t.reduce((s: number, r: any) => s + Number(r.estimated_cost_cents ?? 0), 0) * 100) / 100,
      best_resumes: best ?? [],
      recent_failures: failures ?? [],
    };
  });
