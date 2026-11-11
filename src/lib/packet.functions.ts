import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
export { confidenceLabel, computeQuality } from "./packet-quality";

export const generatePacket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ job_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { generatePacketCore } = await import("./packet-generation.server");
    return generatePacketCore(context.supabase, context.userId, data.job_id);
  });

// ---------- Approve / Reject / Save / Get latest packet ---------- //

export const decideApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        job_id: z.string().uuid(),
        decision: z.enum(["approve", "reject", "save_for_later"]),
        notes: z.string().max(1000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const statusMap = {
      approve: "approved",
      reject: "rejected",
      save_for_later: "manual_review",
    } as const;
    const { data: existing } = await supabase
      .from("applications")
      .select("id")
      .eq("user_id", userId)
      .eq("job_id", data.job_id)
      .maybeSingle();
    const payload: Database["public"]["Tables"]["applications"]["Insert"] = {
      user_id: userId,
      job_id: data.job_id,
      status: statusMap[data.decision],
      notes: data.notes ?? null,
    };
    if (data.decision === "approve") payload.submitted_at = null; // still NOT submitted — manual only
    if (existing) {
      await supabase.from("applications").update(payload).eq("id", existing.id);
    } else {
      await supabase.from("applications").insert(payload);
    }
    return { ok: true, status: payload.status };
  });

export const getLatestPacket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ job_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: job } = await supabase
      .from("job_listings")
      .select("*")
      .eq("id", data.job_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!job) throw new Error("Job not found");
    const [{ data: company }, { data: resume }, { data: cover }, { data: app }] = await Promise.all(
      [
        job.company_id
          ? supabase.from("companies").select("*").eq("id", job.company_id).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase
          .from("resume_versions")
          .select("*")
          .eq("job_id", job.id)
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("cover_letters")
          .select("*")
          .eq("job_id", job.id)
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("applications")
          .select("*")
          .eq("job_id", job.id)
          .eq("user_id", userId)
          .maybeSingle(),
      ],
    );
    return { job, company, resume, cover, application: app };
  });
