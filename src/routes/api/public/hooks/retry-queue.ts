import { createFileRoute } from "@tanstack/react-router";

// Retired heartbeat. No private reads, writes, or provider calls are allowed here.
// Autonomous work is exclusively a trusted scheduled Worker event after approval.
export const Route = createFileRoute("/api/public/hooks/retry-queue")({
  server: {
    handlers: {
      POST: async () =>
        Response.json(
          { ok: false, reason: "Scheduled retry activation pending approval" },
          { status: 410 },
        ),
    },
  },
});
