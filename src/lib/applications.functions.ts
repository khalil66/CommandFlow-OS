import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const STATUSES = ["queued","manual_review","approved","submitted","interview","rejected","offer","withdrawn"] as const;
const ACTIONS = ["save","tailor","approve","reject","submit","export","status_change","note"] as const;

async function logActivity(
  supabase: any, userId: string,
  action: typeof ACTIONS[number],
  payload: { application_id?: string | null; job_id?: string | null; status?: string; details?: any }
) {
  await supabase.from("automation_logs").insert({
    user_id: userId,
    action,
    status: payload.status ?? "success",
    application_id: payload.application_id ?? null,
    job_id: payload.job_id ?? null,
    details: payload.details ?? {},
  });
}

export const upsertApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    job_id: z.string().uuid(),
    status: z.enum(STATUSES).default("manual_review"),
    notes: z.string().optional(),
    resume_version_id: z.string().uuid().optional().nullable(),
    cover_letter_id: z.string().uuid().optional().nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing } = await supabase
      .from("applications").select("id").eq("job_id", data.job_id).maybeSingle();
    let row;
    if (existing) {
      const { data: r, error } = await supabase
        .from("applications").update({ ...data }).eq("id", existing.id).select().single();
      if (error) throw new Error(error.message);
      row = r;
    } else {
      const { data: r, error } = await supabase
        .from("applications").insert({ ...data, user_id: userId }).select().single();
      if (error) throw new Error(error.message);
      row = r;
    }
    await logActivity(supabase, userId, "save", {
      application_id: row.id, job_id: data.job_id, details: { status: data.status },
    });
    return { application: row };
  });

export const listApplications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("applications")
      .select("*, job_listings(title, company_name, ats, final_score, resume_match, legitimacy)")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { applications: data ?? [] };
  });

export const decideApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    application_id: z.string().uuid(),
    decision: z.enum(["approve","reject"]),
    note: z.string().max(1000).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Manual Review only — approving moves to "approved" (NOT auto-submitted)
    const status = data.decision === "approve" ? "approved" : "rejected";
    const { data: row, error } = await supabase
      .from("applications")
      .update({ status, notes: data.note ?? null })
      .eq("id", data.application_id)
      .select("*, job_listings(title, company_name)")
      .single();
    if (error) throw new Error(error.message);
    await logActivity(supabase, userId, data.decision, {
      application_id: row.id, job_id: row.job_id, status: "success",
      details: { note: data.note ?? null, manual_review_only: true },
    });
    return { application: row };
  });

export const updateApplicationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    application_id: z.string().uuid(),
    status: z.enum(STATUSES),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("applications").update({ status: data.status }).eq("id", data.application_id).select().single();
    if (error) throw new Error(error.message);
    await logActivity(supabase, userId, "status_change", {
      application_id: row.id, job_id: row.job_id, details: { new_status: data.status },
    });
    return { application: row };
  });

export const listActivityLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("automation_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return { logs: data ?? [] };
  });
