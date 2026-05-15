// Production Auto-Review scoring engine.
// Replaces the earlier permissive heuristic. Targets 5–15% auto-pass rate.

import { SUPPORTED_ATS } from "./scoring";
import { projectsForRole } from "./portfolio";

export const AUTO_THRESHOLDS = {
  trust: 95,
  interview: 92,
  quality: 92,
  resume_match: 88,
  portfolio: 80,
  role_fit: 85,
  salary_min: 55000,
  fresh_days: 14,
  daily_pass_rate_cap: 0.15, // 15%
};

export type AutoDecision = "auto" | "manual" | "reject";

export interface AutoReviewResult {
  decision: AutoDecision;
  scores: {
    trust: number;
    interview: number;
    quality: number;
    resume_match: number;
    portfolio: number;
    role_fit: number;
    salary_confidence: string;
    age_days: number | null;
  };
  passed: string[];
  failed: string[];
  rejected_for: string[];
}

const ALLOWED_CATEGORIES = [
  "data", "operations", "ops", "customer success", "cs",
  "technical support", "support", "product operations", "product ops",
  "product manager", "product management", "project manager",
  "project management", "project coordinator", "implementation",
  "revenue operations", "revenue ops", "business analyst",
];

const SENIORITY_BLOCK = /\b(staff|principal|director|head of|vp|vice president|chief|cto|cpo|cfo|cmo)\b/i;
const SENIORITY_ALIGN = /\b(analyst|coordinator|operations|ops|customer success|support|product|project|implementation|revenue)\b/i;
const SWE_ONLY = /\b(software engineer|backend engineer|front[- ]?end engineer|full[- ]?stack|ios engineer|android engineer|devops|site reliability|sre|machine learning engineer|ml engineer|data engineer|security engineer)\b/i;
const SWE_RESCUE = /\b(analyst|operations|ops|customer success|support|product manager|project manager|implementation)\b/i;
const DISQUALIFIER = /\b(internship|intern\b|unpaid|commission[- ]only|100% commission|equity[- ]only)\b/i;

function ageDays(iso?: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

function classifyRoleFit(title: string, roleCategory?: string | null): { fit: number; matched: string | null } {
  const hay = `${title ?? ""} ${roleCategory ?? ""}`.toLowerCase();
  for (const cat of ALLOWED_CATEGORIES) {
    if (hay.includes(cat)) {
      // Exact category mention scores high; partial keywords slightly lower.
      const strong = ["data analyst", "operations analyst", "customer success",
        "technical support", "product operations", "product manager",
        "project manager", "implementation", "revenue operations", "business analyst"];
      return { fit: strong.some(s => hay.includes(s)) ? 95 : 85, matched: cat };
    }
  }
  return { fit: 40, matched: null };
}

function portfolioAlignment(title: string, roleCategory?: string | null): number {
  const projects = projectsForRole(roleCategory || title);
  if (projects.length >= 2) return 90;
  if (projects.length === 1) return 75;
  return 40;
}

export function evaluateAutoReview(args: {
  job: any;
  company: any;
  quality: number;
  ats_check?: any;
  duplicate?: boolean;
  recent_company_app?: boolean;
}): AutoReviewResult {
  const j = args.job, c = args.company || {};
  const title: string = j.title ?? "";
  const desc: string = j.description ?? "";
  const ats: string = j.ats ?? "";
  const ac = args.ats_check ?? {};

  const trust = c.trust_score ?? 0;
  const interview = j.interview_probability ?? 0;
  const resumeMatch = j.resume_match ?? 0;
  const age = ageDays(j.posted_at ?? j.created_at);
  const salaryConfidence: string = j.salary_confidence ?? "unknown";
  const salarySource: string = j.salary_source ?? "missing";
  const salaryMin = j.salary_min ?? j.salary_estimated_min ?? null;
  const gateStatus: string = j.salary_gate_status ?? "manual";

  const { fit: roleFit, matched: roleMatched } = classifyRoleFit(title, j.role_category);
  const portfolio = portfolioAlignment(title, j.role_category);

  const scores = {
    trust, interview, quality: args.quality, resume_match: resumeMatch,
    portfolio, role_fit: roleFit, salary_confidence: salaryConfidence,
    age_days: age,
  };

  const rejected_for: string[] = [];
  const failed: string[] = [];
  const passed: string[] = [];

  // ---------- Hard rejects (negative filters) ---------- //
  if (DISQUALIFIER.test(title) || DISQUALIFIER.test(desc)) {
    rejected_for.push("internship/unpaid/commission-only");
  }
  if (SENIORITY_BLOCK.test(title) && !SENIORITY_ALIGN.test(title)) {
    rejected_for.push("seniority too high (staff/principal/director)");
  }
  if (SWE_ONLY.test(title) && !SWE_RESCUE.test(title)) {
    rejected_for.push("software-engineering-only role");
  }
  if (!roleMatched) {
    rejected_for.push("role outside Data/Ops/CS/Support/ProductOps/PM");
  }
  if (c.red_flags && (c.red_flags as string[]).length > 0) {
    rejected_for.push(`company red flags: ${(c.red_flags as string[]).slice(0,2).join(", ")}`);
  }
  if (args.duplicate) rejected_for.push("duplicate application");

  // ---------- Gates ---------- //
  const check = (cond: boolean, label: string) =>
    cond ? passed.push(label) : failed.push(label);

  check(trust >= AUTO_THRESHOLDS.trust, `trust ≥ ${AUTO_THRESHOLDS.trust} (got ${trust})`);
  check(interview >= AUTO_THRESHOLDS.interview, `interview ≥ ${AUTO_THRESHOLDS.interview} (got ${interview})`);
  check(args.quality >= AUTO_THRESHOLDS.quality, `quality ≥ ${AUTO_THRESHOLDS.quality} (got ${args.quality})`);
  check(resumeMatch >= AUTO_THRESHOLDS.resume_match, `resume match ≥ ${AUTO_THRESHOLDS.resume_match} (got ${resumeMatch})`);
  check(portfolio >= AUTO_THRESHOLDS.portfolio, `portfolio ≥ ${AUTO_THRESHOLDS.portfolio} (got ${portfolio})`);
  check(roleFit >= AUTO_THRESHOLDS.role_fit, `role fit ≥ ${AUTO_THRESHOLDS.role_fit} (got ${roleFit})`);

  // Salary confidence — posted/high/medium only
  const salaryOk =
    (salarySource === "posted_salary" && (salaryMin ?? 0) >= AUTO_THRESHOLDS.salary_min) ||
    (["high", "medium"].includes(salaryConfidence) &&
      gateStatus === "pass" &&
      (salaryMin ?? 0) >= AUTO_THRESHOLDS.salary_min);
  check(salaryOk, `salary confidence in {posted, high, medium} ≥ $${AUTO_THRESHOLDS.salary_min} (got ${salarySource}/${salaryConfidence})`);

  // Generic JD / missing salary
  if (desc.length < 250) failed.push("generic/short job description");
  if (!salaryOk && (salaryConfidence === "low" || salaryConfidence === "unknown")) {
    failed.push("missing salary with low confidence");
  }

  // Freshness
  check(age != null && age <= AUTO_THRESHOLDS.fresh_days, `posted ≤ ${AUTO_THRESHOLDS.fresh_days}d (age ${age ?? "unknown"})`);

  // ATS + safety
  check(SUPPORTED_ATS.includes(ats), `ATS supported (got ${ats || "n/a"})`);
  check(j.remote === true, "remote-only");
  check(!ac.requires_login, "no login wall");
  check(!ac.has_mfa, "no MFA");
  check(!ac.has_captcha, "no CAPTCHA");
  check(!args.recent_company_app, "no application to same company in last 30d");

  let decision: AutoDecision;
  if (rejected_for.length > 0) decision = "reject";
  else if (failed.length === 0) decision = "auto";
  else decision = "manual";

  return { decision, scores, passed, failed, rejected_for };
}
