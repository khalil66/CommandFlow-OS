import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SystemArchitecture } from "@/components/system-architecture";
import {
  ArrowRight, Sparkles, ShieldCheck, Building2, FileCheck, Layers,
  Activity, Target, Workflow, Brain, Trophy, Gauge, Eye, PlayCircle, FileText, LineChart,
} from "lucide-react";
import { useEffect, useState } from "react";
import { CinematicHero, GlassStat, Reveal } from "@/components/cinematic-hero";

export const Route = createFileRoute("/portfolio")({
  head: () => ({
    meta: [
      { name: "twitter:card", content: "summary_large_image" },
      { title: "Portfolio — AI-Powered Recruiting Intelligence Platform" },
      {
        name: "description",
        content:
          "AI-powered recruiting intelligence platform: company verification, ATS filtering, interview probability scoring, outcome learning, and executive analytics.",
      },
      { property: "og:title", content: "AI-Powered Recruiting Intelligence Platform" },
      {
        property: "og:description",
        content:
          "Full-stack AI recruiting operations platform with ATS analytics, resume tailoring, outcome learning, and executive monitoring.",
      },
      { property: "og:url", content: "https://commandflowos.online/portfolio" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "canonical", href: "https://commandflowos.online/portfolio" },
    ],
  }),
  component: PortfolioPage,
});

const METRICS = [
  { icon: Activity, value: "1,441+", label: "Raw jobs tested" },
  { icon: FileCheck, value: "460+", label: "Jobs filtered & imported in testing" },
  { icon: ShieldCheck, value: "11-factor", label: "Company trust scoring" },
  { icon: Target, value: "5.4%", label: "Conservative Auto Review pass rate" },
  { icon: Gauge, value: "14-day", label: "Freshness filter" },
  { icon: Building2, value: "30-day", label: "Duplicate company guard" },
  { icon: Layers, value: "5", label: "Canonical resume variants" },
  { icon: Brain, value: "Live", label: "Outcome learning engine" },
];

const FEATURES = [
  "ATS filtering for Greenhouse, Lever, Ashby, and Breezy",
  "Company trust scoring and scam-risk detection",
  "AI resume tailoring and application packet generation",
  "Resume Variant Optimizer with A/B testing",
  "Outcome Learning Engine for real conversion analytics",
  "Executive Command Center with recruiter-safe KPIs",
  "Public Sandbox with simulated data",
  "Recruiter CRM pipeline and response analytics",
  "Safety controls for CAPTCHA, MFA, login walls, and bot-detection blocks",
  "Private authenticated production workspace",
];

function useCountUp(target: string, duration = 1100) {
  // animate numeric prefix when present (e.g. "1,441+", "5.4%", "30-day")
  const match = target.match(/^([\d,.]+)(.*)$/);
  const [val, setVal] = useState(match ? "0" : target);
  useEffect(() => {
    if (!match) return;
    const numeric = parseFloat(match[1].replace(/,/g, ""));
    const suffix = match[2];
    const decimals = (match[1].split(".")[1] ?? "").length;
    const start = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const current = numeric * eased;
      const formatted = decimals
        ? current.toFixed(decimals)
        : Math.round(current).toLocaleString();
      setVal(formatted + suffix);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

function MetricCard({ icon: Icon, value, label }: { icon: any; value: string; label: string }) {
  const animated = useCountUp(value);
  return (
    <Card className="group border-emerald-500/10 hover:border-emerald-500/40 transition-all duration-500 hover:-translate-y-0.5">
      <CardContent className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 grid place-items-center">
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <div className="text-2xl font-semibold tracking-tight tabular-nums">{animated}</div>
        <div className="text-xs text-muted-foreground mt-1">{label}</div>
      </CardContent>
    </Card>
  );
}

function PortfolioPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-background to-background text-foreground">
      {/* Top nav */}
      <header className="border-b border-border/40 backdrop-blur sticky top-0 z-50 bg-background/70">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/portfolio" className="flex items-center gap-2 font-semibold">
            <span className="h-7 w-7 rounded-md bg-gradient-to-br from-emerald-500 to-sky-500 grid place-items-center text-white text-xs">KH</span>
            Khalil Hickson
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <a href="#featured" className="px-3 py-1.5 rounded hover:bg-muted">Projects</a>
            <a href="#case-studies" className="px-3 py-1.5 rounded hover:bg-muted">Case Studies</a>
            <Link to="/sandbox" className="px-3 py-1.5 rounded hover:bg-muted">Sandbox</Link>
          </nav>
        </div>
      </header>

      <CinematicHero
        eyebrow="Featured Project · 2026"
        headline="AI-Powered Career Operating System"
        subheadline="CommandFlowOS combines verified job intelligence, resume optimization, recruiter CRM workflows, outcome learning, and safe automation into one career operations platform."
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <GlassStat value="1,441+" label="Raw jobs tested" />
          <GlassStat value="11-factor" label="Trust scoring" />
          <GlassStat value="5" label="Resume variants" />
          <GlassStat value="Live" label="Outcome learning" />
        </div>
      </CinematicHero>

      {/* Featured projects */}
      <section id="featured" className="max-w-6xl mx-auto px-6 py-12 space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Featured projects</p>
            <h2 className="text-3xl font-semibold tracking-tight mt-1">Selected work</h2>
          </div>
          <a href="#case-studies" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            View case study <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>

        <Card className="overflow-hidden border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.06] via-background to-sky-500/[0.06]">
          <CardContent className="p-8 md:p-10">
            <div className="grid md:grid-cols-5 gap-8 items-start">
              <div className="md:col-span-3 space-y-5">
                <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-0">
                  Full-stack · AI · Recruiting Ops
                </Badge>
                <h3 className="text-2xl md:text-3xl font-semibold tracking-tight">
                  AI-Powered Recruiting Intelligence Platform
                </h3>
                <p className="text-muted-foreground leading-relaxed">
                  Full-stack AI recruiting operations platform that verifies companies, filters
                  ATS systems, scores interview probability, generates tailored application
                  packets, tracks recruiter pipelines, learns from outcomes, and presents
                  executive-level hiring analytics.
                </p>
                <div className="flex flex-wrap gap-2 pt-2" data-track-section="portfolio-hero-ctas">
                  <Button asChild size="sm" className="bg-emerald-500 hover:bg-emerald-600 text-white">
                    <Link to="/sandbox" data-track-cta="View Sandbox"><Eye className="h-3.5 w-3.5 mr-1.5" /> View Sandbox</Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/executive" data-track-cta="Executive Dashboard"><LineChart className="h-3.5 w-3.5 mr-1.5" /> Executive Dashboard</Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/case-study" data-track-cta="Read Case Study"><FileText className="h-3.5 w-3.5 mr-1.5" /> Read Case Study</Link>
                  </Button>
                  <Button asChild size="sm" variant="ghost">
                    <Link to="/demo" data-track-cta="Public Demo"><Sparkles className="h-3.5 w-3.5 mr-1.5" /> Public Demo</Link>
                  </Button>
                </div>
              </div>
              <div className="md:col-span-2 grid grid-cols-2 gap-3">
                <StatTile icon={Trophy} value="460+" label="Jobs imported" />
                <StatTile icon={ShieldCheck} value="11-factor" label="Trust scoring" />
                <StatTile icon={Layers} value="5" label="Resume variants" />
                <StatTile icon={Brain} value="Live" label="Outcome learning" />
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Metric cards */}
      <section className="max-w-6xl mx-auto px-6 py-12 space-y-6">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">By the numbers</p>
          <h2 className="text-3xl font-semibold tracking-tight mt-1">Tested at scale</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {METRICS.map((m) => <MetricCard key={m.label} {...m} />)}
        </div>
      </section>

      {/* Feature bullets */}
      <section className="max-w-6xl mx-auto px-6 py-12 space-y-6">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Capabilities</p>
          <h2 className="text-3xl font-semibold tracking-tight mt-1">What it does</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f} className="flex items-start gap-3 rounded-lg border bg-card/60 p-4">
              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
              <span className="text-sm">{f}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Architecture */}
      <section id="architecture" className="max-w-6xl mx-auto px-6 py-12">
        <SystemArchitecture />
      </section>

      {/* Case studies */}
      <section id="case-studies" className="max-w-6xl mx-auto px-6 py-12 space-y-6">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Case studies</p>
          <h2 className="text-3xl font-semibold tracking-tight mt-1">Deep dives</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <CaseCard
            title="AI-Powered Recruiting Intelligence Platform"
            desc="From 1,441 raw jobs to 460 verified, scored, and packet-ready opportunities — with outcome learning closing the loop."
            to="/case-study"
            cta="Read case study"
          />
          <CaseCard
            title="Executive Command Center"
            desc="Recruiter-safe KPI snapshot built on the same pipeline — animated funnel, ATS performance, and weekly AI recommendations."
            to="/executive"
            cta="View dashboard"
          />
        </div>
      </section>

      {/* Featured CTA */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <Card className="border-emerald-500/20 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950/40 text-white overflow-hidden relative">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.18),transparent_60%)]" />
          <CardContent className="p-10 md:p-14 relative">
            <Badge className="bg-emerald-500/15 text-emerald-300 border-0">Live · Demo-ready</Badge>
            <h2 className="mt-4 text-4xl md:text-5xl font-semibold tracking-tight">
              AI-Powered Career Operating System
            </h2>
            <p className="mt-4 text-white/70 max-w-2xl text-lg">
              An enterprise-style recruiting intelligence platform combining AI workflow
              automation, ATS analytics, outcome learning, recruiter CRM pipelines, and
              executive-level monitoring.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" className="bg-emerald-500 hover:bg-emerald-600 text-white">
                <Link to="/sandbox"><PlayCircle className="h-4 w-4 mr-2" /> Launch Public Sandbox</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10">
                <a href="#architecture"><Workflow className="h-4 w-4 mr-2" /> Explore Architecture</a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <footer className="border-t border-border/40">
        <div className="max-w-6xl mx-auto px-6 py-8 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-3">
          <span>© {new Date().getFullYear()} Khalil Hickson</span>
          <span>No private data, recruiter PII, or API keys exposed on this page.</span>
        </div>
      </footer>
    </div>
  );
}

function StatTile({ icon: Icon, value, label }: { icon: any; value: string; label: string }) {
  return (
    <div className="rounded-lg border bg-background/60 p-4">
      <Icon className="h-4 w-4 text-emerald-500 mb-2" />
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

function CaseCard({ title, desc, to, cta }: { title: string; desc: string; to: string; cta: string }) {
  return (
    <Card className="group hover:border-emerald-500/40 transition-all">
      <CardContent className="p-6 space-y-3">
        <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
        <p className="text-sm text-muted-foreground">{desc}</p>
        <Link
          to={to}
          className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600 dark:text-emerald-400 group-hover:gap-2 transition-all"
        >
          {cta} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </CardContent>
    </Card>
  );
}
