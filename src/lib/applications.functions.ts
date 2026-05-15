import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const STATUSES = ["queued","manual_review","approved","submitted","interview","rejected","offer","withdrawn"] as const;

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
    if (existing) {
      const { data: row, error } = await supabase
        .from("applications").update({ ...data }).eq("id", existing.id).select().single();
      if (error) throw new Error(error.message);
      return { application: row };
    }
    const { data: row, error } = await supabase
      .from("applications").insert({ ...data, user_id: userId }).select().single();
    if (error) throw new Error(error.message);
    return { application: row };
  });

export const listApplications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("applications")
      .select("*, job_listings(title, company_name, ats)")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { applications: data ?? [] };
  });
