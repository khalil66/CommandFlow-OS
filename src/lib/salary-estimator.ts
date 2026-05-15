// Salary Confidence + Compensation Enrichment.
// Pure functions — safe in browser, server fns, and Node test scripts.
//
// Decision flow (replaces the hard salary-gate failure):
//   1. Detect disqualifiers (internship / unpaid / commission-only / volunteer).
//   2. If posted salary present → use it.
//   3. Otherwise estimate from title / role / company / remote, with a confidence
//      label.
//   4. Resolve gate status: pass / manual / reject.

export const SALARY_FLOOR = 55000;

export type SalarySource =
  | "posted_salary"
  | "estimated_from_title"
  | "estimated_from_market"
  | "missing";

export type SalaryConfidence = "high" | "medium" | "low" | "unknown";
export type SalaryGateStatus = "pass" | "manual" | "reject";

export interface SalaryEnrichment {
  posted_min: number | null;
  posted_max: number | null;
  estimated_min: number | null;
  estimated_max: number | null;
  source: SalarySource;
  confidence: SalaryConfidence;
  gate_status: SalaryGateStatus;
  gate_reason: string;
}

// -------- Posted-salary parsing -------- //

const SALARY_RANGE_RE =
  /\$?\s*(\d{2,3})[,]?(\d{3})?\s*[kK]?\s*(?:-|–|to)\s*\$?\s*(\d{2,3})[,]?(\d{3})?\s*[kK]?/;
const SALARY_SINGLE_RE = /\$\s*(\d{2,3})[,]?(\d{3})?\s*[kK]?/;

function toNum(a: string, b: string | undefined, isK: boolean): number {
  if (b) return parseInt(a + b, 10);
  const n = parseInt(a, 10);
  return isK ? n * 1000 : n;
}

export function parsePostedSalary(text?: string | null): {
  min: number | null;
  max: number | null;
} {
  if (!text) return { min: null, max: null };
  const t = text.replace(/\s+/g, " ");
  const r = t.match(SALARY_RANGE_RE);
  if (r) {
    const isK = /k/i.test(r[0]);
    return { min: toNum(r[1], r[2], isK), max: toNum(r[3], r[4], isK) };
  }
  const s = t.match(SALARY_SINGLE_RE);
  if (s) {
    const isK = /k/i.test(s[0]);
    const v = toNum(s[1], s[2], isK);
    return { min: v, max: v };
  }
  return { min: null, max: null };
}

// -------- Disqualifier detection -------- //

const DISQUALIFY_RE =
  /\b(unpaid|volunteer|internship|intern\b|commission[- ]only|equity[- ]only|stipend[- ]only)\b/i;

export function detectDisqualifier(title: string, description: string): string | null {
  const blob = `${title} ${description}`;
  const m = blob.match(DISQUALIFY_RE);
  return m ? m[1].toLowerCase() : null;
}

// -------- Market estimator -------- //
// Conservative ranges by role family. Floors are intentionally chosen to
// stay above $55K only for roles where remote market data supports it.

interface RoleEstimate {
  min: number;
  max: number;
  confidence: SalaryConfidence;
  category: string;
}

const ROLE_RULES: Array<{ re: RegExp; base: RoleEstimate }> = [
  // Engineering / data — high confidence well above floor
  { re: /\b(software|backend|frontend|full[- ]?stack|mobile|ios|android|platform|infrastructure|devops|sre|reliability|ml|machine learning|data) (engineer|developer)\b/i,
    base: { min: 110000, max: 180000, confidence: "high", category: "engineering" } },
  { re: /\b(data scientist|machine learning|applied scientist|research scientist)\b/i,
    base: { min: 120000, max: 200000, confidence: "high", category: "data_science" } },
  { re: /\b(data analyst|business analyst|financial analyst|operations analyst|marketing analyst)\b/i,
    base: { min: 70000, max: 110000, confidence: "high", category: "analytics" } },
  // Product / design
  { re: /\b(product manager|product owner|technical product manager)\b/i,
    base: { min: 110000, max: 180000, confidence: "high", category: "product" } },
  { re: /\b(product designer|ux designer|ui designer|design lead)\b/i,
    base: { min: 95000, max: 160000, confidence: "high", category: "design" } },
  // GTM / customer
  { re: /\b(customer success manager|customer success|account manager|account executive)\b/i,
    base: { min: 75000, max: 130000, confidence: "high", category: "customer_success" } },
  { re: /\b(technical support engineer|solutions engineer|sales engineer|implementation)\b/i,
    base: { min: 80000, max: 140000, confidence: "high", category: "support_eng" } },
  { re: /\b(marketing manager|growth manager|content manager|brand manager|partnerships)\b/i,
    base: { min: 80000, max: 140000, confidence: "high", category: "marketing" } },
  { re: /\b(operations manager|business operations|strategy|chief of staff|program manager)\b/i,
    base: { min: 90000, max: 150000, confidence: "high", category: "operations" } },
  // Roles where missing salary is actually risky → manual
  { re: /\b(project coordinator|recruiting coordinator|operations coordinator|community manager)\b/i,
    base: { min: 50000, max: 80000, confidence: "medium", category: "coordinator" } },
  { re: /\b(customer support|support specialist|support representative|csr)\b/i,
    base: { min: 45000, max: 70000, confidence: "medium", category: "support" } },
  // Generic engineer / manager fallbacks
  { re: /\bengineer\b/i,
    base: { min: 95000, max: 160000, confidence: "medium", category: "engineering_other" } },
  { re: /\bmanager\b/i,
    base: { min: 90000, max: 150000, confidence: "medium", category: "manager_other" } },
];

const SENIORITY_MULTIPLIER: Array<{ re: RegExp; mult: number; label: string }> = [
  { re: /\b(staff|principal|distinguished|fellow)\b/i, mult: 1.45, label: "staff+" },
  { re: /\b(senior|sr\.?|lead)\b/i,                    mult: 1.20, label: "senior" },
  { re: /\b(junior|jr\.?|entry|associate|i{1,2}\b)\b/i, mult: 0.78, label: "junior" },
];

function applySeniority(base: RoleEstimate, title: string): { min: number; max: number; label: string } {
  for (const s of SENIORITY_MULTIPLIER) {
    if (s.re.test(title)) {
      return {
        min: Math.round(base.min * s.mult),
        max: Math.round(base.max * s.mult),
        label: s.label,
      };
    }
  }
  return { min: base.min, max: base.max, label: "mid" };
}

export function estimateFromMarket(args: {
  title: string;
  description?: string;
  remote?: boolean;
  companyCategory?: string | null;
}): { min: number; max: number; confidence: SalaryConfidence; basis: string } | null {
  const t = args.title || "";
  for (const rule of ROLE_RULES) {
    if (rule.re.test(t)) {
      const adj = applySeniority(rule.base, t);
      // Remote-only generally trims top end slightly vs. SF/NY but lifts bottom
      // for distributed companies; net wash → keep range. Big-tech / unicorn
      // bumps mid-range.
      let { min, max } = adj;
      if (args.companyCategory === "big_tech" || args.companyCategory === "unicorn") {
        min = Math.round(min * 1.10);
        max = Math.round(max * 1.15);
      }
      return {
        min, max,
        confidence: rule.base.confidence,
        basis: `${rule.base.category} · ${adj.label}`,
      };
    }
  }
  return null;
}

// -------- Composed enrichment + gate decision -------- //

export function enrichSalary(args: {
  title: string;
  description?: string;
  remote?: boolean;
  companyCategory?: string | null;
  postedMin?: number | null;
  postedMax?: number | null;
}): SalaryEnrichment {
  const { title, description = "" } = args;
  const dq = detectDisqualifier(title, description);

  let postedMin = args.postedMin ?? null;
  let postedMax = args.postedMax ?? null;
  if (postedMin == null && postedMax == null) {
    const parsed = parsePostedSalary(description);
    postedMin = parsed.min;
    postedMax = parsed.max;
  }

  // 1. Hard reject — disqualifier without an above-floor posted salary
  if (dq && (postedMin == null || postedMin < SALARY_FLOOR)) {
    return {
      posted_min: postedMin, posted_max: postedMax,
      estimated_min: null, estimated_max: null,
      source: postedMin != null ? "posted_salary" : "missing",
      confidence: postedMin != null ? "high" : "unknown",
      gate_status: "reject",
      gate_reason: `Disqualifier: ${dq}${postedMin != null ? ` · posted $${postedMin} below floor` : ""}`,
    };
  }

  // 2. Posted salary present
  if (postedMin != null) {
    if (postedMin < SALARY_FLOOR) {
      return {
        posted_min: postedMin, posted_max: postedMax,
        estimated_min: null, estimated_max: null,
        source: "posted_salary", confidence: "high",
        gate_status: "reject",
        gate_reason: `Posted $${postedMin.toLocaleString()} below $${SALARY_FLOOR.toLocaleString()} floor`,
      };
    }
    return {
      posted_min: postedMin, posted_max: postedMax,
      estimated_min: null, estimated_max: null,
      source: "posted_salary", confidence: "high",
      gate_status: "pass",
      gate_reason: `Posted salary $${postedMin.toLocaleString()}+ ≥ floor`,
    };
  }

  // 3. No posted salary → estimate
  const est = estimateFromMarket(args);
  if (!est) {
    return {
      posted_min: null, posted_max: null,
      estimated_min: null, estimated_max: null,
      source: "missing", confidence: "unknown",
      gate_status: "manual",
      gate_reason: "No posted salary and no market match — manual review",
    };
  }

  const source: SalarySource =
    est.confidence === "high" ? "estimated_from_title" : "estimated_from_market";

  if (est.min < SALARY_FLOOR) {
    // Estimated below floor — only manual when low confidence; reject when
    // the market estimate is high-confidence below floor.
    if (est.confidence === "high") {
      return {
        posted_min: null, posted_max: null,
        estimated_min: est.min, estimated_max: est.max,
        source, confidence: est.confidence,
        gate_status: "reject",
        gate_reason: `Market estimate $${est.min.toLocaleString()} below floor (high confidence · ${est.basis})`,
      };
    }
    return {
      posted_min: null, posted_max: null,
      estimated_min: est.min, estimated_max: est.max,
      source, confidence: est.confidence,
      gate_status: "manual",
      gate_reason: `Estimate below floor with ${est.confidence} confidence (${est.basis}) — manual review`,
    };
  }

  // Estimated ≥ floor
  if (est.confidence === "high" || est.confidence === "medium") {
    return {
      posted_min: null, posted_max: null,
      estimated_min: est.min, estimated_max: est.max,
      source, confidence: est.confidence,
      gate_status: "pass",
      gate_reason: `Estimated $${est.min.toLocaleString()}-$${est.max.toLocaleString()} ≥ floor (${est.confidence} · ${est.basis})`,
    };
  }

  return {
    posted_min: null, posted_max: null,
    estimated_min: est.min, estimated_max: est.max,
    source, confidence: est.confidence,
    gate_status: "manual",
    gate_reason: `Low salary confidence (${est.basis}) — manual review`,
  };
}

export function salaryStatusLabel(s: SalaryGateStatus): string {
  return s === "pass" ? "Salary gate ✓" : s === "reject" ? "Below floor / disqualified" : "Salary needs review";
}
