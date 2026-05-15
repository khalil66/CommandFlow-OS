// Khalil Hickson — portfolio project map by role category.
// Source: khalilhickson.com (project shortlist + role mapping).

export type RoleCategory =
  | "Data Analyst" | "Business Analyst" | "Operations Analyst"
  | "Project Coordinator" | "Associate Project Manager" | "Project Manager"
  | "Product Operations Analyst" | "Customer Success Manager"
  | "Technical Support Engineer" | "SaaS Support Specialist"
  | "Implementation Specialist" | "Revenue Operations Analyst";

export const ROLE_TO_PROJECTS: Record<string, string[]> = {
  "Data Analyst": ["Customer Revenue Intelligence Model", "Support Command Center Dashboard"],
  "Business Analyst": ["Customer Revenue Intelligence Model", "Operations Forecasting Model"],
  "Operations Analyst": ["Operations Forecasting Model", "Support Command Center Dashboard"],
  "Project Coordinator": ["Support Command Center Dashboard", "Operations Forecasting Model"],
  "Associate Project Manager": ["Support Command Center Dashboard", "Operations Forecasting Model"],
  "Project Manager": ["Support Command Center Dashboard", "Operations Forecasting Model"],
  "Product Operations Analyst": ["Operations Forecasting Model", "Customer Revenue Intelligence Model"],
  "Customer Success Manager": ["Support Command Center Dashboard"],
  "Technical Support Engineer": ["Support Command Center Dashboard"],
  "SaaS Support Specialist": ["Support Command Center Dashboard"],
  "Implementation Specialist": ["Support Command Center Dashboard", "Operations Forecasting Model"],
  "Revenue Operations Analyst": ["Customer Revenue Intelligence Model", "Operations Forecasting Model"],
};

export function projectsForRole(role: string | null | undefined): string[] {
  if (!role) return [];
  if (ROLE_TO_PROJECTS[role]) return ROLE_TO_PROJECTS[role];
  const lower = role.toLowerCase();
  if (lower.includes("data")) return ROLE_TO_PROJECTS["Data Analyst"];
  if (lower.includes("operations")) return ROLE_TO_PROJECTS["Operations Analyst"];
  if (lower.includes("customer success")) return ROLE_TO_PROJECTS["Customer Success Manager"];
  if (lower.includes("project")) return ROLE_TO_PROJECTS["Project Manager"];
  if (lower.includes("support")) return ROLE_TO_PROJECTS["Technical Support Engineer"];
  if (lower.includes("revenue")) return ROLE_TO_PROJECTS["Revenue Operations Analyst"];
  if (lower.includes("product")) return ROLE_TO_PROJECTS["Product Operations Analyst"];
  return ["Support Command Center Dashboard"];
}

export const PORTFOLIO_URL = "https://khalilhickson.com";
