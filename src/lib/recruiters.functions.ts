import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listRecruiters = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("recruiter_contacts")
      .select("*")
      .order("response_count", { ascending: false });
    if (error) throw new Error(error.message);
    return { recruiters: data ?? [] };
  });

export const upsertRecruiter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    id: z.string().uuid().optional(),
    name: z.string().min(1).max(200),
    title: z.string().max(200).optional().nullable(),
    email: z.string().email().optional().nullable(),
    company_id: z.string().uuid().optional().nullable(),
    company_name: z.string().max(200).optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.id) {
      const { id, ...rest } = data;
      const { data: row, error } = await (supabase as any)
        .from("recruiter_contacts").update(rest).eq("id", id).select().single();
      if (error) throw new Error(error.message);
      return { recruiter: row };
    }
    const { data: row, error } = await (supabase as any)
      .from("recruiter_contacts").insert({ ...data, user_id: userId }).select().single();
    if (error) throw new Error(error.message);
    return { recruiter: row };
  });

export const deleteRecruiter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("recruiter_contacts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getRecruiterStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: recs } = await context.supabase
      .from("recruiter_contacts").select("*");
    const list = recs ?? [];
    const totalContacted = list.reduce((s: number, r: any) => s + (r.contact_count ?? 0), 0);
    const totalResponses = list.reduce((s: number, r: any) => s + (r.response_count ?? 0), 0);
    const responseRate = totalContacted ? Math.round((totalResponses / totalContacted) * 100) : 0;

    // Best title
    const titleStats: Record<string, { contacted: number; responded: number }> = {};
    for (const r of list) {
      const t = (r as any).title || "Unknown";
      titleStats[t] = titleStats[t] || { contacted: 0, responded: 0 };
      titleStats[t].contacted += (r as any).contact_count ?? 0;
      titleStats[t].responded += (r as any).response_count ?? 0;
    }
    const bestTitle = Object.entries(titleStats)
      .filter(([_, v]) => v.contacted >= 1)
      .map(([k, v]) => ({ title: k, rate: v.responded / Math.max(v.contacted, 1), contacted: v.contacted }))
      .sort((a, b) => b.rate - a.rate)[0];

    return {
      total_recruiters: list.length,
      total_contacted: totalContacted,
      total_responses: totalResponses,
      response_rate: responseRate,
      best_title: bestTitle ? { title: bestTitle.title, rate: Math.round(bestTitle.rate * 100) } : null,
      top_recruiters: [...list]
        .sort((a: any, b: any) => (b.response_count ?? 0) - (a.response_count ?? 0))
        .slice(0, 10),
    };
  });
