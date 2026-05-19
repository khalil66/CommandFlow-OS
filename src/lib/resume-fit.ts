// Resume ↔ role alignment scoring.
// Optimizes for *interview probability*, not prestige/salary.
// Calibrated to Khalil Hickson's profile (data/ops/CS/support/PM, ~3–5 yrs).

export type RoleFitTier = "strong" | "medium" | "weak" | "off";
export type CareerRealism = "attainable" | "stretch" | "unrealistic";

export interface ResumeFit {
  resume_match: number;       // 0–100
  role_fit_score: number;     // 0–100
  role_fit_tier: RoleFitTier;
  realism: CareerRealism;
  realism_score: number;      // 0–100 (higher = more attainable now)
  seniority_gap: number;      // 0 (none) … 4 (huge)
  confidence: number;         // 0–100
  matched_experience: string[];
  missing_qualifications: string[];
  explanation: string;        // one-line why
  blockers: string[];         // pushable into job_listings.blockers
}

// --- Candidate profile (Khalil) ---
const CANDIDATE = {
  years: 4,                   // realistic total relevant years
  seniority_level: 2,         // 1=entry, 2=mid (IC), 3=senior IC, 4=lead/manager, 5=director, 6=VP, 7=C-level
  domains: ["data", "operations", "customer success", "technical support",
            "product operations", "saas", "implementation", "revenue operations",
            "business analytics", "crm", "business systems", "technical pm"],
  skills: ["sql", "tableau", "excel", "salesforce", "zendesk", "python",
           "kpi", "forecasting", "reporting", "process improvement",
           "stakeholder management", "cross-functional"],
};

// --- Role fit categories (per user spec) ---
const STRONG_FIT = [
  "customer success", "operations", "crm", "technical support",
  "product operations", "product ops", "data analyst", "data analytics",
  "business analyst", "technical pm", "technical program manager",
  "saas operations", "implementation", "business systems",
  "revenue operations", "revops", "support engineer", "support specialist",
];
const MEDIUM_FIT = [
  "product manager", "project manager", "strategy ops", "strategy operations",
  "program manager", "associate pm", "associate product manager",
];
const WEAK_FIT = [
  "principal engineer", "staff engineer", "ml infrastructure",
  "machine learning infrastructure", "economist", "legal counsel",
  "senior quant", "quantitative", "staff research", "research scientist",
  "principal scientist", "deep learning", "ml platform",
];

// Seniority detection.
const SENIORITY_RX: Array<{ rx: RegExp; level: number; label: string }> = [
  { rx: /\b(c-?level|chief|cto|cpo|cfo|cmo|ceo|coo)\b/i, level: 7, label: "C-level" },
  { rx: /\b(svp|senior vice president|vp|vice president)\b/i, level: 6, label: "VP" },
  { rx: /\b(director|head of)\b/i, level: 5, label: "Director" },
  { rx: /\b(principal|staff|lead|manager|sr\.? manager)\b/i, level: 4, label: "Principal/Staff/Lead/Manager" },
  { rx: /\b(senior|sr\.?)\b/i, level: 3, label: "Senior IC" },
  { rx: /\b(associate|junior|jr\.?|entry|intern)\b/i, level: 1, label: "Entry/Associate" },
];

// Hard-block specialties that resume does not support.
const SPECIALTY_BLOCKS: Array<{ rx: RegExp; label: string }> = [
  { rx: /\beconomist\b/i, label: "Economist (PhD-track, not on resume)" },
  { rx: /\b(legal counsel|attorney|paralegal|general counsel)\b/i, label: "Legal counsel (JD required)" },
  { rx: /\b(quant|quantitative)\b.*\b(finance|trader|trading|researcher)\b/i, label: "Quant finance (specialized)" },
  { rx: /\b(ml|machine learning) (infrastructure|platform|systems)\b/i, label: "ML infrastructure (specialized)" },
  { rx: /\b(research scientist|principal scientist|phd required)\b/i, label: "Research scientist (PhD)" },
  { rx: /\b(deep learning|computer vision|nlp) (engineer|scientist)\b/i, label: "Deep ML specialist" },
  { rx: /\b(controller|cfo|treasurer|head of finance|finance director)\b/i, label: "Finance leadership (CPA/MBA finance)" },
  { rx: /\b(actuary|actuarial)\b/i, label: "Actuarial (SOA exams)" },
  { rx: /\b(medical doctor|physician|nurse practitioner|md required)\b/i, label: "Clinical credentials" },
];

function classifyTier(title: string): { tier: RoleFitTier; matched: string | null } {
  const t = title.toLowerCase();
  for (const k of STRONG_FIT) if (t.includes(k)) return { tier: "strong", matched: k };
  for (const k of MEDIUM_FIT) if (t.includes(k)) return { tier: "medium", matched: k };
  for (const k of WEAK_FIT) if (t.includes(k)) return { tier: "weak", matched: k };
  return { tier: "off", matched: null };
}

function detectSeniority(title: string): { level: number; label: string } {
  for (const s of SENIORITY_RX) if (s.rx.test(title)) return { level: s.level, label: s.label };
  return { level: 2, label: "Mid IC" };
}

function domainOverlap(text: string): { hits: string[]; score: number } {
  const t = text.toLowerCase();
  const hits = CANDIDATE.domains.filter(d => t.includes(d));
  return { hits, score: Math.min(100, hits.length * 22) };
}

function skillOverlap(text: string): { hits: string[]; missing: string[] } {
  const t = text.toLowerCase();
  const hits = CANDIDATE.skills.filter(s => t.includes(s));
  // Detect demanded specialties not on resume.
  const demanded = ["kubernetes", "terraform", "pytorch", "tensorflow", "spark", "scala",
                    "rust", "go ", "golang", "c++", "stata", "econometrics", "litigation",
                    "actuarial", "biostatistics", "cfa", "cpa", "jd ", "phd"];
  const missing = demanded.filter(d => t.includes(d));
  return { hits, missing };
}

export function evaluateResumeFit(args: {
  title: string;
  description?: string | null;
  role_category?: string | null;
}): ResumeFit {
  const title = args.title ?? "";
  const text = `${title}\n${args.description ?? ""}`;
  const blockers: string[] = [];
  const missing: string[] = [];
  const matched: string[] = [];

  // 1. Tier
  const { tier, matched: tierMatch } = classifyTier(title);
  if (tierMatch) matched.push(`role tier: ${tier} (${tierMatch})`);

  let tierScore = tier === "strong" ? 95
    : tier === "medium" ? 75
    : tier === "weak" ? 30 : 45;

  // 2. Seniority gap
  const sen = detectSeniority(title);
  const gap = Math.max(0, sen.level - CANDIDATE.seniority_level);
  let seniorityPenalty = 0;
  if (gap >= 3) { seniorityPenalty = 55; blockers.push(`seniority_gap:${sen.label}`); missing.push(`${gap}+ levels above current experience`); }
  else if (gap === 2) { seniorityPenalty = 35; blockers.push(`seniority_stretch:${sen.label}`); missing.push("1–2 levels above current experience"); }
  else if (gap === 1) { seniorityPenalty = 15; }
  else { matched.push(`seniority aligned (${sen.label})`); }

  // 3. Specialty hard blocks
  for (const sb of SPECIALTY_BLOCKS) {
    if (sb.rx.test(text)) {
      blockers.push(`unsupported_specialty:${sb.label}`);
      missing.push(sb.label);
      tierScore = Math.min(tierScore, 20);
    }
  }

  // 4. Domain overlap
  const dom = domainOverlap(text);
  if (dom.hits.length) matched.push(`domain overlap: ${dom.hits.slice(0, 3).join(", ")}`);
  else missing.push("no functional domain overlap");

  // 5. Skill overlap + demanded missing
  const sk = skillOverlap(text);
  if (sk.hits.length) matched.push(`skill overlap: ${sk.hits.slice(0, 4).join(", ")}`);
  if (sk.missing.length) {
    missing.push(`requires: ${sk.missing.slice(0, 3).join(", ")}`);
    blockers.push(`missing_required_skill:${sk.missing[0]}`);
  }

  // 6. Years of experience signal in JD
  const yearsRx = /(\d{1,2})\+?\s*(?:to\s*\d+\s*)?(?:years|yrs)/i;
  const m = text.match(yearsRx);
  const requiredYears = m ? parseInt(m[1], 10) : null;
  if (requiredYears != null) {
    if (requiredYears > CANDIDATE.years + 4) {
      blockers.push(`years_gap:${requiredYears}y required`);
      missing.push(`${requiredYears}+ yrs (resume ${CANDIDATE.years}y)`);
      seniorityPenalty += 15;
    } else if (requiredYears <= CANDIDATE.years + 2) {
      matched.push(`years aligned (${requiredYears}y req)`);
    }
  }

  // 7. Composite resume_match
  // 35% tier · 25% domain · 20% skills · 20% seniority alignment
  const skillScore = Math.min(100, sk.hits.length * 18);
  const seniorityScore = Math.max(0, 100 - seniorityPenalty);
  const resume_match = Math.round(
    tierScore * 0.35 + dom.score * 0.25 + skillScore * 0.20 + seniorityScore * 0.20
  );

  // 8. Realism
  let realism: CareerRealism;
  if (tier === "strong" && gap <= 1 && blockers.filter(b => b.startsWith("unsupported_")).length === 0) {
    realism = "attainable";
  } else if (tier === "weak" || gap >= 3 || blockers.some(b => b.startsWith("unsupported_"))) {
    realism = "unrealistic";
  } else {
    realism = "stretch";
  }
  const realism_score = realism === "attainable" ? 90 : realism === "stretch" ? 60 : 20;

  // 9. Confidence — high when we have strong signal either way
  const signalCount = matched.length + missing.length;
  const confidence = Math.min(100, 40 + signalCount * 10);

  const why =
    realism === "attainable" ? "Aligned with current experience; high interview probability."
    : realism === "stretch" ? "Plausible stretch — apply if interested, lower hit rate."
    : "Outside current experience band; deprioritize unless resume changes.";

  return {
    resume_match,
    role_fit_score: tierScore,
    role_fit_tier: tier,
    realism,
    realism_score,
    seniority_gap: gap,
    confidence,
    matched_experience: matched,
    missing_qualifications: missing,
    explanation: why,
    blockers,
  };
}
