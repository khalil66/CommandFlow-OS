import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { getExecutiveSnapshot } from "@/lib/executive.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity, Sparkles, TrendingUp, Trophy, Users, Layers, ListChecks, Target, Play, Pause,
} from "lucide-react";
import { ChartCard, TrendBadge, EmptyChart, AnimatedBar, humanizeText } from "@/components/chart-card";
import { GuidedTour, StartTourButton, type TourStep } from "@/components/guided-tour";

const EXEC_TOUR: TourStep[] = [
  { id: "exec-kpis", title: "Executive KPIs", body: "The eight numbers a hiring leader actually cares about — applications, interview probability, recruiter response rate, top-performing ATS and resume variant." },
  { id: "exec-funnel", title: "Conversion funnel", body: "Imported → reviewed → applied → recruiter reply → interview → offer. Week-over-week trend surfaces drop-off stages immediately." },
  { id: "exec-ats", title: "ATS & category performance", body: "Which ATS platforms and role categories are converting. Drives where to push effort this week." },
  { id: "exec-trends", title: "Response & interview trends · live activity", body: "Seven-day recruiter replies vs interviews scheduled, alongside a recruiter-safe automation stream. No PII surfaces here." },
];

export const Route = createFileRoute("/executive")({
  head: () => ({ meta: [{ title: "Executive Command Center" }] }),
  component: ExecutivePage,
});

function useCountUp(target: number, duration = 900) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const from = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      setVal(Math.round(from + (target - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

function ExecutivePage() {
  const snap = useServerFn(getExecutiveSnapshot);
  const q = useQuery({ queryKey: ["executive-snapshot"], queryFn: () => snap(), refetchInterval: 30_000 });
  const data = q.data;

  const [demoMode, setDemoMode] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const stepRefs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    if (!demoMode) return;
    const id = setInterval(() => {
      setTourStep((s) => {
        const next = (s + 1) % 4;
        stepRefs.current[next]?.scrollIntoView({ behavior: "smooth", block: "center" });
        return next;
      });
    }, 4500);
    return () => clearInterval(id);
  }, [demoMode]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 p-6 space-y-6 animate-fade-in">
      <header className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Executive command center</p>
          <h1 className="text-4xl font-semibold tracking-tight">Real-time pipeline intelligence</h1>
          <p className="text-muted-foreground mt-1">Polished, recruiter-safe snapshot. No PII surfaces here.</p>
        </div>
        <div className="flex items-center gap-2">
          <StartTourButton label="Start guided tour" className="cta-gradient" />
          <Button variant={demoMode ? "default" : "outline"} size="sm" onClick={() => setDemoMode((v) => !v)}>
            {demoMode ? <Pause className="h-4 w-4 mr-1" /> : <Play className="h-4 w-4 mr-1" />}
            {demoMode ? "Pause auto" : "Auto-cycle"}
          </Button>
          <Link to="/sandbox"><Button variant="outline" size="sm">Open sandbox</Button></Link>
        </div>
      </header>

      <GuidedTour steps={EXEC_TOUR} eyebrow="Executive tour" />

      <section id="exec-kpis" ref={(el: HTMLElement | null) => { stepRefs.current[0] = el as HTMLDivElement | null; }} className={`scroll-mt-24 ${transitionRing(demoMode && tourStep === 0)}`}>
        <div className="grid gap-4 md:grid-cols-4">
          <Kpi icon={<TrendingUp className="h-4 w-4" />} title="Applications today" value={data?.kpis.applications_today ?? 0} trend={4.2} />
          <Kpi icon={<Target className="h-4 w-4" />} title="Interview probability avg" value={data?.kpis.interview_probability_avg ?? 0} suffix="%" trend={1.6} />
          <Kpi icon={<Sparkles className="h-4 w-4" />} title="Recruiter response rate" value={Math.round(data?.kpis.recruiter_response_rate ?? 0)} suffix="%" trend={2.4} />
          <Kpi icon={<Trophy className="h-4 w-4" />} title="Top-performing ATS" textValue={data?.kpis.top_ats ?? "—"} />
          <Kpi icon={<Layers className="h-4 w-4" />} title="Best resume variant" textValue={data?.kpis.best_variant ?? "—"} />
          <Kpi icon={<Users className="h-4 w-4" />} title="Top company category" textValue={data?.kpis.top_category ?? "—"} />
          <Kpi icon={<ListChecks className="h-4 w-4" />} title="Queue backlog" value={data?.kpis.queue_backlog ?? 0} trend={-1.1} />
          <Kpi icon={<Activity className="h-4 w-4" />} title="Interview conversion" value={Math.round(data?.kpis.interview_conversion ?? 0)} suffix="%" trend={3.0} />
        </div>
      </section>

      <div id="exec-funnel" className="grid gap-6 lg:grid-cols-3 scroll-mt-24">
        <div ref={(el: HTMLDivElement | null) => { stepRefs.current[1] = el; }} className={`lg:col-span-2 ${transitionRing(demoMode && tourStep === 1)}`}>
          <ChartCard
            title="Conversion funnel"
            description="From imported jobs to signed offers — week over week."
            trend={{ value: 2.8, label: "vs last week" }}
            icon={<Target className="h-4 w-4 text-emerald-500" />}
          >
            {(data?.funnel ?? []).length === 0
              ? <EmptyChart
                  title="Your conversion funnel will live here"
                  hint="As soon as Smart Apply submits packets, you'll see each stage — imports → review → submitted → recruiter reply → interview → offer."
                  why="The funnel is how you spot where deals stall. A weak top means more sourcing; a weak bottom means rework the resume + outreach."
                  sample="funnel"
                  ctas={[
                    { label: "Run Smart Apply", to: "/smart-apply" },
                    { label: "Explore Sandbox", to: "/sandbox", variant: "outline" },
                  ]}
                />
              : <Funnel rows={data?.funnel ?? []} />}
          </ChartCard>
        </div>

        <ChartCard
          title="AI recommendations"
          description="Where to push effort this week."
          icon={<Sparkles className="h-4 w-4 text-sky-500" />}
        >
          <div className="space-y-3">
            {(data?.recommendations ?? []).map((r, i) => (
              <div key={i} className="rounded-lg border bg-card/60 p-3 animate-fade-in hover-lift">
                <div className="text-sm font-medium">{r.title}</div>
                <div className="text-xs text-muted-foreground mt-1">{r.detail}</div>
              </div>
            ))}
            {(data?.recommendations ?? []).length === 0 && (
              <EmptyChart
                title="Recommendations unlock with outcomes"
                hint="Track a few recruiter replies and interviews and the engine will start suggesting which sources, ATSs, and resume variants to lean into."
                why="Outcome-driven recommendations turn the platform from a job firehose into an actual learning loop."
                sample="bars"
                icon={Sparkles}
                ctas={[
                  { label: "Start Demo", to: "/demo" },
                  { label: "View Architecture", to: "/case-study", variant: "outline" },
                ]}
              />
            )}
          </div>
        </ChartCard>
      </div>

      <div id="exec-ats" ref={(el) => { stepRefs.current[2] = el; }} className={`grid gap-6 lg:grid-cols-2 scroll-mt-24 ${transitionRing(demoMode && tourStep === 2)}`}>
        <ChartCard
          title="ATS performance"
          description="Active jobs by ATS platform."
          icon={<Layers className="h-4 w-4 text-emerald-500" />}
          trend={{ value: 1.4 }}
        >
          <BarList rows={(data?.ats_rows ?? []).map((r) => ({ label: r.ats, value: r.jobs }))} />
        </ChartCard>
        <ChartCard
          title="Category performance"
          description="Top role categories tracked in pipeline."
          icon={<Users className="h-4 w-4 text-sky-500" />}
          trend={{ value: -0.6 }}
        >
          <BarList rows={(data?.category_rows ?? []).map((r) => ({ label: r.category, value: r.jobs }))} />
        </ChartCard>
      </div>

      <div id="exec-trends" ref={(el) => { stepRefs.current[3] = el; }} className={`grid gap-6 lg:grid-cols-3 scroll-mt-24 ${transitionRing(demoMode && tourStep === 3)}`}>
        <div className="lg:col-span-2">
          <ChartCard
            title="Response & interview trends"
            description="Recruiter replies vs interviews scheduled (last 7 days)."
            trend={{ value: 5.3, label: "vs last 7d" }}
            icon={<TrendingUp className="h-4 w-4 text-emerald-500" />}
          >
            {(data?.trends ?? []).length === 0
              ? <EmptyChart
                  title="Weekly trend chart waiting for activity"
                  hint="After a few days of replies and interviews, you'll see momentum and week-over-week deltas here."
                  why="A flat reply line means the funnel needs more top-of-pipeline — a rising interview line means the resume is landing."
                  sample="line"
                  ctas={[{ label: "Run Smart Apply", to: "/smart-apply" }]}
                />
              : <TrendChart data={data?.trends ?? []} />}
          </ChartCard>
        </div>
        <ChartCard
          title="Live activity"
          description="Recent automation events — recruiter-safe."
          icon={<Activity className="h-4 w-4 text-sky-500" />}
        >
          <ul className="space-y-2 max-h-[320px] overflow-auto pr-1">
            {(data?.activity ?? []).map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-sm animate-fade-in">
                <Badge variant="outline" className="text-[10px] shrink-0">{a.ts}</Badge>
                <span className="text-muted-foreground">{humanizeText(a.text)}</span>
              </li>
            ))}
            {(data?.activity ?? []).length === 0 && (
              <EmptyChart
                title="Live activity will stream in here"
                hint="Each Smart Apply run posts events — imports, packet generation, approvals, recruiter replies."
                why="The activity feed is the recruiter-safe audit log — proof that the system is acting responsibly."
                sample="none"
                icon={Activity}
                compact
                ctas={[{ label: "Run Smart Apply", to: "/smart-apply" }]}
              />
            )}
          </ul>
        </ChartCard>
      </div>
    </div>
  );
}

function transitionRing(active: boolean) {
  return `rounded-xl transition-all duration-500 ${active ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`;
}

function Kpi({ icon, title, value, textValue, suffix, trend }: { icon: React.ReactNode; title: string; value?: number; textValue?: string; suffix?: string; trend?: number }) {
  const animated = useCountUp(value ?? 0);
  return (
    <Card className="card-2xl hover-lift shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium flex items-center justify-between gap-2 text-muted-foreground">
          <span className="flex items-center gap-2">{icon}{title}</span>
          {trend !== undefined && <TrendBadge value={trend} />}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tracking-tight truncate tabular-nums">
          {textValue ?? `${animated}${suffix ?? ""}`}
        </div>
      </CardContent>
    </Card>
  );
}

function Funnel({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-muted-foreground">{r.label}</span>
            <span className="font-medium">{r.value}</span>
          </div>
          <div className="h-3 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all duration-700" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function BarList({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No data yet.</p>;
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-3 text-sm">
          <div className="w-40 truncate">{r.label}</div>
          <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary/70 transition-all duration-700" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <div className="w-10 text-right text-muted-foreground">{r.value}</div>
        </div>
      ))}
    </div>
  );
}

function TrendChart({ data }: { data: { day: string; responses: number; interviews: number }[] }) {
  const max = Math.max(1, ...data.flatMap((d) => [d.responses, d.interviews]));
  const w = 600, h = 180, pad = 24;
  const xStep = data.length > 1 ? (w - pad * 2) / (data.length - 1) : 0;
  const yFor = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const path = (key: "responses" | "interviews") =>
    data.map((d, i) => `${i === 0 ? "M" : "L"} ${pad + i * xStep} ${yFor(d[key])}`).join(" ");
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
