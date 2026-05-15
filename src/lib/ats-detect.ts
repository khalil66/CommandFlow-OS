// ATS platform detection from a careers / job board URL.
// Supported = jobs we can ingest via public JSON APIs (no login, captcha, MFA).
// Rejected = walled/login-gated platforms that violate Manual Review constraints.

export type SupportedAts = "Greenhouse" | "Lever" | "Ashby" | "Breezy";
export type RejectedAts = "Workday" | "Taleo" | "SAP SuccessFactors" | "iCIMS" | "Oracle" | "Brassring";

export interface AtsDetection {
  supported: boolean;
  platform: SupportedAts | RejectedAts | "Unknown";
  slug: string | null;
  reason?: string;
}

const REJECTED_PATTERNS: Array<[RegExp, RejectedAts]> = [
  [/myworkdayjobs\.com|workday\.com/i, "Workday"],
  [/taleo\.net/i, "Taleo"],
  [/successfactors\.com|sapsf\.com/i, "SAP SuccessFactors"],
  [/icims\.com/i, "iCIMS"],
  [/oraclecloud\.com|oracle\.com\/.*recruit/i, "Oracle"],
  [/brassring\.com|kenexa\.com/i, "Brassring"],
];

export function detectAts(url: string): AtsDetection {
  if (!url) return { supported: false, platform: "Unknown", slug: null, reason: "Empty URL" };
  let u: URL;
  try { u = new URL(url); } catch { return { supported: false, platform: "Unknown", slug: null, reason: "Invalid URL" }; }
  const host = u.hostname.toLowerCase();
  const path = u.pathname;

  // Rejected
  for (const [re, name] of REJECTED_PATTERNS) {
    if (re.test(host) || re.test(url)) {
      return { supported: false, platform: name, slug: null, reason: `${name} requires login / MFA / captcha` };
    }
  }

  // Greenhouse: boards.greenhouse.io/{slug} OR job-boards.greenhouse.io/{slug}
  if (/greenhouse\.io/.test(host)) {
    const slug = path.split("/").filter(Boolean)[0] || null;
    return { supported: !!slug, platform: "Greenhouse", slug, reason: slug ? undefined : "Missing company slug" };
  }
  // Lever: jobs.lever.co/{slug}
  if (/lever\.co/.test(host)) {
    const slug = path.split("/").filter(Boolean)[0] || null;
    return { supported: !!slug, platform: "Lever", slug, reason: slug ? undefined : "Missing company slug" };
  }
  // Ashby: jobs.ashbyhq.com/{slug}
  if (/ashbyhq\.com/.test(host)) {
    const slug = path.split("/").filter(Boolean)[0] || null;
    return { supported: !!slug, platform: "Ashby", slug, reason: slug ? undefined : "Missing company slug" };
  }
  // Breezy: {slug}.breezy.hr
  if (/breezy\.hr/.test(host)) {
    const slug = host.split(".")[0] || null;
    return { supported: !!slug && slug !== "app", platform: "Breezy", slug, reason: slug ? undefined : "Missing company subdomain" };
  }

  return {
    supported: false,
    platform: "Unknown",
    slug: null,
    reason: "Unsupported ATS — only Greenhouse, Lever, Ashby, and Breezy are supported.",
  };
}

// Parse a salary range from free-form text. Returns USD ints or nulls.
const SALARY_RE = /\$?\s*(\d{2,3})[,]?(\d{3})?\s*[kK]?\s*(?:-|–|to)\s*\$?\s*(\d{2,3})[,]?(\d{3})?\s*[kK]?/;
export function parseSalary(text?: string | null): { min: number | null; max: number | null } {
  if (!text) return { min: null, max: null };
  const m = text.replace(/\s+/g, " ").match(SALARY_RE);
  if (!m) {
    // Single value: "$85,000" or "$85k"
    const single = text.match(/\$\s*(\d{2,3})[,]?(\d{3})?\s*[kK]?/);
    if (!single) return { min: null, max: null };
    const v = toNumber(single[1], single[2], /k/i.test(single[0]));
    return { min: v, max: v };
  }
  const min = toNumber(m[1], m[2], /k/i.test(m[0]));
  const max = toNumber(m[3], m[4], /k/i.test(m[0]));
  return { min, max };
}

function toNumber(a: string, b: string | undefined, isK: boolean): number {
  if (b) return parseInt(a + b, 10);
  const n = parseInt(a, 10);
  return isK ? n * 1000 : n;
}

// Normalize description text → strip HTML.
export function stripHtml(html?: string | null): string {
  if (!html) return "";
  return html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

const SCAM_RED = /captcha|sign\s?in to apply|log\s?in to apply|create an account to apply|multi[- ]?factor/i;
export function hasAccessBlockers(text: string): string[] {
  const out: string[] = [];
  if (SCAM_RED.test(text)) out.push("login/captcha/MFA in posting");
  return out;
}

export function isRemote(text: string, location?: string | null): boolean {
  const blob = `${location ?? ""} ${text}`.toLowerCase();
  if (/\b(on[- ]?site|onsite|in[- ]?office)\b/.test(blob) && !/remote/.test(blob)) return false;
  return /\bremote\b|work from home|wfh|distributed/.test(blob);
}
