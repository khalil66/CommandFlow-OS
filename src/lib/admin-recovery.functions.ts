import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function normEmail(e: string | null | undefined) {
  return (e ?? "").trim().toLowerCase();
}

function timingSafeEqualStr(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function assertRecoveryToken(token: string | undefined) {
  const expected = process.env.ADMIN_RECOVERY_TOKEN;
  if (!expected || expected.length < 16) {
    throw new Error("Admin recovery is not configured on the server.");
  }
  if (!token || !timingSafeEqualStr(token, expected)) {
    throw new Error("Invalid recovery token.");
  }
}

async function loadBootstrap() {
  const { data, error } = await supabaseAdmin
    .from("admin_bootstrap")
    .select("enabled,target_email,target_user_id")
    .eq("id", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function findAuthUser(targetUserId: string | null, targetEmail: string) {
  if (targetUserId) {
    const byId = await supabaseAdmin.auth.admin.getUserById(targetUserId);
    if (byId.data?.user) return { user: byId.data.user, method: "getUserById" };
  }
  const target = normEmail(targetEmail);
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const match = data.users.find((u) => normEmail(u.email) === target);
    if (match) return { user: match, method: "listUsers(email)" };
    if (data.users.length < 200) break;
  }
  throw new Error("Admin user not found in Auth.");
}

// Public, minimal status — no PII, no infra details.
export const getAdminRecoveryStatus = createServerFn({ method: "GET" }).handler(async () => {
  const data = await loadBootstrap();
  return { enabled: !!data?.enabled };
});

// Token-gated reset. Requires ADMIN_RECOVERY_TOKEN header value to be supplied
// by the caller. Email/userId are looked up server-side from admin_bootstrap.
export const bootstrapAdminPassword = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        recoveryToken: z.string().min(16).max(512),
        newPassword: z.string().min(8).max(128),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    assertRecoveryToken(data.recoveryToken);

    const row = await loadBootstrap();
    if (!row || !row.enabled) {
      throw new Error("Admin recovery is disabled.");
    }
    if (!row.target_email) {
      throw new Error("Admin recovery is misconfigured (no target email).");
    }

    const found = await findAuthUser(row.target_user_id ?? null, row.target_email);
    if (normEmail(found.user.email) !== normEmail(row.target_email)) {
      throw new Error("Auth email mismatch for recovery target.");
    }

    const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(found.user.id, {
      password: data.newPassword,
    });
    if (updErr) throw new Error(`updateUserById failed: ${updErr.message}`);

    const { error: disableErr } = await supabaseAdmin
      .from("admin_bootstrap")
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq("id", true);
    if (disableErr) throw new Error(disableErr.message);

    return { ok: true };
  });
