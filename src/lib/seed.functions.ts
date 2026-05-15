import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { computeTrustScore } from "./scoring";

type Cat = "saas"|"data"|"cs_ops"|"product_pm"|"remote_first"|"mba_friendly"|"other";

interface SeedCo {
  name: string; domain: string; category: Cat;
  is_remote_first?: boolean; mba_friendly?: boolean;
  hiring_activity?: number; funding_stage?: string;
  glassdoor_rating?: number; domain_age_days?: number;
}

const SEED_COMPANIES: SeedCo[] = [
  // SaaS startups
  { name: "Linear", domain: "linear.app", category: "saas", is_remote_first: true, hiring_activity: 90, glassdoor_rating: 4.6, domain_age_days: 1800, funding_stage: "Series B" },
  { name: "Retool", domain: "retool.com", category: "saas", is_remote_first: true, hiring_activity: 85, glassdoor_rating: 4.4, domain_age_days: 2200, funding_stage: "Series C" },
  { name: "Airtable", domain: "airtable.com", category: "saas", hiring_activity: 80, glassdoor_rating: 4.3, domain_age_days: 4400, funding_stage: "Series F" },
  { name: "Notion", domain: "notion.so", category: "saas", is_remote_first: true, hiring_activity: 88, glassdoor_rating: 4.4, domain_age_days: 3000, funding_stage: "Series C" },
  { name: "ClickUp", domain: "clickup.com", category: "saas", hiring_activity: 78, glassdoor_rating: 4.0, domain_age_days: 2400 },

  // Data / analytics
  { name: "Snowflake", domain: "snowflake.com", category: "data", hiring_activity: 92, glassdoor_rating: 4.5, domain_age_days: 4500, funding_stage: "Public" },
  { name: "Databricks", domain: "databricks.com", category: "data", hiring_activity: 95, glassdoor_rating: 4.5, domain_age_days: 4200, funding_stage: "Series I" },
  { name: "Mixpanel", domain: "mixpanel.com", category: "data", hiring_activity: 75, glassdoor_rating: 4.2, domain_age_days: 5000 },
  { name: "Amplitude", domain: "amplitude.com", category: "data", hiring_activity: 82, glassdoor_rating: 4.3, domain_age_days: 4800, funding_stage: "Public" },
  { name: "PostHog", domain: "posthog.com", category: "data", is_remote_first: true, hiring_activity: 88, glassdoor_rating: 4.6, domain_age_days: 1900 },

  // Customer success / operations
  { name: "Zendesk", domain: "zendesk.com", category: "cs_ops", hiring_activity: 80, glassdoor_rating: 4.0, domain_age_days: 6200 },
  { name: "Intercom", domain: "intercom.com", category: "cs_ops", hiring_activity: 78, glassdoor_rating: 4.1, domain_age_days: 5400 },
  { name: "HubSpot", domain: "hubspot.com", category: "cs_ops", hiring_activity: 90, glassdoor_rating: 4.4, domain_age_days: 6800, funding_stage: "Public" },
  { name: "Front", domain: "front.com", category: "cs_ops", hiring_activity: 72, glassdoor_rating: 4.1, domain_age_days: 3800 },
  { name: "Gainsight", domain: "gainsight.com", category: "cs_ops", hiring_activity: 70, glassdoor_rating: 4.3, domain_age_days: 4500 },

  // Product / project management
  { name: "Asana", domain: "asana.com", category: "product_pm", hiring_activity: 82, glassdoor_rating: 4.0, domain_age_days: 5200, funding_stage: "Public" },
  { name: "Monday.com", domain: "monday.com", category: "product_pm", hiring_activity: 88, glassdoor_rating: 4.2, domain_age_days: 4800, funding_stage: "Public" },
  { name: "Atlassian", domain: "atlassian.com", category: "product_pm", hiring_activity: 90, glassdoor_rating: 4.3, domain_age_days: 7800, funding_stage: "Public" },
  { name: "Productboard", domain: "productboard.com", category: "product_pm", hiring_activity: 70, glassdoor_rating: 4.2, domain_age_days: 2800 },
  { name: "Smartsheet", domain: "smartsheet.com", category: "product_pm", hiring_activity: 76, glassdoor_rating: 4.0, domain_age_days: 5800 },

  // Remote-first tech
  { name: "GitLab", domain: "gitlab.com", category: "remote_first", is_remote_first: true, hiring_activity: 92, glassdoor_rating: 4.4, domain_age_days: 5100, funding_stage: "Public" },
  { name: "Zapier", domain: "zapier.com", category: "remote_first", is_remote_first: true, hiring_activity: 80, glassdoor_rating: 4.5, domain_age_days: 4500 },
  { name: "Cloudflare", domain: "cloudflare.com", category: "remote_first", hiring_activity: 90, glassdoor_rating: 4.3, domain_age_days: 5800, funding_stage: "Public" },
  { name: "HashiCorp", domain: "hashicorp.com", category: "remote_first", is_remote_first: true, hiring_activity: 78, glassdoor_rating: 4.2, domain_age_days: 4200, funding_stage: "Public" },
  { name: "Doist", domain: "doist.com", category: "remote_first", is_remote_first: true, hiring_activity: 60, glassdoor_rating: 4.5, domain_age_days: 5500 },

  // MBA-friendly
  { name: "Stripe", domain: "stripe.com", category: "mba_friendly", mba_friendly: true, hiring_activity: 95, glassdoor_rating: 4.7, domain_age_days: 4800, funding_stage: "Series I" },
  { name: "Brex", domain: "brex.com", category: "mba_friendly", mba_friendly: true, hiring_activity: 80, glassdoor_rating: 4.0, domain_age_days: 2500, funding_stage: "Series D" },
  { name: "Ramp", domain: "ramp.com", category: "mba_friendly", mba_friendly: true, hiring_activity: 92, glassdoor_rating: 4.5, domain_age_days: 1800, funding_stage: "Series D" },
  { name: "Mercury", domain: "mercury.com", category: "mba_friendly", mba_friendly: true, hiring_activity: 85, glassdoor_rating: 4.4, domain_age_days: 2200, funding_stage: "Series C" },
  { name: "Plaid", domain: "plaid.com", category: "mba_friendly", mba_friendly: true, hiring_activity: 82, glassdoor_rating: 4.3, domain_age_days: 3800, funding_stage: "Series D" },
];

export const seedSampleData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    // Wipe existing user data for a clean re-seed
    await supabase.from("automation_logs").delete().eq("user_id", userId);
    await supabase.from("verification_checks").delete().eq("user_id", userId);
    await supabase.from("daily_batches").delete().eq("user_id", userId);
    await supabase.from("applications").delete().eq("user_id", userId);
    await supabase.from("cover_letters").delete().eq("user_id", userId);
    await supabase.from("resume_versions").delete().eq("user_id", userId);
    await supabase.from("job_listings").delete().eq("user_id", userId);
    await supabase.from("companies").delete().eq("user_id", userId);

    // 1. Companies with verification scores
    const companiesPayload = SEED_COMPANIES.map((c) => {
      const trust = computeTrustScore({
        has_official_site: true, has_careers_page: true, has_linkedin: true,
        ats_domain_match: true,
        business_footprint_score: Math.min(100, (c.domain_age_days ?? 1000) / 30),
        news_signals_count: Math.round((c.glassdoor_rating ?? 4.0) * 2),
      });
      return {
        user_id: userId, name: c.name, domain: c.domain, category: c.category,
        is_remote_first: !!c.is_remote_first, mba_friendly: !!c.mba_friendly,
        hiring_activity: c.hiring_activity ?? 70,
        funding_stage: c.funding_stage,
        careers_url: `https://${c.domain}/careers`,
        linkedin_url: `https://linkedin.com/company/${c.name.toLowerCase().replace(/\W+/g, "")}`,
        has_linkedin: true,
        glassdoor_rating: c.glassdoor_rating,
        domain_age_days: c.domain_age_days,
        trust_score: trust.score,
        verification_status: trust.decision,
        red_flags: trust.red_flags,
        legitimacy_score: trust.score,
      };
    });

    const { data: companies, error: cErr } = await supabase
      .from("companies").insert(companiesPayload as any).select();
    if (cErr) throw new Error(cErr.message);

    // 2. verification_checks rows
    const checks = (companies ?? []).map((co: any) => ({
      user_id: userId, company_id: co.id,
      has_official_site: true, has_careers_page: true, has_linkedin: true,
      ats_domain_match: true,
      business_footprint_score: Math.min(100, Math.round((co.domain_age_days ?? 1000) / 30)),
      news_signals_count: Math.round((co.glassdoor_rating ?? 4.0) * 2),
      scam_flags: [], personal_email_domain: false, payment_request: false,
      score: co.trust_score, decision: co.verification_status,
      raw: { auto_seeded: true } as any,
    }));
    await supabase.from("verification_checks").insert(checks as any);

    // 3. Resume versions (3 templates)
    const RESUMES = [
      { label: "v3-DataAnalyst", target_role: "Data Analyst", match_score: 94,
        summary: "Data analyst with proof points across 50,000+ transactions, $1.2M+ revenue analysis, and 92% forecasting accuracy. Built KPI dashboards in SQL + Tableau used by leadership.",
        skills: ["SQL","Tableau","Excel","Python","KPI Dashboards","Forecasting","Salesforce","Zendesk"],
        bullets: [
          "Analyzed 50,000+ transactions and $1.2M+ in revenue to surface a Customer Revenue Intelligence Model used by ops + finance.",
          "Built executive Tableau dashboards tracking CSAT, resolution time, and escalation rate; sustained 91% CSAT.",
          "Forecasted weekly support volume within 8% (92% accuracy), enabling 35% fulfillment efficiency gains.",
        ],
        keywords: ["SQL","Tableau","KPI","Forecasting","Salesforce","Zendesk","Data Analysis","MBA Data Analytics"] },
      { label: "v4-TechOps", target_role: "Technical Operations Specialist", match_score: 91,
        summary: "Technical Operations Specialist who pairs SQL fluency with hands-on support ops. 10,000+ Tier 2/3 tickets analyzed, 24-hour avg resolution, 92% SLA compliance.",
        skills: ["Zendesk","Salesforce","SQL","Process Automation","Incident Response","Operations Strategy"],
        bullets: [
          "Owned the Zendesk → Salesforce reporting pipeline; cut manual data entry by 40%.",
          "Drove 25% reduction in escalations through tier-routing redesign across 10,000+ Tier 2/3 cases.",
          "Maintained 92% SLA compliance with a 24-hour average resolution time across the support pod.",
        ],
        keywords: ["Operations","Zendesk","Salesforce","Automation","SLA","Incident","KPI"] },
      { label: "v2-CSM", target_role: "Customer Success Manager", match_score: 87,
        summary: "Customer Success operator who blends empathy with data: 91% CSAT across 10,000+ interactions, retention modeling on 50,000+ transactions.",
        skills: ["Customer Success","Salesforce","Account Management","QBRs","Retention","Tableau"],
        bullets: [
          "Sustained 91% CSAT across 10,000+ customer interactions.",
          "Identified expansion signals via Tableau dashboards, contributing to an 18% NRR lift.",
          "Led QBRs for top-25 accounts, surfacing $1.2M+ in revenue insights.",
        ],
        keywords: ["Customer Success","CSAT","Retention","NRR","QBR","Salesforce"] },
    ];

    const jobsForResumes = (companies ?? []).slice(0, 3);
    const resumesPayload = RESUMES.map((r, i) => ({
      ...r, user_id: userId, job_id: null,
      explanation: `Tailored for ${r.target_role} roles at ${jobsForResumes[i]?.name ?? "high-fit"} companies.`,
    }));
    await supabase.from("resume_versions").insert(resumesPayload as any);

    // 4. Activity log entries
    const logActions = ["scrape","tailor_resume","score","ats_check","generate_cover"] as const;
    const logs = (companies ?? []).slice(0, 5).map((co: any, i) => ({
      user_id: userId, action: logActions[i], status: "success",
      details: { seeded: true, company: co.name } as any,
      created_at: new Date(Date.now() - i*3600000).toISOString(),
    }));
    await supabase.from("automation_logs").insert(logs as any);

    return {
      companies: companies?.length ?? 0,
      jobs: 0,                       // jobs are produced by runDailyBatch
      resumes: resumesPayload.length,
      applications: 0,
      verification_checks: checks.length,
    };
  });

export const checkBackendStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("user_settings").select("user_id").eq("user_id", userId).limit(1);
    return {
      supabase_connected: true,
      auth_active: !!userId,
      rls_enabled: !error,
      openai_connected: !!process.env.OPENAI_API_KEY,
    };
  });
