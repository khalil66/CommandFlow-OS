import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const STATUSES = ["queued","manual_review","imported","reviewed","approved","submitted","submitted_manually","submitted_manual","follow_up_due","recruiter_screen","interview_requested","interview","technical_interview","final_interview","rejected","ghosted","offer","withdrawn","archived","safety_blocked","skipped_cap"] as const;
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
      .select("*, job_listings(title, company_name, ats, source_url, final_score, resume_match, legitimacy, interview_probability, salary_confidence, salary_gate_status, salary_posted_min, salary_posted_max, salary_estimated_min, salary_estimated_max)")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { applications: data ?? [] };
  });

export const listApplicationActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ application_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: logs } = await context.supabase
      .from("automation_logs")
      .select("*")
      .eq("application_id", data.application_id)
      .order("created_at", { ascending: true })
      .limit(100);
    return { logs: logs ?? [] };
  });

export const decideApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    application_id: z.string().uuid(),
    decision: z.enum(["approve","reject","review_anyway"]),
    note: z.string().max(1000).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Fetch current app + job
    const { data: current, error: fetchErr } = await supabase
      .from("applications")
      .select("id, job_id, status, notes")
      .eq("id", data.application_id)
      .maybeSingle();
    if (fetchErr) throw new Error(fetchErr.message);
    if (!current) throw new Error("Application not found");

    // review_anyway pulls a capped/blocked item back into Manual Review
    if (data.decision === "review_anyway") {
      const { data: row, error } = await supabase
        .from("applications")
        .update({ status: "manual_review", notes: data.note ?? "Re-queued for manual review" })
        .eq("id", data.application_id)
        .select("*, job_listings(title, company_name)")
        .single();
      if (error) throw new Error(error.message);
      await logActivity(supabase, userId, "status_change", {
        application_id: row.id, job_id: row.job_id,
        details: { decision: "review_anyway" },
      });
      return { application: row, packet_generated: false };
    }

    if (data.decision === "reject") {
      const { data: row, error } = await supabase
        .from("applications")
        .update({ status: "rejected", notes: data.note ?? null, rejected_at: new Date().toISOString() })
        .eq("id", data.application_id)
        .select("*, job_listings(title, company_name)")
        .single();
      if (error) throw new Error(error.message);
      await logActivity(supabase, userId, "reject", {
        application_id: row.id, job_id: row.job_id, details: { note: data.note ?? null },
      });
      return { application: row, packet_generated: false };
    }

    // approve: attempt to generate packet. If it fails, keep in manual_review
    // and surface the exact error so the row stays visible.
    let packetError: string | null = null;
    try {
      const { generatePacketCore } = await import("./packet-generation.server");
      await generatePacketCore(supabase, userId, current.job_id);
    } catch (e: any) {
      packetError = e?.message ?? String(e);
    }

    if (packetError) {
      const { data: row, error } = await supabase
        .from("applications")
        .update({
          status: "manual_review",
          notes: `Approve blocked: packet generation failed — ${packetError.slice(0, 400)}`,
        })
        .eq("id", data.application_id)
        .select("*, job_listings(title, company_name)")
        .single();
      if (error) throw new Error(error.message);
      await logActivity(supabase, userId, "approve", {
        application_id: row.id, job_id: row.job_id, status: "error",
        details: { packet_error: packetError },
      });
      return { application: row, packet_generated: false, packet_error: packetError };
    }

    const { data: row, error } = await supabase
      .from("applications")
      .update({
        status: "approved",
        notes: data.note ?? "Approved · packet ready · manual submission required",
        approved_at: new Date().toISOString(),
      })
      .eq("id", data.application_id)
      .select("*, job_listings(title, company_name)")
      .single();
    if (error) throw new Error(error.message);
    await logActivity(supabase, userId, "approve", {
      application_id: row.id, job_id: row.job_id, status: "success",
      details: { note: data.note ?? null, manual_review_only: true, packet_generated: true },
    });
    return { application: row, packet_generated: true };
  });

export const updateApplicationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    application_id: z.string().uuid(),
    status: z.enum(STATUSES),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const updates: any = { status: data.status };
    const now = new Date().toISOString();
    if (data.status === "reviewed") updates.reviewed_at = now;
    if (data.status === "approved") updates.approved_at = now;
    if (data.status === "submitted" || data.status === "submitted_manually" || data.status === "submitted_manual") {
      updates.submitted_at = now;
      if (data.status === "submitted_manual") updates.submitted_manual_at = now;
    }
    if (data.status === "recruiter_screen") { updates.recruiter_screen_at = now; updates.response_received_at = updates.response_received_at ?? now; }
    if (data.status === "technical_interview") updates.technical_interview_at = now;
    if (data.status === "final_interview") updates.final_interview_at = now;
    if (data.status === "interview_requested" || data.status === "interview") {
      updates.interview_requested_at = now;
      updates.response_received_at = now;
    }
    if (data.status === "rejected") updates.rejected_at = now;
    if (data.status === "ghosted") updates.ghosted_at = now;
    if (data.status === "offer") updates.offer_at = now;
    if (data.status === "archived") updates.archived_at = now;

    const { data: row, error } = await (supabase as any)
      .from("applications").update(updates).eq("id", data.application_id).select().single();
    if (error) throw new Error(error.message);
    await logActivity(supabase, userId, "status_change", {
      application_id: row.id, job_id: row.job_id, details: { new_status: data.status },
    });

    // Side effects: schedule follow-ups on submission, generate prep on interview request.
    if (data.status === "submitted" || data.status === "submitted_manually") {
      try {
        const { scheduleFollowUps } = await import("./optimization.functions");
        await scheduleFollowUps({ data: { application_id: row.id } });
      } catch (e) { /* best-effort */ }
    }
    if (data.status === "interview_requested" || data.status === "interview") {
      try {
        const { markInterviewRequested } = await import("./optimization.functions");
        await markInterviewRequested({ data: { application_id: row.id } });
      } catch (e) { /* best-effort */ }
    }

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
