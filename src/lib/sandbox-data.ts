// Pure client-safe simulated demo data for /sandbox. No real APIs, no DB hits.

export const SANDBOX_KPIS = {
  applications_today: 23,
  interview_probability_avg: 64,
  recruiter_response_rate: 32,
  top_ats: "Greenhouse",
  best_variant: "Customer Success",
  top_category: "SaaS · Mid-market",
  queue_backlog: 41,
  interview_conversion: 28,
};

export const SANDBOX_FUNNEL = [
  { label: "Imported", value: 412 },
  { label: "Approved", value: 187 },
  { label: "Submitted", value: 142 },
  { label: "Recruiter Reply", value: 46 },
  { label: "Interview", value: 18 },
  { label: "Offer", value: 4 },
];

export const SANDBOX_ATS = [
  { ats: "Greenhouse", apps: 64, reply_rate: 38 },
  { ats: "Lever", apps: 41, reply_rate: 31 },
  { ats: "Ashby", apps: 22, reply_rate: 27 },
  { ats: "Workday", apps: 15, reply_rate: 12 },
];

export const SANDBOX_CATEGORIES = [
  { category: "Customer Success", apps: 58, interview_rate: 32 },
  { category: "Product Operations", apps: 34, interview_rate: 29 },
  { category: "Data Analyst", apps: 27, interview_rate: 22 },
  { category: "Technical PM", apps: 18, interview_rate: 17 },
  { category: "Operations / PM", apps: 25, interview_rate: 24 },
];

export const SANDBOX_VARIANTS = [
  { variant: "Customer Success", apps: 42, response_rate: 38, interview_rate: 31 },
  { variant: "Product Ops", apps: 31, response_rate: 29, interview_rate: 24 },
  { variant: "Data Analyst", apps: 28, response_rate: 26, interview_rate: 19 },
  { variant: "Operations / PM", apps: 22, response_rate: 24, interview_rate: 18 },
  { variant: "Technical PM", apps: 19, response_rate: 21, interview_rate: 14 },
];

export const SANDBOX_ACTIVITY = [
  { ts: "09:42", kind: "import", text: "Imported 12 new roles from Greenhouse" },
  { ts: "09:48", kind: "approval", text: "Approved Sr. CSM @ Acme (interview prob 78%)" },
  { ts: "10:02", kind: "submit", text: "Submitted application via Lever" },
  { ts: "10:14", kind: "reply", text: "Recruiter replied: Vector AI — interview requested" },
  { ts: "10:31", kind: "interview", text: "Interview scheduled with Northwind, Thu 2pm" },
  { ts: "10:47", kind: "import", text: "Imported 8 new roles from Ashby" },
  { ts: "11:05", kind: "reply", text: "Recruiter replied: Lumen Labs — phone screen" },
  { ts: "11:22", kind: "submit", text: "Submitted application via Greenhouse" },
];

export const SANDBOX_RECOMMENDATIONS = [
  { title: "Double down on Customer Success", detail: "31% interview rate vs 22% portfolio avg — push 5 more this week." },
  { title: "Apply Tue–Thu mornings", detail: "Recruiter replies are 2.1× higher in the 8–11am window." },
  { title: "Lead with the CS variant", detail: "Highest response rate (38%) across 42 tracked apps." },
  { title: "Pause Workday-only postings", detail: "12% reply rate, 3× higher safety-block rate. Low ROI." },
];

export const SANDBOX_TRENDS = [
  { day: "Mon", responses: 6, interviews: 2 },
  { day: "Tue", responses: 9, interviews: 4 },
  { day: "Wed", responses: 11, interviews: 5 },
  { day: "Thu", responses: 8, interviews: 3 },
  { day: "Fri", responses: 5, interviews: 2 },
  { day: "Sat", responses: 2, interviews: 1 },
  { day: "Sun", responses: 5, interviews: 1 },
];
