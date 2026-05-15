import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const TARGET_USER_ID = "00bb776c-6de6-40c2-8a06-34e4755ff403";
const TARGET_EMAIL = "khalil.hickson@outlook.com";

function normEmail(e: string | null | undefined) {
  return (e ?? "").trim().toLowerCase();
}

async function findAuthUser() {
  // 1) Try by exact user_id first
  const byId = await supabaseAdmin.auth.admin.getUserById(TARGET_USER_ID);
  if (byId.data?.user) {
    return { user: byId.data.user, method: "getUserById", error: null as string | null };
  }
  const idErr = byId.error?.message ?? null;

  // 2) Fallback: scan listUsers for case-insensitive email match
  const target = normEmail(TARGET_EMAIL);
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      return { user: null, method: "listUsers", error: error.message };
    }
    const match = data.users.find((u) => normEmail(u.email) === target);
    if (match) return { user: match, method: "listUsers(email)", error: null };
    if (data.users.length < 200) break;
  }
  return { user: null, method: "getUserById+listUsers", error: idErr ?? "User not found" };
}

export const getAdminRecoveryStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { data, error } = await supabaseAdmin
    .from("admin_bootstrap")
    .select("enabled,target_email,target_user_id")
    .eq("id", true)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const enabled = !!data?.enabled;
  const projectUrl = process.env.SUPABASE_URL ?? "(unset)";

  let lookup: { method: string; foundUserId: string | null; foundEmail: string | null; error: string | null } = {
    method: "skipped",
    foundUserId: null,
    foundEmail: null,
    error: null,
  };

  if (enabled) {
    const r = await findAuthUser();
    lookup = {
      method: r.method,
      foundUserId: r.user?.id ?? null,
      foundEmail: r.user?.email ?? null,
      error: r.error,
    };
  }

  return {
    enabled,
    email: data?.target_email ?? TARGET_EMAIL,
    userId: data?.target_user_id ?? TARGET_USER_ID,
    debug: { projectUrl, lookup },
  };
});

export const bootstrapAdminPassword = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        email: z.string().email(),
        newPassword: z.string().min(8).max(128),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    if (normEmail(data.email) !== normEmail(TARGET_EMAIL)) {
      throw new Error("Email not authorized for admin recovery.");
    }

    const { data: row, error: rowErr } = await supabaseAdmin
      .from("admin_bootstrap")
      .select("enabled,target_user_id,target_email")
      .eq("id", true)
      .maybeSingle();
    if (rowErr) throw new Error(rowErr.message);
    if (!row || !row.enabled) {
      throw new Error("Admin recovery is disabled. Contact the system owner.");
    }

    // Find the actual auth user (id-first, email fallback)
    const found = await findAuthUser();
    if (!found.user) {
      throw new Error(
        `Admin user not found in Supabase Auth (method=${found.method}, err=${found.error ?? "n/a"}). Verify SUPABASE_URL=${process.env.SUPABASE_URL} matches the project containing this user.`,
      );
    }

    if (normEmail(found.user.email) !== normEmail(TARGET_EMAIL)) {
      throw new Error(
        `Auth email mismatch: found ${found.user.email} for id ${found.user.id}, expected ${TARGET_EMAIL}.`,
      );
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

    return { ok: true, userId: found.user.id, method: found.method };
  });
