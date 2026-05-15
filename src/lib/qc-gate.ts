// Final Quality Control gate for Auto Review packets.
// Returns passed=true only if ALL checks pass. Otherwise lists failures
// to surface in Manual Review.

import { SUPPORTED_ATS } from "./scoring";

// Verified Khalil proof-points. Any numeric metric in resume bullets/cover
// must originate from this set (allow loose matching).
const VERIFIED_METRICS = [
  "10000", "10,000", "25%", "91%", "92%", "24-hour", "24 hour",
  "50000", "50,000", "1.2m", "$1.2", "35%", "18 months",
];

export interface QCInput {
  job: any;             // job_listings row
  company: any;         // companies row (optional)
  packet: {
    resume?: { bullets?: string[]; summary?: string; keywords?: string[] };
    cover?: { body?: string };
    portfolio_project?: string | null;
    quality?: { score?: number };
  };
  resume_id?: string | null;
  cover_id?: string | null;
}

export interface QCResult {
  passed: boolean;
  failures: string[];
  warnings: string[];
}

function detectKeywordStuffing(text: string, keywords: string[] = []): boolean {
  if (!text || keywords.length === 0) return false;
  const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
  if (tokens.length < 50) return false;
  for (const kw of keywords) {
    const k = kw.toLowerCase();
    if (k.length < 3) continue;
    const occurrences = tokens.filter((t) => t === k).length;
    if (occurrences / tokens.length > 0.06) return true; // >6% repetition
  }
  return false;
}

function detectFalseMetrics(bullets: string[] = [], summary = ""): string[] {
  const text = [...bullets, summary].join(" ").toLowerCase();
  const metricMatches = text.match(/\b\d{1,3}(?:[.,]\d+)?\s?(?:%|k|m|x|years?|months?|hours?|tickets|customers|users|cases|transactions|csat|nps|sla)\b/gi) ?? [];
  const fabricated: string[] = [];
  for (const m of metricMatches) {
    const norm = m.replace(/\s+/g, "").toLowerCase();
    const ok = VERIFIED_METRICS.some((v) => norm.includes(v.toLowerCase()));
    if (!ok && !/\b(0|1|2|3|4|5)\s?(years?|months?)\b/i.test(m)) {
      // Allow small experience numbers; flag everything else not in the
      // verified set.
      fabricated.push(m);
    }
  }
  return [...new Set(fabricated)].slice(0, 5);
}

export function runFinalQC(i: QCInput): QCResult {
  const failures: string[] = [];
  const warnings: string[] = [];
  const j = i.job ?? {};
  const p = i.packet ?? {};

  if (!j.company_name || j.company_name.length < 2) failures.push("missing company name");
  if (!j.title || j.title.length < 2) failures.push("missing job title");

  const salaryOK = j.salary_source === "posted_salary" ||
    ["high", "medium"].includes(j.salary_confidence ?? "");
  if (!salaryOK) failures.push("salary status not verified");

  if (!j.ats || !SUPPORTED_ATS.includes(j.ats)) {
    failures.push(`unsupported ATS platform (${j.ats ?? "n/a"})`);
  }

  if (!p.portfolio_project) warnings.push("no portfolio project assigned");

  if (!i.resume_id) failures.push("resume version not saved");
  if (!i.cover_id) failures.push("cover letter not generated");

  const bullets = p.resume?.bullets ?? [];
  const cover = p.cover?.body ?? "";
  if (bullets.length === 0) failures.push("resume bullets missing");
  if (!cover || cover.length < 200) failures.push("cover letter incomplete");

  const fabricated = detectFalseMetrics(bullets, p.resume?.summary ?? "");
  if (fabricated.length > 0) {
    failures.push(`unverifiable metrics: ${fabricated.join(", ")}`);
  }

  const keywords = p.resume?.keywords ?? [];
  if (detectKeywordStuffing(cover, keywords) || detectKeywordStuffing(bullets.join(" "), keywords)) {
    failures.push("keyword stuffing detected");
  }

  if ((p.quality?.score ?? 0) < 80) {
    failures.push(`quality score below 80 (${p.quality?.score ?? 0})`);
  }

  return { passed: failures.length === 0, failures, warnings };
}

// Resume variant assignment by role category.
export type ResumeVariantKey =
  | "data_analyst" | "operations" | "customer_success" | "product_ops" | "generic";

export function assignResumeVariant(roleCategory?: string | null, title?: string | null): ResumeVariantKey {
  const hay = `${roleCategory ?? ""} ${title ?? ""}`.toLowerCase();
  if (/\b(data analyst|business analyst|analyst|data|sql|reporting|bi)\b/.test(hay)) return "data_analyst";
  if (/\b(operations|ops|project manager|implementation|program)\b/.test(hay)) return "operations";
  if (/\b(customer success|cs|technical support|support|account manager)\b/.test(hay)) return "customer_success";
  if (/\b(product operations|product ops|product manager|revenue ops)\b/.test(hay)) return "product_ops";
  return "generic";
}

export const RESUME_VARIANT_LABEL: Record<ResumeVariantKey, string> = {
  data_analyst: "Data Analyst",
  operations: "Operations / PM",
  customer_success: "CS / Technical Support",
  product_ops: "Product Operations",
  generic: "Generic",
};
