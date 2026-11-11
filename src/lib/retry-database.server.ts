import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { z } from "zod";
import { RETRY_LEASE_SECONDS } from "./retry-policy";

type RpcDefinition<A, R> = { Args: A; Returns: R };
type RetryDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions"> & {
    Functions: Database["public"]["Functions"] & {
      retry_reserve_usage: RpcDefinition<{ p_user: string; p_job: string | null }, string>;
      retry_finish_usage: RpcDefinition<
        { p_user: string; p_reservation: string; p_result: Json },
        boolean
      >;
      retry_packet_lock: RpcDefinition<{ p_user: string; p_job: string; p_token: string }, boolean>;
      retry_packet_unlock: RpcDefinition<
        { p_user: string; p_job: string; p_token: string },
        boolean
      >;
      retry_claim: RpcDefinition<
        { p_user: string | null; p_id: string | null; p_limit: number; p_lease_seconds: number },
        Json
      >;
      retry_finish: RpcDefinition<
        { p_user: string; p_id: string; p_token: string; p_result: Json },
        boolean
      >;
      retry_recover_leases: RpcDefinition<{ p_user: string | null }, number>;
      retry_resume: RpcDefinition<{ p_user: string }, boolean>;
    };
  };
};

// Additive RPCs are review-staged, so the integration-managed types cannot yet include them.
export function retryDb(client: SupabaseClient<Database>) {
  return client as unknown as SupabaseClient<RetryDatabase>;
}

export async function reserveUsage(
  client: SupabaseClient<Database>,
  userId: string,
  jobId?: string,
) {
  const { data, error } = await retryDb(client).rpc("retry_reserve_usage", {
    p_user: userId,
    p_job: jobId ?? null,
  });
  if (error || !data) throw new Error(error?.message ?? "Usage enforcement unavailable");
  return data;
}

export async function finishUsage(
  client: SupabaseClient<Database>,
  userId: string,
  reservationId: string,
  result: Json,
) {
  const { data, error } = await retryDb(client).rpc("retry_finish_usage", {
    p_user: userId,
    p_reservation: reservationId,
    p_result: result,
  });
  if (error || !data) throw new Error("Generation usage could not be recorded");
}

export async function withPacketLease<T>(
  client: SupabaseClient<Database>,
  userId: string,
  jobId: string,
  generate: () => Promise<T>,
) {
  if (process.env["RETRY_REPAIR_ENABLED"] !== "true") return generate();
  const token = crypto.randomUUID();
  const { data, error } = await retryDb(client).rpc("retry_packet_lock", {
    p_user: userId,
    p_job: jobId,
    p_token: token,
  });
  if (error || !data) throw new Error("Packet already processing or awaiting lease recovery");
  try {
    return await generate();
  } finally {
    const { error: unlockError } = await retryDb(client).rpc("retry_packet_unlock", {
      p_user: userId,
      p_job: jobId,
      p_token: token,
    });
    if (unlockError) console.error("Packet lease release failed; recovery review required");
  }
}

export async function validateSavedPacket(
  client: SupabaseClient<Database>,
  userId: string,
  jobId: string,
  appId: string,
) {
  const { data: app, error: appError } = await client
    .from("applications")
    .select("status, resume_version_id, cover_letter_id")
    .eq("user_id", userId)
    .eq("job_id", jobId)
    .eq("id", appId)
    .single();
  if (
    appError ||
    !app ||
    app.status !== "manual_review" ||
    !app.resume_version_id ||
    !app.cover_letter_id
  )
    throw new Error("Incomplete manual-review application");
  const [resume, cover, prep] = await Promise.all([
    client
      .from("resume_versions")
      .select("id, summary, bullets")
      .eq("id", app.resume_version_id)
      .eq("user_id", userId)
      .eq("job_id", jobId)
      .single(),
    client
      .from("cover_letters")
      .select("id, body")
      .eq("id", app.cover_letter_id)
      .eq("user_id", userId)
      .eq("job_id", jobId)
      .single(),
    client
      .from("interview_prep")
      .select("id, brief")
      .eq("application_id", appId)
      .eq("user_id", userId)
      .eq("job_id", jobId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .single(),
  ]);
  if (
    resume.error ||
    cover.error ||
    prep.error ||
    !resume.data?.summary ||
    !resume.data.bullets?.length ||
    !cover.data?.body ||
    !prep.data?.brief
  )
    throw new Error("Packet artifacts failed read-back validation");
  return true;
}

export const claimedRowsSchema = z.array(
  z.object({
    id: z.string().uuid(),
    user_id: z.string().uuid(),
    job_id: z.string().uuid(),
    lease_token: z.string().uuid(),
    retry_attempts: z.number(),
    max_attempts: z.number(),
  }),
);

export async function claimRetries(
  client: SupabaseClient<Database>,
  userId: string | null,
  queueId: string | null,
  limit: number,
) {
  const { data, error } = await retryDb(client).rpc("retry_claim", {
    p_user: userId,
    p_id: queueId,
    p_limit: limit,
    p_lease_seconds: RETRY_LEASE_SECONDS,
  });
  if (error) throw new Error("Retry enforcement unavailable; no jobs processed");
  return claimedRowsSchema.parse(data ?? []);
}
