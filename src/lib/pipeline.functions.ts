import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const PIPELINE_STAGES = [
  { key: "imported", label: "Imported" },
  { key: "reviewed", label: "Reviewed" },
  { key: "approved", label: "Approved" },
  { key: "submitted_manual", label: "Submitted Manually" },
  { key: "recruiter_screen", label: "Recruiter Screen" },
  { key: "technical_interview", label: "Technical Interview" },
  { key: "final_interview", label: "Final Interview" },
  { key: "offer", label: "Offer" },
  { key: "rejected", label: "Rejected" },
  { key: "archived", label: "Archived" },
] as const;

export type PipelineStage = typeof PIPELINE_STAGES[number]["key"];

export const getPipeline = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("applications")
      .select("id,status,notes,recruiter_notes,interview_notes,salary_expectation,next_action_at,next_action_label,recruiter_contact_id,job_id,updated_at,reviewed_at,approved_at,submitted_at,submitted_manual_at,recruiter_screen_at,technical_interview_at,final_interview_at,offer_at,rejected_at,archived_at,response_received_at,job_listings(title,company_name,ats,final_score,interview_probability)")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { applications: data ?? [] };
  });

export const updatePipelineFields = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    application_id: z.string().uuid(),
    recruiter_notes: z.string().max(5000).optional().nullable(),
    interview_notes: z.string().max(5000).optional().nullable(),
    salary_expectation: z.string().max(200).optional().nullable(),
    next_action_at: z.string().optional().nullable(),
    next_action_label: z.string().max(200).optional().nullable(),
    recruiter_contact_id: z.string().uuid().optional().nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { application_id, ...rest } = data;
    const updates: Record<string, any> = Object.fromEntries(Object.entries(rest).filter(([_, v]) => v !== undefined));
    const { data: row, error } = await (context.supabase as any)
      .from("applications").update(updates).eq("id", application_id).select().single();
    if (error) throw new Error(error.message);
    return { application: row };
  });

export const getPipelineMetrics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: apps } = await context.supabase
      .from("applications")
      .select("status,submitted_at,response_received_at,interview_requested_at,offer_at,resume_variant_key,job_listings(role_category,category)");

    const list = apps ?? [];
    const submitted = list.filter((a: any) => a.submitted_at);
    const responded = list.filter((a: any) => a.response_received_at);
    const interviewed = list.filter((a: any) => a.interview_requested_at);
    const offered = list.filter((a: any) => a.offer_at);

    // Avg time-to-response in hours
    const ttrHours: number[] = [];
    for (const a of submitted) {
      if (a.submitted_at && a.response_received_at) {
        const diff = (new Date(a.response_received_at as string).getTime() - new Date(a.submitted_at as string).getTime()) / 3.6e6;
        if (diff >= 0 && diff < 24 * 60) ttrHours.push(diff);
      }
    }
    const avg_response_hours = ttrHours.length ? Math.round(ttrHours.reduce((a, b) => a + b, 0) / ttrHours.length) : 0;

    // Best application window (day-of-week + hour of day)
    const windowCounts: Record<string, { sent: number; responded: number }> = {};
    for (const a of submitted) {
      const d = new Date(a.submitted_at as string);
      const k = `${d.getDay()}-${d.getHours()}`;
      windowCounts[k] = windowCounts[k] || { sent: 0, responded: 0 };
      windowCounts[k].sent++;
      if (a.response_received_at) windowCounts[k].responded++;
    }
    const bestWindow = Object.entries(windowCounts)
      .filter(([_, v]) => v.sent >= 2)
      .map(([k, v]) => ({ key: k, rate: v.responded / v.sent, sent: v.sent }))
      .sort((a, b) => b.rate - a.rate)[0];
    const best_application_window = bestWindow ? {
      label: (() => {
        const [dow, hour] = bestWindow.key.split("-").map(Number);
        const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
        return `${days[dow]} ${hour}:00`;
      })(),
      rate: Math.round(bestWindow.rate * 100),
    } : null;

    // Resume variant leader
    const variantStats: Record<string, { sent: number; interviewed: number }> = {};
    for (const a of submitted) {
      const k = a.resume_variant_key || "generic";
      variantStats[k] = variantStats[k] || { sent: 0, interviewed: 0 };
      variantStats[k].sent++;
      if (a.interview_requested_at) variantStats[k].interviewed++;
    }
    const variantLeader = Object.entries(variantStats)
      .filter(([_, v]) => v.sent >= 1)
      .map(([k, v]) => ({ key: k, rate: v.interviewed / v.sent, sent: v.sent }))
      .sort((a, b) => b.rate - a.rate)[0];
    const resume_variant_leader = variantLeader ? { key: variantLeader.key, rate: Math.round(variantLeader.rate * 100) } : null;

    // Best recruiter category — use role_category
    const catStats: Record<string, { sent: number; responded: number }> = {};
    for (const a of submitted) {
      const cat = (a as any).job_listings?.role_category || (a as any).job_listings?.category || "other";
      catStats[cat] = catStats[cat] || { sent: 0, responded: 0 };
      catStats[cat].sent++;
      if (a.response_received_at) catStats[cat].responded++;
    }
    const bestCat = Object.entries(catStats)
      .filter(([_, v]) => v.sent >= 1)
      .map(([k, v]) => ({ key: k, rate: v.responded / v.sent }))
      .sort((a, b) => b.rate - a.rate)[0];
    const best_recruiter_category = bestCat ? { key: bestCat.key, rate: Math.round(bestCat.rate * 100) } : null;

    return {
      avg_response_hours,
      best_application_window,
      resume_variant_leader,
      best_recruiter_category,
      interview_conversion_rate: submitted.length ? Math.round((interviewed.length / submitted.length) * 100) : 0,
      offer_conversion_rate: submitted.length ? Math.round((offered.length / submitted.length) * 100) : 0,
      counts: { submitted: submitted.length, responded: responded.length, interviewed: interviewed.length, offered: offered.length },
    };
  });

export const getResponseHeatmap = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("applications")
      .select("response_received_at,interview_requested_at")
      .or("response_received_at.not.is.null,interview_requested_at.not.is.null");

    // 7 days × 24 hours
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const r of data ?? []) {
      const ts = (r as any).response_received_at || (r as any).interview_requested_at;
      if (!ts) continue;
      const d = new Date(ts);
      grid[d.getDay()][d.getHours()]++;
    }
    return { grid };
  });
