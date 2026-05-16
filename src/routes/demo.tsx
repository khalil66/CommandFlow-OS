import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Briefcase, LayoutDashboard, KanbanSquare, BarChart3, FileDiff,
  Building2, FileText, ShieldCheck, Sparkles, ArrowRight, CheckCircle2,
  AlertTriangle, TrendingUp, Users2, Globe2, MapPin, BellRing, Zap,
  PlayCircle, X, ChevronLeft, ChevronRight,
} from "lucide-react";

export const Route = createFileRoute("/demo")({
  head: () => ({
    meta: [
      { title: "Apply Command — Recruiter Demo (Khalil Hickson)" },
      { name: "description", content: "Public demo of Apply Command: smart job apply, recruiter pipeline, analytics, resume diff, and company intelligence — built by Khalil Hickson." },
      { property: "og:title", content: "Apply Command — Recruiter Demo" },
      { property: "og:description", content: "Mock-data tour of an AI-assisted job-application command center. No production data, no real submissions." },
    ],
  }),
  component: DemoPage,
});

const PORTFOLIO_URL = "https://khalilhickson.com";
const CASE_STUDY_URL = "/case-study";

// ============================================================
// MOCK DATA — none of this hits Supabase, OpenAI, or Twilio
// ============================================================
const MOCK_KPIS = [
  { label: "Jobs scanned (7d)", value: 248, sub: "across 14 sources" },
  { label: "Auto-reviewed packets", value: 35, sub: "5/day cap respected" },
  { label: "Manual review queue", value: 12, sub: "human in the loop" },
  { label: "Interviews this week", value: 4, sub: "+2 vs last week" },
];

const MOCK_PIPELINE = [
  { stage: "Imported", count: 86, color: "bg-muted" },
  { stage: "Reviewed", count: 41, color: "bg-chart-1/20" },
  { stage: "Approved", count: 18, color: "bg-chart-2/30" },
  { stage: "Submitted", count: 14, color: "bg-chart-3/30" },
  { stage: "Recruiter Screen", count: 6, color: "bg-accent/30" },
  { stage: "Technical", count: 3, color: "bg-success/30" },
  { stage: "Final", count: 2, color: "bg-success/40" },
  { stage: "Offer", count: 1, color: "bg-success/60" },
];

const MOCK_ANALYTICS = [
  { name: "Greenhouse", rate: 18 },
  { name: "Ashby", rate: 22 },
  { name: "Lever", rate: 14 },
  { name: "Workday", rate: 6 },
  { name: "Breezy", rate: 11 },
];

const MOCK_RESUME_DIFF = {
  match_score: 88,
  match_improvement: 18,
  master_skills: ["SQL", "Tableau", "Excel", "Salesforce", "Zendesk", "Python", "KPI Optimization"],
  tailored_skills: ["SQL", "Tableau", "dbt", "Looker", "Snowflake", "Python", "KPI Optimization", "Cohort Analysis"],
  keywords_added: ["dbt", "Snowflake", "Looker", "Cohort Analysis"],
  master_bullets: [
    "Analyzed 10,000+ Tier 2/3 support tickets, reducing escalations by 25%.",
    "Built Tableau + SQL dashboards adopted by leadership for weekly reviews.",
  ],
  tailored_bullets: [
    "Modeled 50,000+ customer transactions in Snowflake/dbt and surfaced $1.2M+ in revenue insights via Looker.",
    "Ran cohort + retention studies that drove a 35% efficiency improvement in capacity planning.",
    "Owned Tableau KPI dashboards adopted by leadership for weekly cross-functional reviews.",
  ],
  readability: 64,
};

const MOCK_COMPANY = {
  name: "Linear",
  industry: "Developer Tools / SaaS",
  size: "201–500",
  hq: "Remote (San Francisco)",
  funding: "Series B",
  remote: "remote-first",
  competitiveness: "high",
  hiring_signals: ["Hiring across data + ops", "5+ open analytics roles", "Recent leadership posts on Twitter"],
  growth_signals: ["Series B in 2023", "Featured in YC top companies", "Strong NPS in dev community"],
  themes: ["SQL fluency", "Self-serve analytics for PMs", "Cohort + retention analysis", "Async written communication"],
  keywords: ["SQL", "dbt", "Snowflake", "Looker", "Cohort Analysis", "Self-serve", "Async", "Documentation"],
  questions: [
    "How does the data team partner with PMs on self-serve analytics?",
    "What does 'good' look like for an analyst at Linear in the first 90 days?",
    "How do you balance speed with rigor on experiments?",
  ],
};

const MOCK_PACKET = {
  job_title: "Senior Data Analyst",
  company: "Linear",
  ats: "Greenhouse",
  salary: "$140k–$180k",
  match: 88,
  confidence: "Strong Match",
  why_company: "Linear's analyst role maps cleanly to revenue/ops analytics work — cohort retention, self-serve dashboards, async written rigor.",
  talking_points: [
    "Surfaced $1.2M+ in revenue via cohort studies",
    "Built Tableau dashboards adopted by leadership",
    "92% forecasting accuracy on capacity models",
  ],
  recruiter_qs: ["Walk me through your most impactful dashboard.", "Tell me about a time you pushed back on a metric definition."],
};

const MOCK_SAFETY = [
  { label: "Auto-submit", on: false, note: "Disabled by design — every packet is human-reviewed before sending." },
  { label: "Browser automation", on: false, note: "No headless browser, no scraping, no stealth evasion." },
  { label: "CAPTCHA / MFA / login walls", on: false, note: "Detected and routed to Manual Review immediately. Never bypassed." },
  { label: "Auto-review daily cap", on: true, note: "Hard cap of 5/day. Manual override always available." },
  { label: "Manual Review fallback", on: true, note: "Anything ambiguous defaults to a human in the loop." },
];

// ============================================================
// PAGE
// ============================================================
function DemoPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Public top bar (no sidebar) */}
      <header className="border-b border-border bg-card">
        <div className="max-w-[1400px] mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent text-accent-foreground">
              <Briefcase className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-semibold leading-none">Apply Command</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">Recruiter demo · Khalil Hickson</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="default" onClick={() => window.dispatchEvent(new CustomEvent("start-walkthrough"))}>
              <PlayCircle className="h-4 w-4 mr-1.5" /> Start guided walkthrough
            </Button>
            <Button asChild variant="ghost" size="sm"><a href={PORTFOLIO_URL} target="_blank" rel="noopener noreferrer">← Portfolio</a></Button>
            <Button asChild variant="outline" size="sm"><Link to="/case-study">Case Study</Link></Button>
            <Button asChild size="sm"><a href={`${PORTFOLIO_URL}#contact`} target="_blank" rel="noopener noreferrer">Request Walkthrough</a></Button>
          </div>
        </div>
      </header>

      <WalkthroughTour />

      <main className="max-w-[1400px] mx-auto px-6 py-10 space-y-12">
        {/* Hero */}
        <section className="text-center max-w-3xl mx-auto space-y-4">
          <Badge variant="outline" className="border-accent/40 text-accent">Read-only recruiter demo · all data is mock</Badge>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">An AI-assisted job-application command center</h1>
          <p className="text-base text-muted-foreground leading-relaxed">
            Built by Khalil Hickson — a working tool that imports jobs, scores fit, drafts tailored resumes + cover letters,
            tracks recruiter responses, and surfaces what's actually converting. Nothing is auto-submitted; every send is a deliberate human action.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground pt-2">
            <Badge variant="secondary">No login required</Badge>
            <Badge variant="secondary">No real submissions</Badge>
            <Badge variant="secondary">No production data</Badge>
            <Badge variant="secondary">No browser automation</Badge>
          </div>
        </section>

        {/* Dashboard */}
        <Section id="tour-dashboard" icon={LayoutDashboard} title="Dashboard preview" subtitle="The morning briefing — what shipped, what's queued, what needs you.">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {MOCK_KPIS.map((k) => (
              <Card key={k.label}><CardContent className="p-5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.label}</div>
                <div className="mt-2 text-3xl font-semibold tabular-nums">{k.value}</div>
                <div className="mt-1 text-xs text-muted-foreground">{k.sub}</div>
              </CardContent></Card>
            ))}
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Zap className="h-4 w-4 text-accent" /> Today's Smart Apply summary</CardTitle></CardHeader>
            <CardContent className="text-sm grid grid-cols-2 md:grid-cols-3 gap-4">
              <Stat label="Jobs scanned" value="62" />
              <Stat label="Fresh imported (0–3 days)" value="9" />
              <Stat label="Auto-reviewed" value="5 / 5 cap" />
              <Stat label="Manual review" value="3" />
              <Stat label="Safety-blocked" value="2" tone="warn" />
              <Stat label="Best source" value="Ashby (22%)" tone="good" />
            </CardContent>
          </Card>
        </Section>

        {/* Pipeline */}
        <Section id="tour-pipeline" icon={KanbanSquare} title="Recruiting pipeline preview" subtitle="A visual CRM from imported job → offer. Drag-and-drop in the live app.">
          <div className="overflow-x-auto pb-2">
            <div className="flex gap-3 min-w-max">
              {MOCK_PIPELINE.map((s) => (
                <div key={s.stage} className="w-44 shrink-0">
                  <div className={`px-3 py-2 rounded-t-md ${s.color} border border-border border-b-0`}>
                    <div className="text-xs font-medium">{s.stage}</div>
                    <div className="text-2xl font-semibold tabular-nums mt-1">{s.count}</div>
                  </div>
                  <div className="p-2 space-y-1.5 border border-border rounded-b-md bg-card min-h-[100px]">
                    {Array.from({ length: Math.min(3, Math.ceil(s.count / 5)) }).map((_, i) => (
                      <div key={i} className="text-[11px] p-2 rounded border border-border/60 bg-background">
                        <div className="font-medium truncate">Mock Co {i + 1}</div>
                        <div className="text-muted-foreground truncate">Data Analyst</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* Analytics */}
        <Section id="tour-analytics" icon={BarChart3} title="Analytics preview" subtitle="Response rate by ATS, recruiter heatmap, resume version performance.">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Response rate by ATS</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {MOCK_ANALYTICS.map((a) => (
                  <div key={a.name} className="flex items-center gap-3">
                    <div className="w-24 text-xs">{a.name}</div>
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-accent" style={{ width: `${a.rate * 4}%` }} />
                    </div>
                    <div className="text-sm font-semibold tabular-nums w-12 text-right text-accent">{a.rate}%</div>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Recruiter response heatmap (mock)</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-24 gap-0.5" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
                  {Array.from({ length: 7 * 24 }).map((_, i) => {
                    const intensity = Math.max(0, Math.sin(i / 6) * 0.6 + Math.random() * 0.4);
                    return (
                      <div
                        key={i}
                        className="aspect-square rounded-sm"
                        style={{ background: intensity < 0.05 ? "var(--color-muted)" : `color-mix(in oklab, var(--color-accent) ${Math.round(intensity * 100)}%, var(--color-card))` }}
                      />
                    );
                  })}
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">Tue–Thu, 10am–2pm produces the highest reply rate.</p>
              </CardContent>
            </Card>
          </div>
        </Section>

        {/* Resume Diff */}
        <Section id="tour-resume" icon={FileDiff} title="Resume Diff preview" subtitle="Master profile vs tailored resume — keywords added, bullets rewritten, ATS readability.">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Match score" value={`${MOCK_RESUME_DIFF.match_score}/100`} tone="good" />
            <Stat label="Δ vs master" value={`+${MOCK_RESUME_DIFF.match_improvement}`} tone="good" />
            <Stat label="Keywords added" value={MOCK_RESUME_DIFF.keywords_added.length} />
            <Stat label="Readability" value={MOCK_RESUME_DIFF.readability} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Master (baseline)</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-1">
                  {MOCK_RESUME_DIFF.master_skills.map((s) => <Badge key={s} variant="outline">{s}</Badge>)}
                </div>
                <ul className="space-y-2 text-sm">
                  {MOCK_RESUME_DIFF.master_bullets.map((b, i) => <li key={i} className="flex gap-2"><span className="text-muted-foreground">•</span>{b}</li>)}
                </ul>
              </CardContent>
            </Card>
            <Card className="border-accent/30">
              <CardHeader><CardTitle className="text-base">Tailored — Linear · Senior Data Analyst</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-1">
                  {MOCK_RESUME_DIFF.tailored_skills.map((s) => {
                    const added = MOCK_RESUME_DIFF.keywords_added.includes(s);
                    return <Badge key={s} className={added ? "bg-success/15 text-success border-success/30" : ""} variant={added ? "default" : "outline"}>
                      {added && <CheckCircle2 className="h-3 w-3 mr-1" />}{s}
                    </Badge>;
                  })}
                </div>
                <ul className="space-y-2 text-sm">
                  {MOCK_RESUME_DIFF.tailored_bullets.map((b, i) => <li key={i} className="flex gap-2"><span className="text-accent">→</span>{b}</li>)}
                </ul>
              </CardContent>
            </Card>
          </div>
        </Section>

        {/* Company Intelligence */}
        <Section id="tour-company" icon={Building2} title="Company intelligence preview" subtitle="Enriched profile with interview themes, role competitiveness, and questions to ask.">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{MOCK_COMPANY.name}</CardTitle>
              <p className="text-xs text-muted-foreground">{MOCK_COMPANY.industry}</p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Fact icon={Globe2} label="Industry" value={MOCK_COMPANY.industry} />
                <Fact icon={Users2} label="Size" value={MOCK_COMPANY.size} />
                <Fact icon={MapPin} label="HQ" value={MOCK_COMPANY.hq} />
                <Fact icon={TrendingUp} label="Funding" value={MOCK_COMPANY.funding} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">Remote: {MOCK_COMPANY.remote}</Badge>
                <Badge variant="outline" className="border-destructive/40 text-destructive">Competitiveness: {MOCK_COMPANY.competitiveness}</Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <BulletList title="Hiring signals" items={MOCK_COMPANY.hiring_signals} accent="text-success" />
                <BulletList title="Growth signals" items={MOCK_COMPANY.growth_signals} accent="text-accent" />
                <BulletList title="Likely interview themes" items={MOCK_COMPANY.themes} />
                <BulletList title="Questions to ask the interviewer" items={MOCK_COMPANY.questions} />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Company-specific keywords</div>
                <div className="flex flex-wrap gap-1">{MOCK_COMPANY.keywords.map((k) => <Badge key={k} variant="secondary">{k}</Badge>)}</div>
              </div>
            </CardContent>
          </Card>
        </Section>

        {/* Application Packet */}
        <Section id="tour-interview" icon={FileText} title="Application packet preview" subtitle="Everything Khalil reviews before sending an application — by hand.">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-lg">{MOCK_PACKET.job_title}</CardTitle>
                  <p className="text-xs text-muted-foreground">{MOCK_PACKET.company} · {MOCK_PACKET.ats} · {MOCK_PACKET.salary}</p>
                </div>
                <div className="flex gap-2">
                  <Badge>Match {MOCK_PACKET.match}/100</Badge>
                  <Badge variant="secondary">{MOCK_PACKET.confidence}</Badge>
                  <Badge variant="outline">Status: Manual Review</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Why this company</div>
                <p className="leading-relaxed">{MOCK_PACKET.why_company}</p>
              </div>
              <BulletList title="Talking points" items={MOCK_PACKET.talking_points} accent="text-accent" />
              <BulletList title="Likely recruiter questions" items={MOCK_PACKET.recruiter_qs} />
              <p className="text-[11px] text-muted-foreground italic">Manual Review only · No auto-submit · No browser automation. Approving marks the application ready for Khalil to submit by hand.</p>
            </CardContent>
          </Card>
        </Section>

        {/* Safety */}
        <Section id="tour-smart-apply" icon={ShieldCheck} title="Safety controls preview" subtitle="What this tool will not do. By design.">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {MOCK_SAFETY.map((s) => (
              <Card key={s.label}>
                <CardContent className="p-4 flex items-start gap-3">
                  {s.on
                    ? <CheckCircle2 className="h-5 w-5 mt-0.5 text-success" />
                    : <AlertTriangle className="h-5 w-5 mt-0.5 text-destructive" />}
                  <div>
                    <div className="text-sm font-medium flex items-center gap-2">
                      {s.label}
                      <Badge variant={s.on ? "default" : "destructive"} className="text-[10px]">{s.on ? "ENFORCED" : "DISABLED"}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">{s.note}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </Section>

        {/* CTA */}
        <section className="border border-accent/30 bg-accent/5 rounded-xl p-8 md:p-10 text-center space-y-4">
          <Sparkles className="h-8 w-8 text-accent mx-auto" />
          <h2 className="text-2xl font-semibold tracking-tight">Want the full story?</h2>
          <p className="text-sm text-muted-foreground max-w-xl mx-auto">
            The case study walks through what's been shipped, the safety design, and the recruiting metrics this tool has produced for Khalil's own job search.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
            <Button asChild size="lg"><Link to="/case-study">View Case Study <ArrowRight className="h-4 w-4 ml-1.5" /></Link></Button>
            <Button asChild variant="outline" size="lg"><a href={`${PORTFOLIO_URL}#contact`} target="_blank" rel="noopener noreferrer">Request Live Walkthrough</a></Button>
            <Button asChild variant="ghost" size="lg"><a href={PORTFOLIO_URL} target="_blank" rel="noopener noreferrer">Back to Portfolio</a></Button>
          </div>
          <p className="text-[11px] text-muted-foreground pt-2">
            Built and maintained by <span className="font-medium">Khalil Hickson</span> · Jacksonville, FL · Remote-first
          </p>
        </section>
      </main>

      <footer className="border-t border-border bg-card mt-12">
        <div className="max-w-[1400px] mx-auto px-6 py-6 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>© Apply Command · Recruiter demo</span>
          <span className="flex items-center gap-1.5"><BellRing className="h-3 w-3" /> All data on this page is mock — no production data is shown or written.</span>
        </div>
      </footer>
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================
function Section({ id, icon: Icon, title, subtitle, children }: any) {
  return (
    <section id={id} className="space-y-4 scroll-mt-24">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent/10 text-accent shrink-0"><Icon className="h-5 w-5" /></div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

const TOUR_STEPS: { id: string; title: string; body: string }[] = [
  { id: "tour-dashboard", title: "1. Dashboard overview", body: "The morning briefing — KPIs, today's Smart Apply summary, and what's queued for review." },
  { id: "tour-smart-apply", title: "2. Smart Apply safety system", body: "Auto-submit, browser automation, and login-wall evasion are disabled by design. Anything ambiguous routes to Manual Review." },
  { id: "tour-resume", title: "3. Resume tailoring engine", body: "Master profile vs tailored resume — keywords added, bullets rewritten, ATS readability scored." },
  { id: "tour-company", title: "4. Company trust scoring", body: "Enriched profile with hiring signals, interview themes, role competitiveness, and questions to ask." },
  { id: "tour-interview", title: "5. Interview probability scoring", body: "Match scores, confidence labels, talking points and likely recruiter questions per application." },
  { id: "tour-pipeline", title: "6. Recruiter CRM pipeline", body: "Visual CRM from imported job → offer with stage counts and drag-and-drop in the live app." },
  { id: "tour-analytics", title: "7. Analytics & learning loop", body: "Response rates by ATS, recruiter heatmap, resume version performance — the feedback that closes the loop." },
];

function WalkthroughTour() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const start = () => { setStep(0); setOpen(true); };
    window.addEventListener("start-walkthrough", start);
    return () => window.removeEventListener("start-walkthrough", start);
  }, []);

  useEffect(() => {
    if (!open) return;
    const el = document.getElementById(TOUR_STEPS[step].id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [open, step]);

  if (!open) return null;
  const s = TOUR_STEPS[step];
  const isLast = step === TOUR_STEPS.length - 1;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[min(560px,calc(100vw-2rem))]">
      <div className="rounded-xl border border-accent/40 bg-card shadow-2xl p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-accent font-semibold">Guided walkthrough · {step + 1} of {TOUR_STEPS.length}</div>
            <div className="mt-1 text-base font-semibold">{s.title}</div>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{s.body}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Exit tour"><X className="h-4 w-4" /></Button>
        </div>
        <div className="flex items-center gap-1">
          {TOUR_STEPS.map((_, i) => (
            <div key={i} className={`h-1 flex-1 rounded-full ${i <= step ? "bg-accent" : "bg-muted"}`} />
          ))}
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Exit tour</Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            {isLast ? (
              <Button size="sm" onClick={() => setOpen(false)}>Finish</Button>
            ) : (
              <Button size="sm" onClick={() => setStep((s) => Math.min(TOUR_STEPS.length - 1, s + 1))}>
                Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


function Stat({ label, value, tone }: { label: string; value: any; tone?: "good" | "warn" }) {
  const color = tone === "good" ? "text-success" : tone === "warn" ? "text-warning-foreground" : "";
  return (
    <div className="p-3 rounded-md border border-border bg-card">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function Fact({ icon: Icon, label, value }: any) {
  return (
    <div className="p-3 rounded-md border border-border">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground"><Icon className="h-3 w-3" /> {label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}

function BulletList({ title, items, accent }: { title: string; items: string[]; accent?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{title}</div>
      <ul className="space-y-1.5 text-sm">
        {items.map((s, i) => <li key={i} className={`flex gap-2 ${accent ?? ""}`}><span className="text-muted-foreground">•</span>{s}</li>)}
      </ul>
    </div>
  );
}
