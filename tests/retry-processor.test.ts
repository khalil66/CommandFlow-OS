import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  generate: vi.fn(), claim: vi.fn(), rpc: vi.fn(),
}));
vi.mock("../src/lib/packet-generation.server", () => ({ generatePacketCore: fake.generate }));
vi.mock("../src/lib/retry-database.server", () => ({
  claimRetries: fake.claim, retryDb: () => ({ rpc: fake.rpc }),
}));
import { processRetries } from "../src/lib/retry-processor.server";
import { runScheduledRetry } from "../src/lib/retry-scheduled.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/integrations/supabase/types";

const client = {} as SupabaseClient<Database>;
const row = { id: "00000000-0000-4000-8000-000000000001", user_id: "00000000-0000-4000-8000-000000000002", job_id: "00000000-0000-4000-8000-000000000003", lease_token: "00000000-0000-4000-8000-000000000004", retry_attempts: 2, max_attempts: 5 };

beforeEach(() => {
  vi.clearAllMocks();
  process.env["RETRY_REPAIR_ENABLED"] = "true";
  fake.rpc.mockResolvedValue({data:true,error:null});
  fake.generate.mockResolvedValue({});
  fake.claim.mockResolvedValue([]);
});

describe("bounded orchestration", () => {
  it("does no work before activation approval", async () => {
    process.env["RETRY_REPAIR_ENABLED"] = "false";
    expect((await processRetries(client,row.user_id)).processed).toBe(0);
    expect(fake.rpc).not.toHaveBeenCalled(); expect(fake.generate).not.toHaveBeenCalled();
  });
  it("does not process not-due records", async () => {
    expect((await processRetries(client,row.user_id)).processed).toBe(0);
    expect(fake.generate).not.toHaveBeenCalled();
  });
  it("processes at most three records", async () => {
    fake.claim.mockResolvedValue([row]);
    expect((await processRetries(client,row.user_id)).processed).toBe(3);
    expect(fake.generate).toHaveBeenCalledTimes(3);
  });
  it("interview failure never marks packet completed", async () => {
    fake.claim.mockResolvedValue([row]);
    fake.generate.mockRejectedValue(new Error("Interview preparation could not be saved"));
    const result = await processRetries(client,row.user_id);
    expect(result.succeeded).toBe(0); expect(result.failed).toBe(1);
    const finish = fake.rpc.mock.calls.find(([name]) => name === "retry_finish");
    expect(finish?.[1].p_result.success).toBe(false);
  });
  it("stops claiming after quota failure", async () => {
    fake.claim.mockResolvedValue([row]); fake.generate.mockRejectedValue(new Error("OpenAI quota exhausted"));
    await processRetries(client,row.user_id);
    expect(fake.claim).toHaveBeenCalledTimes(1);
    const finish = fake.rpc.mock.calls.find(([name]) => name === "retry_finish");
    expect(finish?.[1].p_result.pause).toBe(true);
  });
  it("rejects lost lease completion rather than reporting success", async () => {
    fake.claim.mockResolvedValue([row]);
    fake.rpc.mockImplementation(async (name) => ({ data: name !== "retry_finish", error:null }));
    await expect(processRetries(client,row.user_id)).rejects.toThrow("not confirmed");
  });
  it("scheduled dry-run makes zero claims or generation calls", async () => {
    expect(await runScheduledRetry({ RETRY_REPAIR_ENABLED:"false", AUTONOMOUS_RETRY_ENABLED:"false" })).toMatchObject({dry_run:true,processed:0});
    expect(fake.claim).not.toHaveBeenCalled(); expect(fake.generate).not.toHaveBeenCalled();
  });
});
