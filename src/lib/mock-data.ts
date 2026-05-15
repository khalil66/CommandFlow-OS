export type ATSPlatform = "Greenhouse" | "Lever" | "Ashby" | "Breezy" | "Workday" | "Taleo" | "SAP" | "Other";
export const SUPPORTED_ATS: ATSPlatform[] = ["Greenhouse", "Lever", "Ashby", "Breezy"];

export type JobStatus = "Ready to Apply" | "Needs Review" | "Manual Review" | "Rejected" | "Applied" | "Interview" | "Offer";

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  remote: boolean;
  salaryMin: number;
  salaryMax: number;
  ats: ATSPlatform;
  postedDays: number;
  resumeMatch: number;
  atsCompat: number;
  legitimacy: number;
  difficulty: "Easy" | "Medium" | "Hard";
  finalScore: number;
  status: JobStatus;
  blockers: string[];
  url: string;
  description: string;
}

const COMPANIES = [
  "Linear", "Vercel", "Stripe", "Notion", "Airtable", "Retool", "Plaid", "Brex",
  "Ramp", "Mercury", "PostHog", "Segment", "Mixpanel", "Amplitude", "Snowflake",
  "Databricks", "Figma", "Loom", "Zapier", "GitLab", "HashiCorp", "Cloudflare",
  "Datadog", "Sentry", "Twilio", "Asana", "ClickUp", "Monday.com",
];

const TITLES = [
  "Data Analyst", "Senior Data Analyst", "Technical Operations Specialist",
  "Customer Success Manager", "Project Manager", "Operations Analyst",
  "Technical Support Engineer", "SaaS Support Specialist", "Revenue Operations Analyst",
  "BI Analyst", "Implementation Specialist", "Customer Operations Manager",
];

function seeded(i: number) { return (Math.sin(i * 9301 + 49297) * 233280) % 1; }
function rand(i: number, max: number, min = 0) { return Math.floor(Math.abs(seeded(i)) * (max - min) + min); }

export const MOCK_JOBS: Job[] = Array.from({ length: 42 }).map((_, i) => {
  const atsPool: ATSPlatform[] = ["Greenhouse", "Lever", "Ashby", "Breezy", "Greenhouse", "Lever", "Workday", "Taleo", "SAP"];
  const ats = atsPool[rand(i + 1, atsPool.length)];
  const supported = SUPPORTED_ATS.includes(ats);
  const resumeMatch = rand(i + 7, 100, 55);
  const atsCompat = supported ? rand(i + 13, 100, 75) : rand(i + 13, 60, 20);
  const legitimacy = rand(i + 19, 100, 45);
  const remote = rand(i + 23, 10) > 2;
  const salaryMin = rand(i + 29, 120, 70) * 1000;
  const blockers: string[] = [];
  if (!supported) blockers.push("Unsupported ATS");
  if (rand(i + 31, 10) > 8) blockers.push("Login required");
  if (rand(i + 37, 10) > 8) blockers.push("CAPTCHA detected");
  if (legitimacy < 70) blockers.push("Low legitimacy");

  const finalScore = Math.round(
    resumeMatch * 0.35 + atsCompat * 0.25 + legitimacy * 0.2 + (remote ? 10 : 0) + (supported ? 10 : 0)
  );

  let status: JobStatus = "Needs Review";
  if (legitimacy < 70 || !supported) status = "Rejected";
  else if (blockers.some(b => b.includes("Login") || b.includes("CAPTCHA"))) status = "Manual Review";
  else if (finalScore >= 90) status = "Ready to Apply";

  return {
    id: `job-${i + 1}`,
    title: TITLES[rand(i + 41, TITLES.length)],
    company: COMPANIES[rand(i + 43, COMPANIES.length)],
    location: remote ? "Remote (US)" : "Hybrid - SF",
    remote,
    salaryMin,
    salaryMax: salaryMin + rand(i + 47, 40, 20) * 1000,
    ats,
    postedDays: rand(i + 53, 14, 1),
    resumeMatch,
    atsCompat,
    legitimacy,
    difficulty: (["Easy", "Medium", "Hard"] as const)[rand(i + 59, 3)],
    finalScore,
    status,
    blockers,
    url: "#",
    description: "Drive operational excellence through data analysis, KPI dashboards, and cross-functional support workflows.",
  };
});

export const APPLIED_JOBS = MOCK_JOBS.slice(0, 14).map((j, i) => ({
  ...j,
  status: (["Applied", "Applied", "Applied", "Interview", "Interview", "Offer", "Applied"] as JobStatus[])[i % 7],
  appliedDate: new Date(Date.now() - i * 86400000 * 2).toISOString(),
  resumeVersion: ["v3-DataAnalyst", "v2-CSM", "v4-TechOps", "v3-DataAnalyst"][i % 4],
}));

export const DAILY_STATS = Array.from({ length: 14 }).map((_, i) => ({
  day: new Date(Date.now() - (13 - i) * 86400000).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  applications: rand(i + 100, 14, 3),
  responses: rand(i + 200, 5, 0),
  interviews: rand(i + 300, 3, 0),
}));

export const RESUME_VERSIONS = [
  { name: "v3-DataAnalyst", sent: 28, responses: 9, rate: 32 },
  { name: "v4-TechOps", sent: 22, responses: 6, rate: 27 },
  { name: "v2-CSM", sent: 18, responses: 4, rate: 22 },
  { name: "v1-Master", sent: 12, responses: 2, rate: 17 },
];
