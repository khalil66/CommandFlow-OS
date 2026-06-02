import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface SmsResult {
  ok: boolean;
  status: "sent" | "skipped:not_configured" | "skipped:disabled" | "error" | "blocked:same_number";
  suggestion?: string;
  missing?: string[];
  error?: string;
  sid?: string;
}

function checkEnv(): { missing: string[]; sid?: string; token?: string; from?: string } {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const missing: string[] = [];
  if (!sid) missing.push("TWILIO_ACCOUNT_SID");
  if (!token) missing.push("TWILIO_AUTH_TOKEN");
  if (!from) missing.push("TWILIO_FROM_NUMBER");
  return { missing, sid, token, from };
}

/** Internal SMS sender. Never throws — returns a typed result. */
export async function sendSmsInternal(args: {
  supabase: any;
  userId: string;
  to: string | null | undefined;
  body: string;
  kind: string;
}): Promise<SmsResult> {
  const { supabase, userId, to, body, kind } = args;
  const env = checkEnv();
  const missing = [...env.missing];
  if (!to) missing.push("USER_PHONE_NUMBER");

  const logRow = (status: string, extra: Record<string, any> = {}) => ({
    user_id: userId, channel: "sms", kind, to_number: to ?? null,
    body: body.slice(0, 1000), status, ...extra,
  });

  if (missing.length > 0) {
    await supabase.from("notification_logs").insert(logRow("skipped:not_configured", { error: `Missing: ${missing.join(", ")}` }));
    return { ok: false, status: "skipped:not_configured", missing };
  }

  // Validate To/From: must be present, valid-looking E.164, and not equal.
  const normalize = (n: string) => {
    const t = String(n).trim();
    const digits = t.replace(/[^\d+]/g, "");
    if (digits.startsWith("+")) return digits;
    if (/^\d{10,15}$/.test(digits)) return `+${digits}`;
    return digits;
  };
  const toN = normalize(to!);
  const fromN = normalize(env.from!);
  if (toN && fromN && toN === fromN) {
    const reason = "SMS blocked: To and From number cannot be the same.";
    const suggestion = "Update USER_PHONE_NUMBER (recipient) so it differs from TWILIO_FROM_NUMBER.";
    console.warn(`[sms] blocked_same_number user=${userId} kind=${kind} to=${toN} from=${fromN}`);
    await supabase.from("notification_logs").insert(logRow("blocked:same_number", { error: `${reason} ${suggestion}` }));
    return { ok: false, status: "blocked:same_number", error: reason, suggestion };
  }

  try {
    const auth = btoa(`${env.sid}:${env.token}`);
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${env.sid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to!, From: env.from!, Body: body.slice(0, 1500) }).toString(),
      },
    );
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg = data?.message ?? `Twilio HTTP ${res.status}`;
      await supabase.from("notification_logs").insert(logRow("error", { error: errMsg.slice(0, 400) }));
      return { ok: false, status: "error", error: errMsg };
    }
    await supabase.from("notification_logs").insert(logRow("sent", { provider_sid: data?.sid ?? null }));
    return { ok: true, status: "sent", sid: data?.sid };
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    await supabase.from("notification_logs").insert(logRow("error", { error: msg.slice(0, 400) }));
    return { ok: false, status: "error", error: msg };
  }
}

/** "Send Test SMS" button in Settings. */
export const sendTestSms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: settings } = await (supabase as any).from("user_settings")
      .select("phone_number").eq("user_id", userId).maybeSingle();
    const to = settings?.phone_number || process.env.USER_PHONE_NUMBER;
    return sendSmsInternal({
      supabase, userId, to,
      body: "Smart Apply test SMS — Twilio is configured correctly.",
      kind: "test",
    });
  });

/** Recent notification log tail. */
export const listNotificationLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await (supabase as any).from("notification_logs")
      .select("*").eq("user_id", userId)
      .order("created_at", { ascending: false }).limit(20);
    return { logs: data ?? [] };
  });
