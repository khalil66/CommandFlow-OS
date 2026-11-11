import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resumeArgsSchema } from "./generation-contracts";

export const tailorResume = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => resumeArgsSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { tailorResumeInternal } = await import("./resume-generation.server");
    return tailorResumeInternal(context.supabase, context.userId, data);
  });

export const listResumes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("resume_versions")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { resumes: data ?? [] };
  });
