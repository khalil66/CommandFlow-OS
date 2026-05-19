import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { RESUME_VARIANTS, suggestVariantForRole, variantLabel, type ResumeVariantKey } from "./resume-variants";

// ---------- Variant stats ---------- //

export interface VariantStats {
  variant_key: string;
  label: string;
  applications: number;
  recruiter_replies: number;
  interviews: number;
  rejections: number;
  ghosted: number;
  offers: number;
  response_rate: number;       // recruiter_replies / applications
  interview_rate: number;      // interviews / applications
  interview_conversion: number; // interviews / recruiter_replies
  offer_rate: number;          // offers / applications
  last_used_at: string | null;
}

function emptyStats(key: string): VariantStats {
  return {
    variant_key: key,
    label: variantLabel(key),
    applications: 0, recruiter_replies: 0, interviews: 0, rejections: 0, ghosted: 0, offers: 0,
    response_rate: 0, interview_rate: 0, interview_conversion: 0, offer_rate: 0,
    last_used_at: null,
  };
}

function pct(n: number, d: number) {
  if (!d) return 0;
  return Math.round((n / d) * 1000) / 10; // one decimal place
}

export const getVariantStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: apps, error } = await supabase
      .from("applications")
      .select(
        "id,status,resume_variant_key,response_received_at,interview_requested_at,technical_interview_at,final_interview_at,offer_at,rejected_at,ghosted_at,submitted_at,created_at,updated_at",
      )
      .eq("user_id", userId);
    if (error) throw error;

    const map = new Map<string, VariantStats>();
    for (const v of RESUME_VARIANTS) map.set(v.key, emptyStats(v.key));
    map.set("generic", emptyStats("generic"));

    for (const a of apps ?? []) {
      const key = a.resume_variant_key || "generic";
      if (!map.has(key)) map.set(key, emptyStats(key));
      const s = map.get(key)!;
      s.applications += 1;
      const submitted =
        !!a.submitted_at ||
        ["submitted", "submitted_manually", "interview_requested", "interview", "rejected", "ghosted", "offer"].includes(a.status);
      if (a.response_received_at || a.recruiter_screen_at || a.interview_requested_at || a.offer_at || a.rejected_at) {
        s.recruiter_replies += 1;
      }
      if (a.interview_requested_at || a.technical_interview_at || a.final_interview_at || a.status === "interview" || a.status === "interview_requested") {
        s.interviews += 1;
      }
      if (a.rejected_at || a.status === "rejected") s.rejections += 1;
      if (a.ghosted_at || a.status === "ghosted") s.ghosted += 1;
      if (a.offer_at || a.status === "offer") s.offers += 1;
      const ts = a.updated_at || a.submitted_at || a.created_at;
      if (ts && (!s.last_used_at || ts > s.last_used_at)) s.last_used_at = ts;
      void submitted;
    }

    const rows = Array.from(map.values()).map((s) => ({
      ...s,
      response_rate: pct(s.recruiter_replies, s.applications),
      interview_rate: pct(s.interviews, s.applications),
      interview_conversion: pct(s.interviews, s.recruiter_replies),
      offer_rate: pct(s.offers, s.applications),
    }));

    return { variants: rows };
  });

// ---------- Variant recommendation ---------- //

const SUGGEST_INPUT = z.object({
  role_category: z.string().max(120).optional().nullable(),
  title: z.string().max(200).optional().nullable(),
});

export const suggestVariantForJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => SUGGEST_INPUT.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const baseline = suggestVariantForRole(data.role_category, data.title);

    // Pull outcome data to override baseline when a different variant is performing
    // meaningfully better for THIS role category.
    const { data: apps } = await supabase
      .from("applications")
      .select("resume_variant_key,response_received_at,interview_requested_at,offer_at,rejected_at,ghosted_at,status")
      .eq("user_id", userId)
      .limit(500);

    const perVariant = new Map<string, { apps: number; replies: number; interviews: number }>();
    for (const a of apps ?? []) {
      const k = a.resume_variant_key || "generic";
      if (!perVariant.has(k)) perVariant.set(k, { apps: 0, replies: 0, interviews: 0 });
      const s = perVariant.get(k)!;
      s.apps += 1;
      if (a.response_received_at || a.interview_requested_at || a.offer_at || a.rejected_at) s.replies += 1;
      if (a.interview_requested_at || a.offer_at || a.status === "interview") s.interviews += 1;
    }

    // Score by interview rate (with min sample size 5) else response rate else baseline
    let winner: ResumeVariantKey | string = baseline;
    let winnerInterviewRate = 0;
    let outcomeOverride = false;
    let reason = `Mapped from role category "${data.role_category ?? data.title ?? "unknown"}" → ${variantLabel(baseline)}`;

    for (const [k, v] of perVariant.entries()) {
      if (v.apps < 5) continue;
      const ir = v.interviews / v.apps;
      if (ir > winnerInterviewRate + 0.05) {
        winnerInterviewRate = ir;
        winner = k;
        outcomeOverride = true;
      }
    }

    if (outcomeOverride && winner !== baseline) {
      reason = `Outcome learning override: "${variantLabel(winner)}" has the highest interview rate (${Math.round(winnerInterviewRate * 100)}%) across recent applications.`;
    }

    return {
      recommended: winner,
      label: variantLabel(winner),
      baseline,
      outcome_override: outcomeOverride,
      reason,
    };
  });

// ---------- A/B testing rotation ---------- //
// Rotate between top-2 candidate variants for a given role until each has >= 8 apps,
// then lock to the winner by interview rate.

export const pickABVariant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => SUGGEST_INPUT.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const baseline = suggestVariantForRole(data.role_category, data.title);
    // Pair baseline with closest alternative
    const alternatives: Record<string, ResumeVariantKey> = {
      data_analyst: "product_ops",
      operations_pm: "product_ops",
      customer_success: "operations_pm",
      product_ops: "technical_pm",
      technical_pm: "product_ops",
      generic: "operations_pm",
    };
    const alt = alternatives[baseline] ?? "operations_pm";

    const { data: apps } = await supabase
      .from("applications")
      .select("resume_variant_key,interview_requested_at,offer_at,status")
      .eq("user_id", userId)
      .in("resume_variant_key", [baseline, alt]);

    const counts: Record<string, { apps: number; interviews: number }> = {
      [baseline]: { apps: 0, interviews: 0 },
      [alt]: { apps: 0, interviews: 0 },
    };
    for (const a of apps ?? []) {
      const k = a.resume_variant_key!;
      if (!counts[k]) continue;
      counts[k].apps += 1;
      if (a.interview_requested_at || a.offer_at || a.status === "interview") counts[k].interviews += 1;
    }

    const minSample = 8;
    const both = counts[baseline].apps >= minSample && counts[alt].apps >= minSample;
    let pick = baseline;
    let mode: "rotating" | "winner_locked" = "rotating";
    if (both) {
      const baseIr = counts[baseline].interviews / counts[baseline].apps;
      const altIr = counts[alt].interviews / counts[alt].apps;
      pick = altIr > baseIr ? alt : baseline;
      mode = "winner_locked";
    } else {
      // Round-robin: pick whichever has fewer apps
      pick = counts[alt].apps < counts[baseline].apps ? alt : baseline;
    }

    return {
      pick,
      label: variantLabel(pick),
      baseline,
      alternative: alt,
      mode,
      counts,
    };
  });

// ---------- Seed variants ---------- //
// Create resume_versions rows for each canonical variant if missing.

export const seedResumeVariants = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: existing } = await supabase
      .from("resume_versions")
      .select("id,variant_key")
      .eq("user_id", userId)
      .eq("is_template", true);
    const have = new Set((existing ?? []).map((r) => r.variant_key));
    const toInsert = RESUME_VARIANTS
      .filter((v) => !have.has(v.key))
      .map((v) => ({
        user_id: userId,
        variant_key: v.key,
        label: v.label,
        target_role: v.target_role,
        summary: v.summary,
        skills: v.skills,
        keywords: v.keywords,
        bullets: v.bullets,
        is_template: true,
      }));
    if (toInsert.length) {
      const { error } = await supabase.from("resume_versions").insert(toInsert);
      if (error) throw error;
    }
    return { inserted: toInsert.length, total_variants: RESUME_VARIANTS.length };
  });
