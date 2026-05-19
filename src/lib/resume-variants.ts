// Shared variant catalog + role -> variant mapping (no server imports, safe for client)

export type ResumeVariantKey =
  | "data_analyst"
  | "operations_pm"
  | "customer_success"
  | "product_ops"
  | "technical_pm"
  | "generic";

export interface ResumeVariantSpec {
  key: ResumeVariantKey;
  label: string;
  target_role: string;
  summary: string;
  skills: string[];
  keywords: string[];
  bullets: string[];
}

export const RESUME_VARIANTS: ResumeVariantSpec[] = [
  {
    key: "data_analyst",
    label: "Data Analyst",
    target_role: "Data Analyst",
    summary:
      "Analytical operator with experience translating messy operational data into dashboards, reports, and decisions that improve conversion and retention.",
    skills: ["SQL", "Excel", "Tableau", "Looker", "Python (pandas)", "A/B testing", "Funnel analysis", "Data modeling"],
    keywords: ["SQL", "dashboards", "reporting", "analytics", "metrics", "experimentation", "ETL", "BI"],
    bullets: [
      "Built recurring SQL/Looker dashboards that surfaced churn and conversion drivers for cross-functional teams.",
      "Designed and shipped A/B tests; reported impact and recommended rollout decisions.",
      "Cleaned, modeled, and documented operational data so non-technical stakeholders could self-serve insights.",
    ],
  },
  {
    key: "operations_pm",
    label: "Operations / Project Management",
    target_role: "Operations / Project Manager",
    summary:
      "Operations and project leader who turns ambiguity into repeatable systems: SOPs, dashboards, vendor coordination, and on-time delivery.",
    skills: ["Project management", "SOPs", "Vendor management", "Process design", "Asana / Jira", "Stakeholder comms", "Budget tracking"],
    keywords: ["operations", "project management", "process", "SOP", "cross-functional", "delivery", "PMO"],
    bullets: [
      "Owned cross-functional initiatives end-to-end: scoping, scheduling, status reporting, and post-mortems.",
      "Built SOPs and runbooks that cut onboarding time and reduced repeat escalations.",
      "Coordinated vendors and internal teams to ship complex programs on time and on budget.",
    ],
  },
  {
    key: "customer_success",
    label: "Customer Success / Technical Support",
    target_role: "Customer Success / Technical Support",
    summary:
      "Customer-facing technical operator who reduces churn, accelerates onboarding, and turns frontline tickets into product and process improvements.",
    skills: ["Zendesk", "Intercom", "Salesforce", "Onboarding playbooks", "Renewal motion", "QBRs", "Technical troubleshooting"],
    keywords: ["customer success", "CSM", "technical support", "retention", "onboarding", "renewal", "QBR", "ticketing"],
    bullets: [
      "Owned a book of customers through onboarding, adoption, renewal, and expansion conversations.",
      "Resolved technical tickets, reproduced bugs with engineering, and authored customer-facing docs.",
      "Tracked health scores and proactively intervened on at-risk accounts to protect renewal revenue.",
    ],
  },
  {
    key: "product_ops",
    label: "Product Operations",
    target_role: "Product Operations",
    summary:
      "Product operations partner connecting research, GTM, support, and engineering with the rituals, tooling, and metrics that keep product teams shipping.",
    skills: ["Product analytics", "Release coordination", "Roadmap rituals", "Voice-of-customer", "Jira", "Notion", "Cross-functional comms"],
    keywords: ["product operations", "product ops", "release", "roadmap", "cross-functional", "voice of customer", "process"],
    bullets: [
      "Stood up release rituals, changelogs, and enablement so GTM and Support shipped in lockstep with product.",
      "Consolidated voice-of-customer signals from Support, Sales, and analytics into prioritized product input.",
      "Owned tooling and templates (PRDs, launch checklists, retros) used across multiple product squads.",
    ],
  },
  {
    key: "technical_pm",
    label: "Technical PM",
    target_role: "Technical Product Manager",
    summary:
      "Technical product manager comfortable in the codebase and the customer call. Ships APIs, platform features, and data products with clear scope and metrics.",
    skills: ["Roadmapping", "Specs / PRDs", "APIs", "SQL", "Stakeholder management", "Discovery", "Experimentation"],
    keywords: ["product manager", "technical PM", "APIs", "platform", "roadmap", "specs", "discovery", "experimentation"],
    bullets: [
      "Wrote PRDs and API specs for platform features used by internal teams and external developers.",
      "Ran discovery with engineering and customers to scope features against measurable success metrics.",
      "Partnered with data to instrument launches and iterate based on funnel and retention signals.",
    ],
  },
];

// Role category (job_listings.role_category / category) -> preferred variant.
// Categories are matched loosely (lowercased substring contains).
const ROLE_CATEGORY_MAP: Array<{ match: RegExp; key: ResumeVariantKey }> = [
  { match: /data|analyt|business intelligence|\bbi\b|reporting/i, key: "data_analyst" },
  { match: /technical pm|technical product|platform pm|api pm/i, key: "technical_pm" },
  { match: /product ops|product operations/i, key: "product_ops" },
  { match: /product manager|\bpm\b|product/i, key: "technical_pm" },
  { match: /customer success|csm|technical support|support engineer|implementation/i, key: "customer_success" },
  { match: /operations|project manager|program manager|\bpmo\b|business systems|strategy ops|revops/i, key: "operations_pm" },
];

export function suggestVariantForRole(
  roleCategory?: string | null,
  title?: string | null,
): ResumeVariantKey {
  const haystack = `${roleCategory ?? ""} ${title ?? ""}`.toLowerCase();
  for (const rule of ROLE_CATEGORY_MAP) {
    if (rule.match.test(haystack)) return rule.key;
  }
  return "generic";
}

export function variantLabel(key: string): string {
  return RESUME_VARIANTS.find((v) => v.key === key)?.label ?? (key === "generic" ? "Generic" : key);
}
