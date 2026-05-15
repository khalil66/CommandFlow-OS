import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const TARGET_USER_ID = "00bb776c-6de6-40c2-8a06-34e4755ff403";
const TARGET_EMAIL = "khalil.hickson@outlook.com";

export const getAdminRecoveryStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { data, error } = await supabaseAdmin
    .from("admin_bootstrap")
    .select("enabled,target_email")
    .eq("id", true)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return { enabled: !!data?.enabled, email: data?.target_email ?? TARGET_EMAIL };
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
    if (data.email.trim().toLowerCase() !== TARGET_EMAIL) {
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
    if (row.target_user_id !== TARGET_USER_ID || row.target_email !== TARGET_EMAIL) {
      throw new Error("Admin recovery target mismatch.");
    }

    const { data: userInfo, error: getErr } = await supabaseAdmin.auth.admin.getUserById(TARGET_USER_ID);
    if (getErr) throw new Error(getErr.message);
    if (!userInfo?.user || userInfo.user.email?.toLowerCase() !== TARGET_EMAIL) {
      throw new Error("Admin user not found or email mismatch.");
    }

    const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(TARGET_USER_ID, {
      password: data.newPassword,
    });
    if (updErr) throw new Error(updErr.message);

    const { error: disableErr } = await supabaseAdmin
      .from("admin_bootstrap")
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq("id", true);
    if (disableErr) throw new Error(disableErr.message);

    return { ok: true };
  });
