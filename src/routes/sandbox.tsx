import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  SANDBOX_KPIS, SANDBOX_FUNNEL, SANDBOX_ATS, SANDBOX_CATEGORIES,
  SANDBOX_VARIANTS, SANDBOX_ACTIVITY, SANDBOX_RECOMMENDATIONS, SANDBOX_TRENDS,
} from "@/lib/sandbox-data";
import {
  Activity, Sparkles, TrendingUp, Trophy, Users, Layers, ListChecks, Target,
  Play, Pause, ExternalLink, FileText, Calendar, Workflow,
} from "lucide-react";
import { SystemArchitecture } from "@/components/system-architecture";
import { CinematicHero, GlassStat, Reveal } from "@/components/cinematic-hero";

export const Route = createFileRoute("/sandbox")({
  head: () => ({
    meta: [
      { title: "Public Sandbox — CommandFlowOS Demo" },
      { name: "description", content: "Interactive recruiter-safe demo of the CommandFlowOS pipeline. Fully simulated data, no production access." },
      { property: "og:title", content: "CommandFlowOS — Live Sandbox" },
      { property: "og:description", content: "Walkthrough of an AI-driven job-application command center, with simulated jobs, recruiters, and analytics." },
      { property: "og:url", content: "https://commandflowos.online/sandbox" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "canonical", href: "https://commandflowos.online/sandbox" },
    ],
  }),
  component: SandboxPage,
});

function useCountUp(target: number, duration = 1100) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      setVal(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

function SandboxPage() {
  const [playing, setPlaying] = useState(true);
  const [step, setStep] = useState(0);
  const sections = ["kpis", "funnel", "variants", "activity"];

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setStep((s) => {
        const next = (s + 1) % sections.length;
        const el = document.getElementById(sections[next]);
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
        return next;
      });
    }, 5000);
    return () => clearInterval(id);
  }, [playing]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/40">
      <header className="px-6 py-5 border-b bg-card/60 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-md bg-gradient-to-br from-emerald-500 to-sky-500 text-white grid place-items-center font-bold">A</div>
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Public sandbox · simulated data</p>
              <p className="text-sm font-semibold">CommandFlowOS — Live Demo</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant={playing ? "default" : "outline"} size="sm" onClick={() => setPlaying((v) => !v)} className={playing ? "cta-gradient" : ""}>
              {playing ? <Pause className="h-4 w-4 mr-1" /> : <Play className="h-4 w-4 mr-1" />}
              {playing ? "Pause tour" : "Auto-play"}
            </Button>
            <a href="https://khalilhickson.com" target="_blank" rel="noreferrer">
              <Button size="sm" variant="outline">View resume <ExternalLink className="h-3 w-3 ml-1" /></Button>
            </a>
            <Link to="/case-study"><Button size="sm" className="cta-gradient">View case study</Button></Link>
          </div>
        </div>
      </header>

      <CinematicHero
        eyebrow="Public sandbox · 100% simulated data"
        headline="AI-Powered Career Operating System"
        subheadline="CommandFlowOS combines verified job intelligence, resume optimization, recruiter CRM workflows, outcome learning, and safe automation into one career operations platform."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <GlassStat value={SANDBOX_KPIS.applications_today} label="Applications today" sub="across verified ATS" />
          <GlassStat value={`${SANDBOX_KPIS.interview_probability_avg}%`} label="Avg interview probability" />
          <GlassStat value={`${SANDBOX_KPIS.recruiter_response_rate}%`} label="Recruiter response rate" />
          <GlassStat value={SANDBOX_KPIS.best_variant} label="Best resume variant" />
        </div>
      </CinematicHero>

      <main className="max-w-7xl mx-auto px-6 py-14 space-y-14">
        {/* Intro */}
        <Reveal className="text-center space-y-3">
          <Badge variant="secondary" className="mx-auto">No production data · no PII · no API keys</Badge>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">An AI command center for the job hunt.</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Ingests roles across ATSs, scores fit, drafts packets, routes Safe Auto-Submit, and learns from every recruiter reply.
          </p>
        </Reveal>

        {/* KPIs */}
        <section id="kpis" className={ring(step === 0 && playing)}>
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Pipeline at a glance</h2>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
            <DemoKpi icon={<TrendingUp className="h-4 w-4" />} title="Applications today" value={SANDBOX_KPIS.applications_today} />
            <DemoKpi icon={<Target className="h-4 w-4" />} title="Interview probability avg" value={SANDBOX_KPIS.interview_probability_avg} suffix="%" />
            <DemoKpi icon={<Sparkles className="h-4 w-4" />} title="Recruiter response rate" value={SANDBOX_KPIS.recruiter_response_rate} suffix="%" />
            <DemoKpi icon={<Trophy className="h-4 w-4" />} title="Top ATS" textValue={SANDBOX_KPIS.top_ats} />
            <DemoKpi icon={<Layers className="h-4 w-4" />} title="Best resume variant" textValue={SANDBOX_KPIS.best_variant} />
            <DemoKpi icon={<Users className="h-4 w-4" />} title="Top category" textValue={SANDBOX_KPIS.top_category} />
            <DemoKpi icon={<ListChecks className="h-4 w-4" />} title="Queue backlog" value={SANDBOX_KPIS.queue_backlog} />
            <DemoKpi icon={<Activity className="h-4 w-4" />} title="Interview conversion" value={SANDBOX_KPIS.interview_conversion} suffix="%" />
          </div>
        </section>

        {/* Funnel + Recommendations */}
        <section id="funnel" className={`grid gap-6 lg:grid-cols-3 ${ring(step === 1 && playing)}`}>
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Conversion funnel</CardTitle><CardDescription>Simulated 30-day cohort.</CardDescription></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {SANDBOX_FUNNEL.map((r) => {
                  const max = Math.max(...SANDBOX_FUNNEL.map((x) => x.value));
                  return (
                    <div key={r.label}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">{r.label}</span><span className="font-medium">{r.value}</span>
                      </div>
                      <div className="h-3 rounded-full bg-muted overflow-hidden">
                        <div className="h-full bg-primary transition-all duration-700" style={{ width: `${(r.value / max) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> AI recommendations</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {SANDBOX_RECOMMENDATIONS.map((r, i) => (
                <div key={i} className="rounded-md border p-3">
                  <div className="text-sm font-medium">{r.title}</div>
                  <div className="text-xs text-muted-foreground mt-1">{r.detail}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        {/* Variants + ATS */}
        <section id="variants" className={`grid gap-6 lg:grid-cols-2 ${ring(step === 2 && playing)}`}>
          <Card>
            <CardHeader><CardTitle>Resume variant performance</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {SANDBOX_VARIANTS.map((v) => (
                <div key={v.variant} className="flex items-center gap-3 text-sm">
                  <div className="w-40 truncate">{v.variant}</div>
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary/70 transition-all duration-700" style={{ width: `${v.interview_rate * 2.5}%` }} />
                  </div>
                  <div className="text-xs text-muted-foreground w-32 text-right">{v.apps} apps · {v.interview_rate}% iv</div>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>ATS reply rate</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {SANDBOX_ATS.map((a) => (
                <div key={a.ats} className="flex items-center gap-3 text-sm">
                  <div className="w-32 truncate">{a.ats}</div>
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-accent-foreground/70 transition-all duration-700" style={{ width: `${a.reply_rate * 2.5}%` }} />
                  </div>
                  <div className="text-xs text-muted-foreground w-28 text-right">{a.apps} apps · {a.reply_rate}%</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        {/* Trends + Activity */}
        <section id="activity" className={`grid gap-6 lg:grid-cols-3 ${ring(step === 3 && playing)}`}>
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>Response & interview trends</CardTitle><CardDescription>Simulated weekly rhythm.</CardDescription></CardHeader>
            <CardContent>
              <SandboxTrend />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Live activity</CardTitle><CardDescription>Simulated event stream.</CardDescription></CardHeader>
            <CardContent>
              <ul className="space-y-2 max-h-[320px] overflow-auto pr-1">
                {SANDBOX_ACTIVITY.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <Badge variant="outline" className="text-[10px]">{a.ts}</Badge>
                    <span className="text-muted-foreground">{a.text}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>

        {/* How it works flow */}
        <section className="space-y-4">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground">How the system works</h2>
          <div className="grid gap-3 md:grid-cols-5">
            {[
              { icon: <FileText className="h-4 w-4" />, title: "Ingest", text: "ATS scrape + dedupe" },
              { icon: <Target className="h-4 w-4" />, title: "Score", text: "Fit · realism · salary" },
              { icon: <Layers className="h-4 w-4" />, title: "Draft", text: "Resume + cover packet" },
              { icon: <Workflow className="h-4 w-4" />, title: "Submit", text: "Safe Auto + Manual Review" },
              { icon: <Calendar className="h-4 w-4" />, title: "Learn", text: "Outcomes → recalibrate" },
            ].map((s, i) => (
              <div key={s.title} className="rounded-lg border p-4 bg-card hover-scale">
                <Badge variant="secondary" className="mb-2">Step {i + 1}</Badge>
                <div className="flex items-center gap-2 font-medium">{s.icon}{s.title}</div>
                <p className="text-xs text-muted-foreground mt-1">{s.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Architecture */}
        <div id="architecture"><Reveal><SystemArchitecture /></Reveal></div>

        {/* Monitoring snapshot */}
        <section className="space-y-4">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground">Production monitoring snapshot</h2>
          <div className="grid gap-3 md:grid-cols-4">
            <MiniStat label="Imports OK (24h)" value="98.4%" />
            <MiniStat label="Packet success" value="94.1%" />
            <MiniStat label="OpenAI healthy" value="✓" />
            <MiniStat label="Auto-submit blocked" value="3 (safe)" />
          </div>
        </section>

        <footer className="text-center text-xs text-muted-foreground py-10 border-t">
          Simulated demo · no production data, recruiter PII, or API keys are exposed on this page.
        </footer>
      </main>
    </div>
  );
}

function ring(active: boolean) {
  return `rounded-xl transition-all duration-500 ${active ? "ring-2 ring-primary/60 ring-offset-2 ring-offset-background" : ""}`;
}

function DemoKpi({ icon, title, value, textValue, suffix }: { icon: React.ReactNode; title: string; value?: number; textValue?: string; suffix?: string }) {
  const animated = useCountUp(value ?? 0);
  return (
    <Card className="hover-scale">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium flex items-center gap-2 text-muted-foreground">{icon}{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tracking-tight truncate">
          {textValue ?? `${animated}${suffix ?? ""}`}
        </div>
      </CardContent>
    </Card>
  );
}

function SandboxTrend() {
  const data = SANDBOX_TRENDS;
  const max = Math.max(...data.flatMap((d) => [d.responses, d.interviews]));
  const w = 600, h = 180, pad = 24;
  const xStep = (w - pad * 2) / (data.length - 1);
  const yFor = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const path = (k: "responses" | "interviews") =>
    data.map((d, i) => `${i === 0 ? "M" : "L"} ${pad + i * xStep} ${yFor(d[k])}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-48">
      <path d={path("responses")} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" />
      <path d={path("interviews")} fill="none" stroke="hsl(var(--accent-foreground))" strokeWidth="2" strokeDasharray="4 4" />
      {data.map((d, i) => (
        <text key={i} x={pad + i * xStep} y={h - 4} fontSize="10" textAnchor="middle" fill="hsl(var(--muted-foreground))">{d.day}</text>
      ))}
    </svg>
  );
}


function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}
