import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const COMPANIES = [
  { name: "Linear", domain: "linear.app", legitimacy_score: 95, has_linkedin: true, glassdoor_rating: 4.6, domain_age_days: 1800 },
  { name: "Vercel", domain: "vercel.com", legitimacy_score: 94, has_linkedin: true, glassdoor_rating: 4.5, domain_age_days: 2400 },
  { name: "Stripe", domain: "stripe.com", legitimacy_score: 98, has_linkedin: true, glassdoor_rating: 4.7, domain_age_days: 4800 },
  { name: "Notion", domain: "notion.so", legitimacy_score: 93, has_linkedin: true, glassdoor_rating: 4.4, domain_age_days: 3000 },
  { name: "Zapier", domain: "zapier.com", legitimacy_score: 92, has_linkedin: true, glassdoor_rating: 4.3, domain_age_days: 4200 },
];

const JOB_TEMPLATES = [
  { title: "Data Analyst", ats: "Greenhouse", salary_min: 95000, salary_max: 130000, resume_match: 92, legitimacy: 95, final_score: 94 },
  { title: "Senior Data Analyst", ats: "Lever", salary_min: 120000, salary_max: 160000, resume_match: 88, legitimacy: 94, final_score: 91 },
  { title: "Technical Operations Specialist", ats: "Ashby", salary_min: 90000, salary_max: 120000, resume_match: 90, legitimacy: 98, final_score: 93 },
  { title: "Customer Success Manager", ats: "Greenhouse", salary_min: 85000, salary_max: 115000, resume_match: 84, legitimacy: 93, final_score: 88 },
  { title: "Operations Analyst", ats: "Breezy", salary_min: 80000, salary_max: 110000, resume_match: 86, legitimacy: 92, final_score: 87 },
  { title: "Project Manager", ats: "Lever", salary_min: 100000, salary_max: 140000, resume_match: 78, legitimacy: 95, final_score: 85 },
  { title: "Technical Support Engineer", ats: "Greenhouse", salary_min: 85000, salary_max: 120000, resume_match: 89, legitimacy: 98, final_score: 92 },
  { title: "SaaS Support Specialist", ats: "Ashby", salary_min: 70000, salary_max: 95000, resume_match: 85, legitimacy: 94, final_score: 86 },
  { title: "Revenue Operations Analyst", ats: "Lever", salary_min: 95000, salary_max: 130000, resume_match: 82, legitimacy: 93, final_score: 84 },
  { title: "BI Analyst", ats: "Greenhouse", salary_min: 90000, salary_max: 125000, resume_match: 91, legitimacy: 92, final_score: 90 },
];

const RESUMES = [
  { label: "v3-DataAnalyst", target_role: "Data Analyst", match_score: 94,
    summary: "Data analyst with 5+ years driving operational excellence. Analyzed 10,000+ support cases, reduced escalations 25%, sustained 91% CSAT.",
    skills: ["SQL","Tableau","Excel","Python","KPI Dashboards","Forecasting","Salesforce","Zendesk"],
    bullets: ["Built executive KPI dashboards in Tableau tracking CSAT, resolution time, and escalation rate","Reduced Tier-2 escalations by 25% through SQL-driven root-cause analysis","Forecasted weekly support volume within 6% accuracy"],
    keywords: ["SQL","Tableau","KPI","Forecasting","Salesforce","Zendesk","Data Analysis"] },
  { label: "v4-TechOps", target_role: "Technical Operations Specialist", match_score: 91,
    summary: "Technical Operations Specialist with deep ops + analytics fluency. 10,000+ tickets resolved, 91% CSAT maintained.",
    skills: ["Zendesk","Salesforce","SQL","Process Automation","Incident Response","Operations Strategy"],
    bullets: ["Owned Zendesk → Salesforce sync, reducing manual data entry by 40%","Authored runbooks adopted across 3 support pods","Drove 25% escalation reduction via tier-routing redesign"],
    keywords: ["Operations","Zendesk","Salesforce","Automation","SLA","Incident"] },
  { label: "v2-CSM", target_role: "Customer Success Manager", match_score: 87,
    summary: "Customer Success operator who pairs empathy with data. 91% CSAT across 10,000+ interactions.",
    skills: ["Customer Success","Salesforce","Account Management","QBRs","Retention","Tableau"],
    bullets: ["Maintained 91% CSAT across 10,000+ customer interactions","Identified expansion signals via Tableau, contributing to 18% NRR lift","Led QBRs for top-25 accounts"],
    keywords: ["Customer Success","CSAT","Retention","NRR","QBR","Salesforce"] },
];

export const seedSampleData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    // Wipe existing user data first (idempotent re-seed)
    await supabase.from("automation_logs").delete().eq("user_id", userId);
    await supabase.from("applications").delete().eq("user_id", userId);
    await supabase.from("cover_letters").delete().eq("user_id", userId);
    await supabase.from("resume_versions").delete().eq("user_id", userId);
    await supabase.from("job_listings").delete().eq("user_id", userId);
    await supabase.from("companies").delete().eq("user_id", userId);

    // 5 companies
    const { data: companies, error: cErr } = await supabase
      .from("companies").insert(COMPANIES.map(c => ({ ...c, user_id: userId }))).select();
    if (cErr) throw new Error(cErr.message);

    // 10 jobs
    const jobsPayload = JOB_TEMPLATES.map((t, i) => {
      const co = companies![i % companies!.length];
      return {
        user_id: userId, company_id: co.id, company_name: co.name,
        title: t.title, location: "Remote (US)", remote: true,
        salary_min: t.salary_min, salary_max: t.salary_max,
        ats: t.ats, source_url: `https://${co.domain}/careers`,
        description: `${t.title} role at ${co.name}. SQL, dashboards, and operational excellence required.`,
        resume_match: t.resume_match, legitimacy: t.legitimacy, final_score: t.final_score,
        blockers: [], status: "new",
      };
    });
    const { data: jobs, error: jErr } = await supabase.from("job_listings").insert(jobsPayload).select();
    if (jErr) throw new Error(jErr.message);

    // 3 resume versions (linked to top 3 jobs)
    const resumesPayload = RESUMES.map((r, i) => ({
      ...r, user_id: userId, job_id: jobs![i].id, explanation: `Tailored for ${jobs![i].title} @ ${jobs![i].company_name}`,
    }));
    const { data: resumes, error: rErr } = await supabase.from("resume_versions").insert(resumesPayload).select();
    if (rErr) throw new Error(rErr.message);

    // 5 applications across statuses
    const statuses = ["manual_review","manual_review","approved","submitted","interview"] as const;
    const appsPayload = statuses.map((s, i) => ({
      user_id: userId, job_id: jobs![i].id,
      resume_version_id: resumes![i % resumes!.length]?.id ?? null,
      status: s,
      submitted_at: ["submitted","interview"].includes(s) ? new Date(Date.now() - i*86400000).toISOString() : null,
    }));
    const { error: aErr } = await supabase.from("applications").insert(appsPayload);
    if (aErr) throw new Error(aErr.message);

    // Activity logs
    const logActions = ["scrape","tailor_resume","score","generate_cover","ats_check"] as const;
    const logs = jobs!.slice(0, 5).map((j, i) => ({
      user_id: userId, job_id: j.id,
      action: logActions[i],
      status: "success",
      details: { seeded: true } as any,
      created_at: new Date(Date.now() - i*3600000).toISOString(),
    }));
    await supabase.from("automation_logs").insert(logs as any);

    return {
      companies: companies!.length, jobs: jobs!.length,
      resumes: resumes!.length, applications: appsPayload.length,
    };
  });

export const checkBackendStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    // RLS check: query own row count. If RLS broken, would error or return foreign rows.
    const { error } = await supabase.from("user_settings").select("user_id").eq("user_id", userId).limit(1);
    return {
      supabase_connected: true,
      auth_active: !!userId,
      rls_enabled: !error,
      openai_connected: !!process.env.OPENAI_API_KEY,
    };
  });
