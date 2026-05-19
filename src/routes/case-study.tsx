import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ShieldCheck, Brain, Database, Workflow, BarChart3, Lock, Sparkles,
  Building2, FileText, Target, Zap, GitBranch, ArrowRight, CheckCircle2,
  TrendingUp, Layers, Cpu, Cloud, XCircle,
} from "lucide-react";
import { SystemArchitecture } from "@/components/system-architecture";
import { CinematicHero, GlassStat, Reveal } from "@/components/cinematic-hero";

export const Route = createFileRoute("/case-study")({
  head: () => ({
    meta: [
      { title: "Case Study — AI-Powered Remote Job Application Intelligence Platform" },
      { name: "description", content: "Executive case study: an AI-assisted recruiting intelligence platform combining ATS verification, company trust scoring, resume optimization, and analytics — all under a manual-review safety model." },
      { property: "og:title", content: "AI-Powered Remote Job Application Intelligence Platform" },
      { property: "og:description", content: "Verified remote-job intelligence with ATS optimization, trust scoring, and an AI learning loop. Manual-review only." },
    ],
  }),
  component: CaseStudy,
});

function CaseStudy() {
  return (
    <div className="min-h-screen bg-background">
      {/* HERO */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 bg-gradient-to-br from-accent/10 via-background to-background" />
        <div className="relative max-w-6xl mx-auto px-6 py-20">
          <Badge className="mb-4 bg-accent/15 text-accent border-accent/30">Case Study · 2026</Badge>
          <h1 className="text-4xl md:text-6xl font-semibold tracking-tight leading-[1.05]">
            AI-Powered Remote Job<br />
            <span className="text-accent">Application Intelligence Platform</span>
          </h1>
          <p className="mt-6 text-lg md:text-xl text-muted-foreground max-w-3xl leading-relaxed">
            A verified remote-job intelligence engine that combines ATS optimization, company trust scoring,
            and AI-assisted application preparation — operated entirely under a manual-review workflow.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild className="bg-accent text-accent-foreground hover:bg-accent/90">
              <Link to="/demo">View Public Demo <ArrowRight className="h-4 w-4 ml-1.5" /></Link>
            </Button>
            <Button variant="outline" asChild><a href="#summary">Read Full Case Study</a></Button>
            <Button variant="outline" asChild><a href="https://khalilhickson.com#contact" target="_blank" rel="noopener noreferrer">Request Live Walkthrough</a></Button>
            <Button variant="outline" asChild><a href="https://khalilhickson.com" target="_blank" rel="noopener noreferrer">View Resume</a></Button>
          </div>
          <div className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-4">
            <HeroStat value="30+" label="Verified Companies" />
            <HeroStat value="11-factor" label="Trust Scoring" />
            <HeroStat value="25/day" label="AI Generation Cap" />
            <HeroStat value="100%" label="Manual Review" />
          </div>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-6 py-16 space-y-20">

        <SystemArchitecture />



        {/* EXEC SUMMARY */}
        <Section id="summary" eyebrow="01" title="Executive Summary">
          <p className="text-lg text-muted-foreground leading-relaxed">
            Job seekers in 2026 face an asymmetric market: thousands of remote postings, opaque ATS filters,
            inconsistent salary disclosure, and a flood of low-trust listings. This platform inverts the
            workflow — instead of mass applying, it ingests verified roles from supported ATS platforms,
            scores company trust, generates tailored application packets, and surfaces only high-probability
            matches to a single operator for manual review.
          </p>
          <div className="grid md:grid-cols-3 gap-4 mt-6">
            <Pillar icon={ShieldCheck} title="Verified" desc="Only roles from Greenhouse, Lever, Ashby, Breezy. No login-required, no Workday/Taleo/SAP." />
            <Pillar icon={Brain} title="AI-Assisted" desc="Resume tailoring, cover letters, talking points — all human-reviewed before any submission." />
            <Pillar icon={Target} title="Outcome-Driven" desc="Learning loop tracks response rates by resume version, role category, and ATS." />
          </div>
        </Section>

        {/* PROBLEM */}
        <Section id="problem" eyebrow="02" title="Problem Statement">
          <div className="grid md:grid-cols-2 gap-6">
            <ProblemCard title="Signal-to-noise collapse" body="Job boards surface thousands of roles per day, most without salary, many from unverified or shell companies." />
            <ProblemCard title="ATS opacity" body="Each ATS scores resumes differently. Generic resumes underperform without keyword alignment per posting." />
            <ProblemCard title="Wasted preparation cost" body="Hours spent tailoring applications for low-trust or low-fit companies erodes interview-ready energy." />
            <ProblemCard title="No feedback loop" body="Most applicants never learn which resume version, role category, or company type actually converts." />
          </div>
        </Section>

        {/* SOLUTION ARCHITECTURE */}
        <Section id="architecture" eyebrow="03" title="Solution Architecture">
          <p className="text-muted-foreground mb-8">A modular intelligence pipeline. Every stage is observable, rate-limited, and ownership-checked.</p>
          <ArchitectureDiagram />
          <div className="grid md:grid-cols-3 gap-4 mt-8">
            <ArchCard icon={Cloud} title="Lovable Frontend" desc="React + TanStack Start, SSR-ready routes, type-safe RPC." />
            <ArchCard icon={Database} title="Supabase Backend" desc="Postgres with RLS on every table, auth, realtime, storage." />
            <ArchCard icon={Sparkles} title="OpenAI Integration" desc="GPT-4o-mini for generation, per-user daily caps, full usage telemetry." />
            <ArchCard icon={Download} title="ATS Ingestion Layer" desc="Greenhouse / Lever / Ashby / Breezy adapters with platform detection." />
            <ArchCard icon={BarChart3} title="Analytics Engine" desc="Response-rate learning loop, cost tracking, recommendation surfacing." />
            <ArchCard icon={FileText} title="Packet Generation" desc="Resume + cover + talking points + portfolio match per role." />
          </div>
        </Section>

        {/* ATS VERIFICATION */}
        <Section id="ats" eyebrow="04" title="ATS Verification Engine">
          <FeatureSplit
            metrics={[
              { k: "4", v: "Supported ATS platforms" },
              { k: "5+", v: "Auto-rejected platforms" },
              { k: "100%", v: "URL-pattern verified" },
            ]}
            body="Every career URL is parsed and platform-detected before ingestion. Greenhouse, Lever, Ashby, and Breezy are supported. Workday, Taleo, SAP, iCIMS, login-required, CAPTCHA, and MFA-gated postings are rejected at the ingest layer — they never enter the queue."
          />
        </Section>

        {/* TRUST SCORING */}
        <Section id="trust" eyebrow="05" title="Company Trust Scoring System">
          <p className="text-muted-foreground mb-6">An 11-factor model evaluates every company before its roles surface to review.</p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
            {[
              "Domain age", "ATS verified", "Funding signal", "Headcount range",
              "Glassdoor presence", "LinkedIn footprint", "Press mentions",
              "Salary disclosure", "Remote policy", "Hiring velocity",
              "Repeat-posting pattern",
            ].map((f) => (
              <div key={f} className="flex items-center gap-2 p-3 rounded-md border border-border bg-card text-sm">
                <CheckCircle2 className="h-4 w-4 text-success shrink-0" /> {f}
              </div>
            ))}
          </div>
        </Section>

        {/* RESUME ENGINE */}
        <Section id="resume" eyebrow="06" title="Resume Intelligence Engine">
          <FeatureSplit
            metrics={[
              { k: "25/day", v: "Resume generation cap" },
              { k: "25/day", v: "Cover letter cap" },
              { k: "Per-role", v: "Keyword alignment" },
            ]}
            body="Each high-probability role generates a tailored resume version, ATS keyword summary, and quality score. Daily limits protect both cost and decision quality. Every output is versioned so the analytics engine can attribute response rates back to specific resume variants."
          />
        </Section>

        {/* INTERVIEW PROBABILITY */}
        <Section id="interview" eyebrow="07" title="Interview Probability Engine">
          <p className="text-muted-foreground mb-6">A multi-signal scorer projects interview likelihood per role. Confidence is surfaced as a label, not a false-precision number.</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <ConfidenceCard label="Strong Match" tone="bg-success/15 text-success border-success/30" />
            <ConfidenceCard label="Good Match" tone="bg-accent/15 text-accent border-accent/30" />
            <ConfidenceCard label="Stretch" tone="bg-warning/15 text-warning border-warning/30" />
            <ConfidenceCard label="Low Probability" tone="bg-muted text-muted-foreground border-border" />
          </div>
        </Section>

        {/* ANALYTICS */}
        <Section id="analytics" eyebrow="08" title="Analytics & Learning Loop">
          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4 text-accent" />14-day Response Trend</CardTitle></CardHeader>
              <CardContent><MiniTrend /></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><BarChart3 className="h-4 w-4 text-accent" />Indexed Insights</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <InsightRow label="Response rate by resume version" />
                <InsightRow label="Response rate by role category" />
                <InsightRow label="Response rate by company type" />
                <InsightRow label="Interview rate by quality score" />
                <InsightRow label="Avg days to first response" />
              </CardContent>
            </Card>
          </div>
        </Section>

        {/* SECURITY */}
        <Section id="security" eyebrow="09" title="Security & Compliance">
          <div className="grid md:grid-cols-2 gap-4">
            <SecCard icon={Lock} title="RLS-secured database" desc="Row-level security on every table. Every query verifies user_id === auth.uid()." />
            <SecCard icon={ShieldCheck} title="HIBP password protection" desc="Leaked-password protection enabled at the auth layer." />
            <SecCard icon={Layers} title="Race-proof writes" desc="Unique (user_id, dedupe_hash) index prevents duplicate generations under concurrency." />
            <SecCard icon={Zap} title="Per-user rate limits" desc="Daily caps on AI generations, surfaced live in Settings and Resume Studio." />
          </div>
        </Section>

        {/* MANUAL REVIEW */}
        <Section id="manual" eyebrow="10" title="Manual Review Safety System">
          <Card className="border-success/30 bg-success/5">
            <CardContent className="p-6">
              <div className="flex items-start gap-4">
                <div className="h-12 w-12 rounded-lg bg-success/15 flex items-center justify-center shrink-0">
                  <ShieldCheck className="h-6 w-6 text-success" />
                </div>
                <div className="space-y-3">
                  <h3 className="text-lg font-semibold">Every application requires explicit human approval.</h3>
                  <ul className="space-y-1.5 text-sm text-muted-foreground">
                    <li className="flex gap-2"><CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />No auto-submit. No browser automation. No headless agents.</li>
                    <li className="flex gap-2"><CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />30-day reapply guard prevents duplicate outreach to the same role.</li>
                    <li className="flex gap-2"><CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />Manual submission logging powers the analytics learning loop.</li>
                    <li className="flex gap-2"><CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />Salary-missing roles route to Manual Review instead of auto-rejection.</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </Section>

        {/* TECH STACK */}
        <Section id="stack" eyebrow="11" title="Tech Stack">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { i: Cloud, t: "TanStack Start" }, { i: Cpu, t: "React 19" },
              { i: Database, t: "Supabase Postgres" }, { i: Lock, t: "Supabase Auth + RLS" },
              { i: Sparkles, t: "OpenAI GPT-4o-mini" }, { i: Workflow, t: "TanStack Query" },
              { i: Layers, t: "Tailwind v4" }, { i: GitBranch, t: "Server Functions" },
            ].map((s) => (
              <div key={s.t} className="p-4 rounded-lg border border-border bg-card flex items-center gap-3">
                <s.i className="h-5 w-5 text-accent" />
                <span className="text-sm font-medium">{s.t}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* SCREENSHOTS */}
        <Section id="screens" eyebrow="12" title="Product Screenshots">
          <div className="grid md:grid-cols-2 gap-4">
            <ScreenMock title="High-Probability Dashboard" route="/high-probability" />
            <ScreenMock title="Resume Studio" route="/resume" />
            <ScreenMock title="Application Tracker" route="/tracker" />
            <ScreenMock title="Analytics & Learning Loop" route="/analytics" />
          </div>
        </Section>

        {/* KEY METRICS */}
        <Section id="metrics" eyebrow="13" title="Key Metrics">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <Metric v="25" l="AI generations / day" />
            <Metric v="30+" l="Verified companies seeded" />
            <Metric v="11" l="Trust scoring factors" />
            <Metric v="14d" l="Response trend window" />
            <Metric v="4" l="ATS platforms supported" />
            <Metric v="30d" l="Reapply guard window" />
            <Metric v="100%" l="RLS coverage" />
            <Metric v="0" l="Auto-submitted apps" />
          </div>
        </Section>

        {/* CHALLENGES */}
        <Section id="decisions" eyebrow="14" title="Challenges Solved · Product Decisions">
          <div className="space-y-4">
            <Challenge q="How do you prevent duplicate AI generations under concurrency?" a="Unique index on (user_id, dedupe_hash) plus graceful duplicate-error handling at the server-function layer." />
            <Challenge q="How do you keep AI cost predictable?" a="Hard daily caps per generation type (25 resumes, 25 cover letters), live remaining counters, and per-call cost telemetry in openai_usage." />
            <Challenge q="Why manual review only?" a="Auto-submit erodes signal quality and risks ToS violations on every supported ATS. Manual approval keeps the operator in the loop and makes the learning loop trustworthy." />
            <Challenge q="How do you handle missing salary data?" a="Mark salary_estimated = true and route to Manual Review rather than reject — many high-quality roles omit salary at the listing stage." />
          </div>
        </Section>

        {/* LESSONS */}
        <Section id="lessons" eyebrow="15" title="Lessons Learned">
          <div className="grid md:grid-cols-2 gap-4">
            <Lesson title="Constraints raise quality" body="Capping daily generations forced sharper triage and produced higher response rates than uncapped iteration." />
            <Lesson title="Trust scoring beats volume" body="A small number of high-trust applications outperformed broad outreach across every measured cohort." />
            <Lesson title="Versioning unlocks learning" body="Attributing responses to specific resume versions made the recommendations panel actually actionable." />
            <Lesson title="Manual review is a feature" body="Operators valued the human checkpoint more than projected throughput gains from automation." />
          </div>
        </Section>

        {/* ROADMAP */}
        <Section id="roadmap" eyebrow="16" title="Future Roadmap">
          <div className="space-y-3">
            <RoadmapItem phase="Next" title="Recruiter relationship CRM" desc="Track conversations and warm intros tied to specific applications." />
            <RoadmapItem phase="Q3" title="Portfolio-to-role matching v2" desc="Embed-based similarity between portfolio projects and JD requirements." />
            <RoadmapItem phase="Q4" title="Interview prep workspace" desc="Per-company question libraries, recorded practice, recruiter-facing one-pagers." />
            <RoadmapItem phase="Later" title="Multi-operator workspaces" desc="Coach + candidate shared review with audit trail." />
          </div>
        </Section>

        {/* 60-SECOND SCRIPT */}
        <Section id="script" eyebrow="16" title="60-Second Demo Script">
          <Card className="border-accent/30 bg-accent/5">
            <CardContent className="p-6">
              <p className="text-base leading-relaxed text-foreground">
                "This platform scans verified remote job sources, filters unsupported ATS systems, scores
                company trust and interview probability, generates tailored application packets, and tracks
                outcomes through a recruiter CRM pipeline."
              </p>
              <p className="mt-3 text-xs text-muted-foreground">Read aloud in ~25s. Pair with the <Link to="/demo" className="text-accent underline">/demo</Link> guided walkthrough for a full 60-second story.</p>
            </CardContent>
          </Card>
        </Section>

        {/* METRICS PROOF */}
        <Section id="proof" eyebrow="17" title="Metrics Proof — Real Numbers From Testing">
          <p className="text-muted-foreground mb-6">Operational thresholds from the live system, not aspirational targets.</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Metric v="1,441" l="Raw jobs tested" />
            <Metric v="460" l="Jobs imported after filtering" />
            <Metric v="5.4%" l="Conservative Auto Review pass rate" />
            <Metric v="11-factor" l="Trust scoring model" />
            <Metric v="14 days" l="Freshness filter window" />
            <Metric v="30 days" l="Duplicate company guard" />
            <Metric v="25/day" l="AI generation cap" />
            <Metric v="5/day" l="Auto Review cap" />
          </div>
        </Section>

        {/* RESPONSIBLE PRODUCT DECISIONS */}
        <Section id="responsible" eyebrow="18" title="Responsible Product Design — What This Platform Will Not Do">
          <p className="text-muted-foreground mb-6">
            Many "apply automation" tools cut corners that violate ATS terms, expose users to bans, or harm
            the labor market. This platform intentionally refuses several patterns — these are product
            decisions, not missing features.
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <ResponsibleCard title="No CAPTCHA bypass" body="CAPTCHAs are an explicit consent signal from the employer. Bypassing them violates terms and degrades the trust signal the recruiter relies on." />
            <ResponsibleCard title="No MFA bypass" body="Multi-factor authentication protects both candidate and employer accounts. The platform never solves, replays, or routes around MFA challenges." />
            <ResponsibleCard title="No login-wall evasion" body="If a posting requires authentication to view, it is rejected at ingest. No cookie replay, session hijacking, or credential stuffing." />
            <ResponsibleCard title="No stealth browser automation" body="No headless Chromium, no fingerprint spoofing, no anti-bot evasion. Every supported ATS is reached via documented public endpoints only." />
            <ResponsibleCard title="No public access to production data" body="The dashboard, candidate data, applications, and recruiter notes are private. /demo and /case-study expose only mock data and explanatory text." />
            <ResponsibleCard title="No auto-submit" body="Every packet requires explicit human approval before any application leaves the operator's hands. Automation accelerates triage, not the final action." />
          </div>
        </Section>

        {/* DECISION ENGINE FLOWCHART */}
        <Section id="flowchart" eyebrow="19" title="Decision Engine Flowchart">
          <DecisionFlowchart />
        </Section>

        {/* WHAT I'D IMPROVE */}
        <Section id="next" eyebrow="20" title="What I Would Improve Next">
          <div className="grid md:grid-cols-2 gap-3">
            <RoadmapItem phase="Soon" title="Gmail recruiter reply detection" desc="Auto-detect inbound recruiter emails and link to the originating application." />
            <RoadmapItem phase="Soon" title="Google Calendar interview prep" desc="Auto-create prep events 24h before scheduled interviews with company brief attached." />
            <RoadmapItem phase="Next" title="Stronger salary enrichment" desc="Cross-source salary data (Levels.fyi, Glassdoor, BLS) for missing or vague listings." />
            <RoadmapItem phase="Next" title="Outcome-based scoring calibration" desc="Re-weight the 11-factor trust model on real interview outcomes once n > 100." />
            <RoadmapItem phase="Q4" title="Custom domain deployment" desc="apply.khalilhickson.com with SSL and SEO-friendly OG cards per route." />
            <RoadmapItem phase="Q4" title="Public sandbox mode" desc="Recruiter-facing read-only sandbox with synthetic data, no auth required." />
          </div>
        </Section>

        {/* FOOTER CTA */}
        <section className="border-t border-border pt-12 text-center">
          <h2 className="text-2xl font-semibold tracking-tight">Want to see it in motion?</h2>
          <p className="mt-2 text-muted-foreground">Take the guided walkthrough or schedule a live demo.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild className="bg-accent text-accent-foreground hover:bg-accent/90">
              <Link to="/demo">View Public Demo <ArrowRight className="h-4 w-4 ml-1.5" /></Link>
            </Button>
            <Button variant="outline" asChild><a href="https://khalilhickson.com#contact" target="_blank" rel="noopener noreferrer">Request Live Walkthrough</a></Button>
            <Button variant="outline" asChild><a href="https://khalilhickson.com" target="_blank" rel="noopener noreferrer">View Resume</a></Button>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ---------- helpers ---------- */

function Section({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-8">
      <div className="mb-6">
        <div className="text-xs font-mono text-accent tracking-widest mb-2">{eyebrow}</div>
        <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="p-4 rounded-lg border border-border bg-card/50 backdrop-blur">
      <div className="text-2xl md:text-3xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground mt-1 uppercase tracking-wider">{label}</div>
    </div>
  );
}

function Pillar({ icon: Icon, title, desc }: { icon: any; title: string; desc: string }) {
  return (
    <div className="p-5 rounded-lg border border-border bg-card">
      <Icon className="h-5 w-5 text-accent mb-3" />
      <div className="font-semibold mb-1">{title}</div>
      <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}

function ProblemCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="p-5 rounded-lg border border-border bg-card">
      <div className="font-semibold mb-2">{title}</div>
      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}

function ArchCard({ icon: Icon, title, desc }: { icon: any; title: string; desc: string }) {
  return (
    <div className="p-4 rounded-lg border border-border bg-card">
      <Icon className="h-5 w-5 text-accent mb-2" />
      <div className="font-semibold text-sm">{title}</div>
      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{desc}</p>
    </div>
  );
}

function ArchitectureDiagram() {
  const Node = ({ label, sub }: { label: string; sub?: string }) => (
    <div className="px-3 py-2 rounded-md border border-border bg-card text-center min-w-[120px]">
      <div className="text-sm font-medium">{label}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
  return (
    <div className="p-6 rounded-lg border border-border bg-muted/30 overflow-x-auto">
      <div className="min-w-[700px] flex flex-col items-center gap-4">
        <Node label="Lovable Frontend" sub="TanStack · React 19" />
        <div className="text-muted-foreground">↓</div>
        <Node label="Server Functions" sub="Type-safe RPC" />
        <div className="text-muted-foreground">↓</div>
        <div className="grid grid-cols-3 gap-4 w-full">
          <div className="flex flex-col items-center gap-2"><Node label="ATS Ingestion" sub="GH · Lever · Ashby · Breezy" /></div>
          <div className="flex flex-col items-center gap-2"><Node label="Packet Engine" sub="Resume · CL · Talking points" /></div>
          <div className="flex flex-col items-center gap-2"><Node label="Analytics Engine" sub="Learning loop" /></div>
        </div>
        <div className="text-muted-foreground">↓</div>
        <div className="grid grid-cols-2 gap-4 w-full max-w-md">
          <Node label="Supabase Postgres" sub="RLS on every table" />
          <Node label="OpenAI GPT-4o-mini" sub="Capped + telemetered" />
        </div>
      </div>
    </div>
  );
}

function ConfidenceCard({ label, tone }: { label: string; tone: string }) {
  return (
    <div className={`p-4 rounded-lg border text-center text-sm font-medium ${tone}`}>{label}</div>
  );
}

function MiniTrend() {
  const bars = [12, 18, 15, 22, 28, 24, 30, 26, 35, 32, 40, 38, 44, 50];
  const max = Math.max(...bars);
  return (
    <div className="flex items-end gap-1 h-24">
      {bars.map((b, i) => (
        <div key={i} className="flex-1 bg-accent/70 rounded-sm" style={{ height: `${(b / max) * 100}%` }} />
      ))}
    </div>
  );
}

function InsightRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-success shrink-0" />{label}</div>
  );
}

function SecCard({ icon: Icon, title, desc }: { icon: any; title: string; desc: string }) {
  return (
    <div className="p-5 rounded-lg border border-border bg-card">
      <Icon className="h-5 w-5 text-accent mb-2" />
      <div className="font-semibold mb-1">{title}</div>
      <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}

function ScreenMock({ title, route }: { title: string; route: string }) {
  return (
    <Link to={route} className="group block">
      <div className="rounded-lg border border-border bg-card overflow-hidden hover:border-accent/50 transition-colors">
        <div className="h-40 bg-gradient-to-br from-muted via-muted/60 to-accent/10 flex items-center justify-center">
          <Building2 className="h-10 w-10 text-muted-foreground/40" />
        </div>
        <div className="p-3 flex items-center justify-between">
          <span className="text-sm font-medium">{title}</span>
          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-accent transition-colors" />
        </div>
      </div>
    </Link>
  );
}

function Metric({ v, l }: { v: string; l: string }) {
  return (
    <div className="p-4 rounded-lg border border-border bg-card">
      <div className="text-2xl font-semibold tabular-nums text-accent">{v}</div>
      <div className="text-xs text-muted-foreground mt-1">{l}</div>
    </div>
  );
}

function Challenge({ q, a }: { q: string; a: string }) {
  return (
    <div className="p-5 rounded-lg border border-border bg-card">
      <div className="font-semibold text-sm mb-1.5">{q}</div>
      <p className="text-sm text-muted-foreground leading-relaxed">{a}</p>
    </div>
  );
}

function Lesson({ title, body }: { title: string; body: string }) {
  return (
    <div className="p-5 rounded-lg border-l-2 border-accent bg-card">
      <div className="font-semibold mb-1">{title}</div>
      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}

function RoadmapItem({ phase, title, desc }: { phase: string; title: string; desc: string }) {
  return (
    <div className="flex gap-4 p-4 rounded-lg border border-border bg-card">
      <Badge variant="outline" className="h-fit shrink-0">{phase}</Badge>
      <div>
        <div className="font-semibold text-sm">{title}</div>
        <p className="text-sm text-muted-foreground mt-0.5">{desc}</p>
      </div>
    </div>
  );
}

function FeatureSplit({ metrics, body }: { metrics: { k: string; v: string }[]; body: string }) {
  return (
    <div className="grid md:grid-cols-2 gap-6 items-center">
      <p className="text-muted-foreground leading-relaxed">{body}</p>
      <div className="grid grid-cols-1 gap-3">
        {metrics.map((m) => (
          <div key={m.v} className="flex items-baseline justify-between p-4 rounded-lg border border-border bg-card">
            <span className="text-sm text-muted-foreground">{m.v}</span>
            <span className="text-2xl font-semibold tabular-nums text-accent">{m.k}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Download({ className }: { className?: string }) {
  return <FileText className={className} />;
}

function ResponsibleCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="p-5 rounded-lg border border-destructive/30 bg-destructive/5">
      <div className="flex items-start gap-2 mb-2">
        <XCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
        <div className="font-semibold text-sm">{title}</div>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}

function DecisionFlowchart() {
  const Step = ({ label, sub, tone = "bg-card" }: { label: string; sub?: string; tone?: string }) => (
    <div className={`px-4 py-2 rounded-md border border-border ${tone} text-center min-w-[180px]`}>
      <div className="text-sm font-medium">{label}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
  const Arrow = ({ label }: { label?: string }) => (
    <div className="flex flex-col items-center text-muted-foreground text-[10px]">
      <div>↓</div>
      {label && <div className="mt-0.5">{label}</div>}
    </div>
  );
  return (
    <div className="p-6 rounded-lg border border-border bg-muted/30 overflow-x-auto">
      <div className="min-w-[720px] flex flex-col items-center gap-2">
        <Step label="Ingest job posting" sub="ATS adapter: GH · Lever · Ashby · Breezy" />
        <Arrow />
        <Step label="ATS platform supported?" sub="Reject Workday / Taleo / SAP / iCIMS" tone="bg-warning/10" />
        <Arrow label="yes" />
        <Step label="14-day freshness filter" />
        <Arrow />
        <Step label="30-day duplicate company guard" />
        <Arrow />
        <Step label="11-factor trust score" tone="bg-accent/10" />
        <Arrow />
        <div className="grid grid-cols-3 gap-3 w-full">
          <Step label="Trust ≥ 90" sub="High-Probability queue" tone="bg-success/10" />
          <Step label="Trust 70–89" sub="Manual Review" tone="bg-info/10" />
          <Step label="Trust < 70" sub="Reject" tone="bg-destructive/10" />
        </div>
        <Arrow />
        <Step label="Interview probability scorer" sub="Match score + confidence label" />
        <Arrow />
        <Step label="Packet generation" sub="Resume · cover · talking points (25/day cap)" tone="bg-accent/10" />
        <Arrow />
        <Step label="Auto Review (5/day cap)" sub="Conservative pass rate ~5.4%" />
        <Arrow />
        <Step label="Manual approval" sub="Human in the loop — always" tone="bg-success/10" />
        <Arrow />
        <Step label="Submit + log outcome" sub="Feeds analytics learning loop" />
      </div>
    </div>
  );
}
