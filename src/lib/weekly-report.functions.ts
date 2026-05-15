import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getWeeklyPerformance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const since = new Date(Date.now() - 7 * 86400000).toISOString();

    const [logsRes, appsRes, jobsRes, resumesRes, usageRes] = await Promise.all([
      (supabase as any).from("automation_safety_logs")
        .select("action, ats, company_name").eq("user_id", userId).gte("created_at", since),
      (supabase as any).from("applications")
        .select("id, status, submitted_at, resume_version_id, job_listings(company_name, ats, category, role_category, interview_probability)")
        .eq("user_id", userId).gte("created_at", since),
      (supabase as any).from("job_listings")
        .select("id, ats, category", { count: "exact" })
        .eq("user_id", userId).gte("created_at", since),
      (supabase as any).from("resume_versions")
        .select("id, label, match_score").eq("user_id", userId).gte("created_at", since),
      (supabase as any).from("openai_usage")
        .select("estimated_cost_cents, success").eq("user_id", userId).gte("created_at", since),
    ]);

    const logs = logsRes.data ?? [];
    const apps = appsRes.data ?? [];
    const resumes = resumesRes.data ?? [];
    const usage = usageRes.data ?? [];

    const tally = (arr: any[], key: (x: any) => string | undefined | null) => {
      const m = new Map<string, number>();
      for (const x of arr) {
        const k = key(x); if (!k) continue;
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return [...m.entries()].sort((a, b) => b[1] - a[1])
        .slice(0, 5).map(([name, value]) => ({ name, value }));
    };

    const submitted = apps.filter((a: any) => a.status === "submitted" || a.status === "interview" || a.submitted_at);
    const interviews = apps.filter((a: any) => a.status === "interview");
    const responseRate = submitted.length > 0
      ? +(interviews.length / submitted.length).toFixed(3) : 0;

    // Best resume version by interviews/match score
    const resumeStats = new Map<string, { label: string; interviews: number; apps: number; score: number }>();
    for (const a of apps) {
      const id = a.resume_version_id; if (!id) continue;
      const r = resumes.find((x: any) => x.id === id);
      const cur = resumeStats.get(id) ?? { label: r?.label ?? id.slice(0, 8), interviews: 0, apps: 0, score: r?.match_score ?? 0 };
      cur.apps += 1;
      if (a.status === "interview") cur.interviews += 1;
      resumeStats.set(id, cur);
    }
    const bestResume = [...resumeStats.values()].sort((a, b) => b.interviews - a.interviews || b.score - a.score)[0] ?? null;

    const recommendations: string[] = [];
    const autoApproved = logs.filter((l: any) => l.action === "auto_approved").length;
    const safetyBlocked = logs.filter((l: any) => l.action === "safety_blocked").length;
    const evaluated = autoApproved + logs.filter((l: any) => l.action === "prepared" || l.action === "rejected").length;
    const passRate = evaluated > 0 ? autoApproved / evaluated : 0;
    if (passRate > 0.15) recommendations.push("Auto-review pass rate is above 15% — tighten thresholds.");
    if (passRate < 0.03 && evaluated > 20) recommendations.push("Auto-review pass rate is very low — consider widening role categories.");
    if (safetyBlocked / Math.max(1, evaluated) > 0.05) recommendations.push("Safety-block rate above 5% — review ATS exclusions.");
    if (responseRate < 0.05 && submitted.length > 10) recommendations.push("Low response rate — try a different resume version or narrow target roles.");
    if (recommendations.length === 0) recommendations.push("Settings look healthy — keep current configuration.");

    return {
      window: { since, days: 7 },
      total_jobs_scanned: jobsRes.count ?? 0,
      packets_generated: logs.filter((l: any) => l.action === "prepared" || l.action === "auto_approved").length,
      applications_submitted: submitted.length,
      interviews_requested: interviews.length,
      response_rate: responseRate,
      best_resume: bestResume,
      best_company_category: tally(apps, (a) => a.job_listings?.category),
      best_ats_platform: tally(apps, (a) => a.job_listings?.ats),
      auto_approved: autoApproved,
      safety_blocked: safetyBlocked,
      pass_rate: +passRate.toFixed(3),
      openai_cost_cents: +usage.reduce((a: number, r: any) => a + Number(r.estimated_cost_cents ?? 0), 0).toFixed(2),
      openai_failures: usage.filter((r: any) => !r.success).length,
      recommendations,
    };
  });
