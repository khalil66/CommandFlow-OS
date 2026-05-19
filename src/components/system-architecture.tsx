import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Globe, LayoutDashboard, Brain, Workflow, Database, Bell, ShieldCheck, ArrowRight,
} from "lucide-react";

type Layer = {
  id: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  accent: string; // tailwind classes for accent border/text
  items: string[];
};

const LAYERS: Layer[] = [
  {
    id: "public",
    title: "Public Presentation Layer",
    subtitle: "Recruiter-facing, no auth, no production data",
    icon: <Globe className="h-4 w-4" />,
    accent: "border-l-emerald-500/70",
    items: ["Public Sandbox", "Case Study", "Recruiter Demo", "Portfolio Website"],
  },
  {
    id: "app",
    title: "Private Application Layer",
    subtitle: "Authenticated operator workspace",
    icon: <LayoutDashboard className="h-4 w-4" />,
    accent: "border-l-sky-500/70",
    items: [
      "Authenticated Dashboard",
      "Smart Apply Control Center",
      "Manual Review Queue",
      "Safe Auto-Submit Dashboard",
      "Executive Command Center",
    ],
  },
  {
    id: "intel",
    title: "Intelligence Layer",
    subtitle: "Scoring, learning, and resume strategy",
    icon: <Brain className="h-4 w-4" />,
    accent: "border-l-indigo-500/70",
    items: [
      "Resume Variant Optimizer",
      "Outcome Learning Engine",
      "Interview Probability Scoring",
      "Company Trust Scoring",
      "Salary Enrichment",
      "Career Realism Scoring",
    ],
  },
  {
    id: "auto",
    title: "Automation & Workflow Layer",
    subtitle: "Pipeline orchestration with human-in-the-loop",
    icon: <Workflow className="h-4 w-4" />,
    accent: "border-l-teal-500/70",
    items: [
      "ATS Ingestion",
      "Application Packet Builder",
      "Recruiter CRM Pipeline",
      "Follow-Up Scheduler",
      "Dry Run Auto-Submit",
      "Safety Block Routing",
    ],
  },
  {
    id: "data",
    title: "Data & Security Layer",
    subtitle: "User-owned data with row-level isolation",
    icon: <Database className="h-4 w-4" />,
    accent: "border-l-cyan-500/70",
    items: [
      "Supabase Auth",
      "Row Level Security",
      "PostgreSQL Tables",
      "User-Owned Data",
      "Audit Logs",
      "Monitoring Logs",
    ],
  },
  {
    id: "ai",
    title: "AI + Notification Layer",
    subtitle: "Generative drafting and operator alerts",
    icon: <Bell className="h-4 w-4" />,
    accent: "border-l-violet-500/70",
    items: [
      "OpenAI Resume / Packet Generation",
      "Twilio SMS Alerts",
      "Monitoring Alerts",
      "Weekly Recommendations",
    ],
  },
  {
    id: "safety",
    title: "Safety & Compliance Layer",
    subtitle: "Hard-coded guardrails — never bypassed",
    icon: <ShieldCheck className="h-4 w-4" />,
    accent: "border-l-amber-500/70",
    items: [
      "No CAPTCHA bypass",
      "No MFA bypass",
      "No login-wall evasion",
      "No stealth automation",
      "Manual Review fallback",
      "Emergency pause",
      "Daily caps enforced",
    ],
  },
];

const FLOW = [
  "ATS Sources",
  "Ingestion",
  "Filtering",
  "Trust Scoring",
  "Resume Matching",
  "Packet Generation",
  "Review / Submit",
  "Outcome Tracking",
  "Learning Loop",
  "Recommendations",
];

const METRICS = [
  "11-factor trust scoring",
  "14-day freshness filter",
  "30-day duplicate guard",
  "5/day Auto Review cap",
  "3/day Safe Auto-Submit cap",
  "25/day AI generation cap",
  "Outcome-based recalibration",
];

export function SystemArchitecture() {
  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
          System Architecture
        </Badge>
        <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
          A layered, audit-friendly platform
        </h2>
        <p className="text-muted-foreground max-w-3xl">
          A secure AI-powered recruiting operations platform combining ATS ingestion, company
          verification, resume intelligence, outcome learning, and executive analytics.
        </p>
      </div>

      {/* Flow strip */}
      <Card className="border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.04] via-background to-sky-500/[0.04]">
        <CardContent className="p-5">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-3">
            End-to-end flow
          </p>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
            {FLOW.map((step, i) => (
              <div key={step} className="flex items-center gap-1.5">
                <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-card border">
                  {step}
                </span>
                {i < FLOW.length - 1 && (
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0" />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Layers grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {LAYERS.map((layer) => (
          <Card key={layer.id} className={`border-l-4 ${layer.accent}`}>
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-md bg-muted grid place-items-center">
                  {layer.icon}
                </div>
                <div>
                  <p className="text-sm font-semibold leading-tight">{layer.title}</p>
                  <p className="text-xs text-muted-foreground">{layer.subtitle}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {layer.items.map((it) => (
                  <span
                    key={it}
                    className="text-xs px-2 py-1 rounded border bg-card/60 text-foreground/90"
                  >
                    {it}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Metric callouts */}
      <div>
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-3">
          Built-in guardrails & metrics
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {METRICS.map((m) => (
            <div
              key={m}
              className="rounded-lg border bg-card p-3 text-sm flex items-center gap-2"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {m}
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        No private data, recruiter PII, or API keys are referenced in this diagram.
      </p>
    </section>
  );
}
