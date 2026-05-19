import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { RESUME_VARIANTS, variantLabel } from "./resume-variants";

function pct(n: number, d: number) {
  if (!d) return 0;
  return Math.round((n / d) * 1000) / 10;
}

// Aggregates a single executive snapshot. Never returns PII (no recruiter
// emails, no candidate notes, no raw application URLs).
export const getExecutiveSnapshot = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const todayIso = new Date(); todayIso.setHours(0, 0, 0, 0);
    const sinceWeek = new Date(); sinceWeek.setDate(sinceWeek.getDate() - 7);

    const [appsRes, jobsRes] = await Promise.all([
      supabase
        .from("applications")
        .select("id,status,resume_variant_key,response_received_at,interview_requested_at,offer_at,rejected_at,ghosted_at,submitted_at,created_at,updated_at")
        .eq("user_id", userId),
      supabase
        .from("job_listings")
        .select("id,ats,role_category,category,interview_probability,status,created_at")
        .eq("user_id", userId),
    ]);
    if (appsRes.error) throw appsRes.error;
    if (jobsRes.error) throw jobsRes.error;
    const apps = appsRes.data ?? [];
    const jobs = jobsRes.data ?? [];

    const submittedToday = apps.filter(
      (a) => a.submitted_at && new Date(a.submitted_at) >= todayIso,
    ).length;

    const submittedCount = apps.filter(
      (a) => a.submitted_at || ["submitted", "submitted_manually", "interview_requested", "interview", "rejected", "ghosted", "offer"].includes(a.status),
    ).length;
    const repliesCount = apps.filter(
      (a) => a.response_received_at || a.interview_requested_at || a.offer_at || a.rejected_at,
    ).length;
    const interviewsCount = apps.filter(
      (a) => a.interview_requested_at || a.status === "interview" || a.offer_at,
    ).length;
    const offersCount = apps.filter((a) => a.offer_at || a.status === "offer").length;
    const queueBacklog = jobs.filter((j) => j.status === "new" || j.status === "ready").length;

    // ATS performance
    const byAts = new Map<string, { apps: number; replies: number }>();
    for (const a of apps) {
      const job = jobs.find((j) => false); // not joined; aggregate via jobs only
      void job;
    }
    const atsCounts = new Map<string, number>();
    for (const j of jobs) {
      const k = j.ats || "unknown";
      atsCounts.set(k, (atsCounts.get(k) ?? 0) + 1);
    }
    const topAts = [...atsCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";

    // Variant performance
    const variantStats = new Map<string, { apps: number; replies: number; interviews: number }>();
    for (const v of RESUME_VARIANTS) variantStats.set(v.key, { apps: 0, replies: 0, interviews: 0 });
    variantStats.set("generic", { apps: 0, replies: 0, interviews: 0 });
    for (const a of apps) {
      const k = a.resume_variant_key || "generic";
      if (!variantStats.has(k)) variantStats.set(k, { apps: 0, replies: 0, interviews: 0 });
      const s = variantStats.get(k)!;
      s.apps += 1;
      if (a.response_received_at || a.interview_requested_at || a.offer_at || a.rejected_at) s.replies += 1;
      if (a.interview_requested_at || a.status === "interview" || a.offer_at) s.interviews += 1;
    }
    let bestVariantKey = "—";
    let bestRate = -1;
    for (const [k, s] of variantStats.entries()) {
      if (s.apps < 3) continue;
      const r = s.interviews / s.apps;
      if (r > bestRate) { bestRate = r; bestVariantKey = k; }
    }

    // Category performance
    const catCounts = new Map<string, number>();
    for (const j of jobs) {
      const k = j.role_category || j.category || "other";
      catCounts.set(k, (catCounts.get(k) ?? 0) + 1);
    }
    const topCategory = [...catCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";

    const ipAvg = jobs.length
      ? Math.round(jobs.reduce((s, j) => s + (j.interview_probability ?? 0), 0) / jobs.length)
      : 0;

    // 7-day trend
    const dayMap = new Map<string, { responses: number; interviews: number }>();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      dayMap.set(key, { responses: 0, interviews: 0 });
    }
    for (const a of apps) {
      if (a.response_received_at) {
        const k = a.response_received_at.slice(0, 10);
        if (dayMap.has(k)) dayMap.get(k)!.responses += 1;
      }
      if (a.interview_requested_at) {
        const k = a.interview_requested_at.slice(0, 10);
        if (dayMap.has(k)) dayMap.get(k)!.interviews += 1;
      }
    }
    const trends = [...dayMap.entries()].map(([day, v]) => ({ day: day.slice(5), ...v }));

    // Live activity (safe fields only). Use automation_logs + safety logs.
    const { data: logs } = await supabase
      .from("automation_logs")
      .select("action,status,created_at")
      .eq("user_id", userId)
      .gte("created_at", sinceWeek.toISOString())
      .order("created_at", { ascending: false })
      .limit(25);
    const activity = (logs ?? []).map((l) => ({
      ts: new Date(l.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      kind: l.action,
      text: `${l.action.replace(/_/g, " ")} · ${l.status}`,
    }));

    // Funnel
    const funnel = [
      { label: "Imported", value: jobs.length },
      { label: "Approved", value: apps.length },
      { label: "Submitted", value: submittedCount },
      { label: "Recruiter Reply", value: repliesCount },
      { label: "Interview", value: interviewsCount },
      { label: "Offer", value: offersCount },
    ];

    // ATS breakdown table (apps per ATS via jobs)
    const atsRows = [...atsCounts.entries()]
      .map(([ats, count]) => ({ ats, jobs: count }))
      .sort((a, b) => b.jobs - a.jobs)
      .slice(0, 8);

    const catRows = [...catCounts.entries()]
      .map(([category, count]) => ({ category, jobs: count }))
      .sort((a, b) => b.jobs - a.jobs)
      .slice(0, 8);

    return {
      kpis: {
        applications_today: submittedToday,
        interview_probability_avg: ipAvg,
        recruiter_response_rate: pct(repliesCount, submittedCount),
        top_ats: topAts,
        best_variant: variantLabel(bestVariantKey),
        top_category: topCategory,
        queue_backlog: queueBacklog,
        interview_conversion: pct(interviewsCount, repliesCount),
      },
      funnel,
      ats_rows: atsRows,
      category_rows: catRows,
      trends,
      activity,
      recommendations: buildRecommendations({ submittedCount, repliesCount, interviewsCount, bestVariant: variantLabel(bestVariantKey), topAts, topCategory }),
    };
  });

function buildRecommendations(o: { submittedCount: number; repliesCount: number; interviewsCount: number; bestVariant: string; topAts: string; topCategory: string }) {
  const rec: { title: string; detail: string }[] = [];
  if (o.bestVariant && o.bestVariant !== "—") {
    rec.push({ title: `Lead with the ${o.bestVariant} variant`, detail: "Highest interview conversion across your tracked applications." });
  }
  if (o.topAts && o.topAts !== "—") {
    rec.push({ title: `Focus on ${o.topAts}`, detail: "Largest share of your active queue — keep weekly cadence here." });
  }
  if (o.topCategory && o.topCategory !== "—") {
    rec.push({ title: `Strongest category: ${o.topCategory}`, detail: "Concentrate net-new outreach here this week." });
  }
  if (o.submittedCount > 0 && o.repliesCount / o.submittedCount < 0.1) {
    rec.push({ title: "Reply rate is under 10%", detail: "Audit resume/keyword match and ATS spread; consider variant A/B test." });
  }
  if (o.repliesCount > 0 && o.interviewsCount / o.repliesCount < 0.3) {
    rec.push({ title: "Reply→interview conversion is low", detail: "Tighten recruiter screen prep — review interview brief talking points." });
  }
  return rec;
}
