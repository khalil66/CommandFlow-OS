import { detectScamFlags, isPersonalEmailDomain } from "./scam-signals";

export const SUPPORTED_ATS = ["Greenhouse", "Lever", "Ashby", "Breezy", "Workable"];
export const SALARY_FLOOR = 55000;

export type DayCategory =
  | "saas" | "data" | "cs_ops" | "product_pm"
  | "remote_first" | "mba_friendly" | "other";

export const WEEKDAY_CATEGORY: DayCategory[] = [
  "other",          // Sunday: review/follow-ups
  "saas",           // Monday
  "data",           // Tuesday
  "cs_ops",         // Wednesday
  "product_pm",     // Thursday
  "remote_first",   // Friday
  "mba_friendly",   // Saturday
];

export const CATEGORY_LABEL: Record<DayCategory, string> = {
  saas: "SaaS startups",
  data: "Data / analytics companies",
  cs_ops: "Customer success & operations",
  product_pm: "Product / project management",
  remote_first: "Remote-first tech",
  mba_friendly: "MBA-friendly startups",
  other: "Review · follow-ups · analytics",
};

export function categoryForDate(d: Date): DayCategory {
  return WEEKDAY_CATEGORY[d.getDay()];
}

export function dayOfWeek(d: Date): string {
  return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][d.getDay()];
}

// ---------- Trust Score ---------- //
export interface TrustInputs {
  has_official_site: boolean;
  has_careers_page: boolean;
  has_linkedin: boolean;
  ats_domain_match: boolean;
  business_footprint_score: number;  // 0-100
  news_signals_count: number;        // raw count
  description?: string | null;
  contact_email_domain?: string | null;
  payment_request?: boolean;
}

export interface TrustResult {
  score: number;
  decision: "verified" | "manual_review" | "rejected";
  red_flags: string[];
  scam_flags: string[];
  personal_email_domain: boolean;
}

export function computeTrustScore(i: TrustInputs): TrustResult {
  let score = 0;
  const flags: string[] = [];

  if (i.has_official_site) score += 18; else flags.push("No official website");
  if (i.has_careers_page) score += 14; else flags.push("No careers page");
  if (i.has_linkedin) score += 16; else flags.push("No LinkedIn presence");
  if (i.ats_domain_match) score += 12; else flags.push("ATS domain mismatch");

  score += Math.min(20, Math.round(i.business_footprint_score * 0.2));
  score += Math.min(10, i.news_signals_count * 2);

  const scam_flags = detectScamFlags(i.description ?? "");
  if (scam_flags.length) {
    score -= 40;
    flags.push(`Scam language: ${scam_flags.slice(0, 2).join(", ")}`);
  }

  const personal = isPersonalEmailDomain(i.contact_email_domain);
  if (personal) {
    score -= 25;
    flags.push("Contact uses personal email domain");
  }

  if (i.payment_request) {
    score -= 60;
    flags.push("Requests payment / fees");
  }

  score = Math.max(0, Math.min(100, score));
  const decision: TrustResult["decision"] =
    score >= 90 ? "verified" : score >= 75 ? "manual_review" : "rejected";

  return { score, decision, red_flags: flags, scam_flags, personal_email_domain: personal };
}

// ---------- Interview Probability ---------- //
export interface InterviewInputs {
  resume_match?: number;          // 0-100
  skills_match?: number;          // 0-100
  salary_min?: number | null;
  experience_fit?: number;        // 0-100
  remote: boolean;
  ats?: string | null;
  has_education_match?: boolean;
  mba_relevant?: boolean;
  portfolio_relevant?: boolean;
  profile_strength?: number;      // 0-100 (LinkedIn + website)
  hiring_activity?: number;       // 0-100
  trust_score?: number;           // 0-100 (used for ATS gate weighting)
}

export interface InterviewResult {
  score: number;
  priority: "high" | "good" | "manual" | "skip";
  breakdown: Record<string, number>;
}

export function computeInterviewProbability(i: InterviewInputs): InterviewResult {
  const b: Record<string, number> = {};
  b.resume_match    = clampPct(i.resume_match) * 0.15;
  b.skills_match    = clampPct(i.skills_match) * 0.12;
  b.salary_fit      = (i.salary_min && i.salary_min >= SALARY_FLOOR ? 100 : 50) * 0.08;
  b.experience_fit  = clampPct(i.experience_fit ?? 75) * 0.10;
  b.remote_fit      = (i.remote ? 100 : 30) * 0.08;
  b.education_fit   = (i.has_education_match ? 100 : 70) * 0.06;
  b.mba_relevance   = (i.mba_relevant ? 100 : 50) * 0.06;
  b.portfolio_rel   = (i.portfolio_relevant ? 100 : 50) * 0.06;
  b.profile_strength= clampPct(i.profile_strength ?? 80) * 0.07;
  b.hiring_activity = clampPct(i.hiring_activity ?? 50) * 0.10;
  b.ats_compat      = (SUPPORTED_ATS.includes(i.ats ?? "") ? 100 : 30) * 0.12;

  const score = Math.round(Object.values(b).reduce((a, c) => a + c, 0));
  const priority: InterviewResult["priority"] =
    score >= 90 ? "high" : score >= 80 ? "good" : score >= 70 ? "manual" : "skip";

  return { score, priority, breakdown: b };
}

function clampPct(n: number | undefined | null): number {
  if (n == null) return 0;
  return Math.max(0, Math.min(100, n));
}

// Ready-to-Apply gate
export function isReadyToApply(args: {
  trust_score: number;
  interview_probability: number;
  salary_min?: number | null;
  remote: boolean;
  ats?: string | null;
}): boolean {
  return (
    args.trust_score >= 90 &&
    args.interview_probability >= 85 &&
    (args.salary_min ?? 0) >= SALARY_FLOOR &&
    args.remote &&
    SUPPORTED_ATS.includes(args.ats ?? "")
  );
}
