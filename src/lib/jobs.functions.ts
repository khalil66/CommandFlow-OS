import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const JobInput = z.object({
  title: z.string(),
  company_name: z.string(),
  location: z.string().optional().nullable(),
  remote: z.boolean().optional(),
  salary_min: z.number().optional().nullable(),
  salary_max: z.number().optional().nullable(),
  ats: z.string().optional().nullable(),
  source_url: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  resume_match: z.number().optional(),
  legitimacy: z.number().optional(),
  final_score: z.number().optional(),
  blockers: z.array(z.string()).optional(),
});

export const saveJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => JobInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("job_listings")
      .insert({ ...data, user_id: userId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { job: row };
  });

export const listJobs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("job_listings")
      .select("*")
      .order("final_score", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { jobs: data ?? [] };
  });

export const getJobPacket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [job, resume, cover, ats, app] = await Promise.all([
      supabase.from("job_listings").select("*").eq("id", data.jobId).maybeSingle(),
      supabase.from("resume_versions").select("*").eq("job_id", data.jobId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("cover_letters").select("*").eq("job_id", data.jobId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("ats_checks").select("*").eq("job_id", data.jobId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("applications").select("*").eq("job_id", data.jobId).maybeSingle(),
    ]);
    return {
      job: job.data, resume: resume.data, cover: cover.data,
      ats: ats.data, application: app.data,
      exported_at: new Date().toISOString(),
    };
  });
