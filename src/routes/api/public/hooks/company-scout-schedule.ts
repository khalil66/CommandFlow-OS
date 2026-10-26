import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { handleScheduledScoutIngestRequest } from "@/lib/company-scout-schedule.functions";

/**
 * Scheduled trigger for the Phase 3.2 Company Scout -> ingestion
 * orchestration. Intended to be called by Supabase pg_cron, the same
 * scheduling mechanism already in use for ./retry-queue.ts's heartbeat —
 * see that file's header. No second scheduler mechanism is introduced.
 *
 * Unlike retry-queue.ts, this endpoint can cause real Company Scout writes
 * and job ingestion, so it requires a dedicated machine-auth secret
 * (COMMAND_FLOW_SCHEDULER_SECRET, sent as the x-commandflow-scheduler-secret
 * header) separate from interactive user auth — see
 * company-scout-schedule.functions.ts for the full safety model
 * (default-disabled, default-dry-run, run lock, never touches
 * applications).
 *
 * All actual logic lives in handleScheduledScoutIngestRequest — a plain,
 * dependency-injectable function — so it can be fully unit tested without
 * this file-route's compiler/registration machinery. This file only wires
 * the real Request, process.env, and the service-role Supabase client to it.
 */
export const Route = createFileRoute("/api/public/hooks/company-scout-schedule")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const result = await handleScheduledScoutIngestRequest({
          headers: request.headers,
          env: {
            COMMAND_FLOW_SCHEDULER_SECRET: process.env.COMMAND_FLOW_SCHEDULER_SECRET,
            COMMAND_FLOW_SCHEDULER_USER_ID: process.env.COMMAND_FLOW_SCHEDULER_USER_ID,
            COMMAND_FLOW_SCHEDULE_ENABLED: process.env.COMMAND_FLOW_SCHEDULE_ENABLED,
            COMMAND_FLOW_SCHEDULE_DRY_RUN: process.env.COMMAND_FLOW_SCHEDULE_DRY_RUN,
          },
          supabase: supabaseAdmin,
          triggerSource: "pg_cron",
        });
        return new Response(JSON.stringify(result.body), {
          status: result.httpStatus,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
