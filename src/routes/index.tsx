import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/score-bar";
import {
  TrendingUp, Target, CheckCircle2, Clock, ArrowUpRight, Zap, Activity, Loader2,
  Database, Shield, Lock, Sparkles, XCircle, CalendarCheck, Building2, Star,
  Gauge, FileCheck, BellRing, Download, PlayCircle,
} from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { listApplications, listActivityLogs } from "@/lib/applications.functions";
import { listJobs } from "@/lib/jobs.functions";
import { checkBackendStatus } from "@/lib/seed.functions";
import {
  getDailyMetrics, runDailyBatch, listHighProbabilityJobs, getAnalyticsBreakdown,
} from "@/lib/engine.functions";
import { getDashboardOptimization } from "@/lib/optimization.functions";
import { withRetry } from "@/lib/api-utils";
import { toast } from "sonner";
import { exportApplicationPdf } from "@/lib/pdf-export";
import { supabase } from "@/integrations/supabase/client";
import { OptimizationSweepButton } from "@/components/optimization-sweep-button";

export const Route = createFileRoute("/")({ component: Dashboard });

function MetricCard({ icon: Icon, label, value, sub, accent, hint }: any) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
            {sub && <div className="mt-1 text-xs text-muted-foreground truncate">{sub}</div>}
          </div>
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg shrink-0 ${accent}`}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        {hint && <div className="mt-3 text-[11px] text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function StatusPill({ ok, icon: Icon, label }: any) {
  return (
    <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${ok ? "border-success/30 bg-success/10 text-success" : "border-destructive/30 bg-destructive/10 text-destructive"}`}>
      {ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
      <Icon className="h-3.5 w-3.5 opacity-70" />
      <span className="text-xs font-medium">{label}</span>
    </div>
  );
}

function readinessScore(j: any): number {
  // Combine: trust + ATS compat + interview prob + salary quality + resume quality + portfolio alignment
  const trust = j.companies?.trust_score ?? j.legitimacy ?? 0;
  const atsOK = ["Greenhouse", "Lever", "Ashby", "Breezy", "Workable"].includes(j.ats) ? 100 : 50;
  const interview = j.interview_probability ?? j.final_score ?? 0;
  const salary = Math.min(100, Math.round(((j.salary_min ?? 0) / 100000) * 100));
  const resume = j.resume_match ?? 0;
  const portfolio = j.role_category ? 100 : 60;
  return Math.round(trust * 0.22 + atsOK * 0.13 + interview * 0.28 + salary * 0.12 + resume * 0.18 + portfolio * 0.07);
}

function Dashboard() {
  const nav = useNavigate();
  const listAppsFn = useServerFn(listApplications);
  const listJobsFn = useServerFn(listJobs);
  const listLogsFn = useServerFn(listActivityLogs);
  const statusFn = useServerFn(checkBackendStatus);
  const metricsFn = useServerFn(getDailyMetrics);
  const batchFn = useServerFn(runDailyBatch);
  const highProbFn = useServerFn(listHighProbabilityJobs);
  const analyticsFn = useServerFn(getAnalyticsBreakdown);

  const [apps, setApps] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [metrics, setMetrics] = useState<any>(null);
  const [highProb, setHighProb] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [opt, setOpt] = useState<any>(null);
  const optFn = useServerFn(getDashboardOptimization);

  const refresh = async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session?.access_token) {
      nav({ to: "/auth" });
      return;
    }

    const [a, j, l, s, m, hp, o]: any = await Promise.all([
      withRetry(() => listAppsFn(), { label: "Apps", silent: true }).catch(() => ({ applications: [] })),
      withRetry(() => listJobsFn(), { label: "Jobs", silent: true }).catch(() => ({ jobs: [] })),
      withRetry(() => listLogsFn(), { label: "Logs", silent: true }).catch(() => ({ logs: [] })),
      withRetry(() => statusFn(), { label: "Status", silent: true }).catch(() => null),
      withRetry(() => metricsFn(), { label: "Metrics", silent: true }).catch(() => null),
      withRetry(() => highProbFn(), { label: "HighProb", silent: true }).catch(() => ({ jobs: [] })),
      withRetry(() => optFn(), { label: "Opt", silent: true }).catch(() => null),
    ]);
    setApps(a.applications); setJobs(j.jobs); setLogs(l.logs);
    setStatus(s); setMetrics(m); setHighProb(hp.jobs); setOpt(o);
  };

  useEffect(() => { refresh().finally(() => setLoading(false)); }, []);

  const handleRunBatch = async () => {
    setRunning(true);
    try {
      const r: any = await batchFn();
      if (r.reviewDay) toast.success("Today is a review & follow-ups day — no new applications prepared.");
      else toast.success(`Batch complete: ${r.batch?.applications_prepared ?? 0} prepared, ${r.batch?.jobs_found ?? 0} jobs found.`);
      await refresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setRunning(false); }
  };

  const handleExportWeekly = async () => {
    setExporting(true);
    try {
      const a: any = await analyticsFn();
      const lines: string[] = [
        "Khalil Hickson — Weekly Hiring Engine Report",
        `Generated: ${new Date().toLocaleString()}`,
        "",
        `Approval rate: ${a.approval_rate}% · Rejection rate: ${a.rejection_rate}%`,
        `Follow-up completion: ${a.follow_up_completion}% · Decided applications: ${a.decided_count}`,
        "",
        "Top resumes (by interviews):",
        ...a.resume_performance.slice(0, 5).map((r: any) => `  - ${r.name}: ${r.interviews} interviews / ${r.applications} apps · match ${r.match_score}`),
        "",
        "Top role categories (avg interview probability):",
        ...a.role_probability.slice(0, 5).map((r: any) => `  - ${r.name}: ${r.value}`),
        "",
        "Top company categories:",
        ...a.category_performance.slice(0, 5).map((r: any) => `  - ${r.name}: ${r.value}`),
        "",
        "Top ATS platforms:",
        ...a.ats_performance.slice(0, 5).map((r: any) => `  - ${r.name}: ${r.value}`),
      ];
      const blob = new Blob([lines.join("\n")], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `weekly-analytics-${new Date().toISOString().slice(0, 10)}.txt`;
      link.click(); URL.revokeObjectURL(url);
      toast.success("Weekly analytics exported");
    } catch (e: any) { toast.error(e.message); }
    finally { setExporting(false); }
  };

  const dailyStats = useMemo(() => {
    const days: { day: string; saved: number; approved: number; submitted: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const dayLogs = logs.filter((l: any) => l.created_at?.slice(0, 10) === key);
      days.push({
        day: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        saved: dayLogs.filter((l: any) => l.action === "save").length,
        approved: dayLogs.filter((l: any) => l.action === "approve").length,
        submitted: dayLogs.filter((l: any) => l.action === "submit").length,
      });
    }
    return days;
  }, [logs]);

  const topReadiness = useMemo(() => {
    return [...highProb]
      .map((j: any) => ({ ...j, _readiness: readinessScore(j) }))
      .sort((a, b) => b._readiness - a._readiness)
      .slice(0, 5);
  }, [highProb]);

  const recentLogs = logs.slice(0, 6);

  return (
    <div className="p-6 space-y-6 max-w-[1500px] mx-auto">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Daily Verified Remote Hiring Engine</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {metrics
              ? <>Today is <span className="font-medium text-foreground">{metrics.day_of_week}</span> · Category: <span className="font-medium text-foreground">{metrics.todays_category_label}</span></>
              : "Loading today's plan…"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleRunBatch} disabled={running} className="bg-accent text-accent-foreground hover:bg-accent/90">
            {running ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-1.5" />}
            Run Today's Batch
          </Button>
          <Button asChild variant="outline">
            <Link to="/high-probability"><Sparkles className="h-4 w-4 mr-1.5" /> Review High-Probability Jobs</Link>
          </Button>
          <Button variant="outline" onClick={handleExportWeekly} disabled={exporting}>
            {exporting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
            Export Weekly Analytics
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…</div>
      ) : (
        <>
          {/* 7 live metric cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
            <MetricCard icon={CalendarCheck} label="Daily Batch" value={metrics?.batch_complete ? "Complete" : "Pending"} sub={metrics?.batch ? `${metrics.batch.applications_prepared ?? 0} prepared` : "Run today's batch"} accent={metrics?.batch_complete ? "bg-success/15 text-success" : "bg-warning/15 text-warning-foreground"} />
            <MetricCard icon={Building2} label="Verified Companies" value={`${metrics?.verified_companies ?? 0}/${metrics?.total_companies ?? 0}`} sub="Trust ≥ 90 verified" accent="bg-info/15 text-info" />
            <MetricCard icon={Star} label="High-Prob Jobs" value={metrics?.high_probability_jobs ?? 0} sub="Ready to apply" accent="bg-accent/15 text-accent-foreground" />
            <MetricCard icon={Gauge} label="Avg Interview Prob" value={`${metrics?.avg_interview_probability ?? 0}`} sub="across all jobs" accent="bg-chart-2/15 text-chart-2" />
            <MetricCard icon={Shield} label="Avg Trust Score" value={`${metrics?.avg_company_trust ?? 0}`} sub="company verification" accent="bg-chart-1/15 text-chart-1" />
            <MetricCard icon={FileCheck} label="Resume Match" value={`${metrics?.avg_resume_match ?? 0}`} sub="avg tailored score" accent="bg-chart-3/15 text-chart-3" />
            <Link to="/follow-ups" className="contents">
              <MetricCard icon={BellRing} label="Follow-ups Due" value={metrics?.follow_ups_due ?? 0} sub="action required" accent={metrics?.follow_ups_due > 0 ? "bg-warning/15 text-warning-foreground" : "bg-muted text-muted-foreground"} />
            </Link>
          </div>

          {/* Optimization cards: source, variant, freshness, follow-ups, interviews, weekly rec */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <MetricCard icon={Target} label="Best Source / Wk" value={opt?.best_source?.name ?? "—"} sub={opt?.best_source ? `priority ${Math.round(opt.best_source.priority_score ?? 0)} · ${opt.best_source.interview_count ?? 0} intvs` : "Run a few packets"} accent="bg-chart-1/15 text-chart-1" />
            <MetricCard icon={FileCheck} label="Best Resume" value={opt?.best_variant?.label ?? "—"} sub={opt?.best_variant ? `${(opt.best_variant.response_rate * 100).toFixed(0)}% response` : "No data yet"} accent="bg-chart-2/15 text-chart-2" />
            <MetricCard icon={Zap} label="Fresh 0–3 Days" value={opt?.fresh_jobs_0_3 ?? 0} sub="highest priority" accent="bg-success/15 text-success" />
            <Link to="/follow-ups" className="contents">
              <MetricCard icon={BellRing} label="Follow-Ups Scheduled" value={opt?.follow_ups_pending ?? 0} sub="due in next 7d" accent={opt?.follow_ups_pending > 0 ? "bg-warning/15 text-warning-foreground" : "bg-muted text-muted-foreground"} />
            </Link>
            <MetricCard icon={Sparkles} label="Interviews / Wk" value={opt?.interviews_this_week ?? 0} sub="last 7 days" accent="bg-accent/15 text-accent-foreground" />
            <MetricCard icon={Activity} label="Weekly Tip" value={opt?.weekly_recommendation ? "Available" : "—"} sub={opt?.weekly_recommendation ?? "Generate a weekly report"} accent="bg-info/15 text-info" />
          </div>

          {/* Backend status */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Shield className="h-4 w-4" /> Backend status</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatusPill ok={!!status?.supabase_connected} icon={Database} label="Supabase connected" />
                <StatusPill ok={!!status?.auth_active} icon={Lock} label="Auth active" />
                <StatusPill ok={!!status?.rls_enabled} icon={Shield} label="RLS enabled" />
                <StatusPill ok={!!status?.openai_connected} icon={Sparkles} label="OpenAI connected" />
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                Browser automation: <span className="font-medium text-foreground">disabled</span> · Mode: <span className="font-medium text-foreground">Manual Review only</span>
              </p>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Pipeline activity (14 days)</CardTitle>
                <span className="text-xs text-muted-foreground">saved · approved · submitted</span>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={dailyStats}>
                      <defs>
                        <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--color-chart-2)" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="var(--color-chart-2)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                      <XAxis dataKey="day" stroke="var(--color-muted-foreground)" fontSize={11} />
                      <YAxis stroke="var(--color-muted-foreground)" fontSize={11} allowDecimals={false} />
                      <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                      <Area type="monotone" dataKey="saved" stroke="var(--color-chart-1)" fill="url(#g1)" strokeWidth={2} />
                      <Area type="monotone" dataKey="approved" stroke="var(--color-chart-2)" fill="url(#g2)" strokeWidth={2} />
                      <Area type="monotone" dataKey="submitted" stroke="var(--color-chart-3)" fill="transparent" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* Application Readiness Score */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4 text-accent" /> Application Readiness</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {topReadiness.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No high-probability jobs yet. Run today's batch.</p>
                ) : topReadiness.map((j: any) => (
                  <div key={j.id} className="p-3 rounded-md border border-border space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{j.title}</div>
                        <div className="text-xs text-muted-foreground truncate">{j.company_name} · {j.ats}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xl font-semibold tabular-nums text-accent">{j._readiness}</div>
                        <div className="text-[10px] text-muted-foreground">readiness</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant="outline" className="text-[10px]">Trust {j.companies?.trust_score ?? j.legitimacy ?? 0}</Badge>
                      <Badge variant="outline" className="text-[10px]">Interview {j.interview_probability ?? 0}</Badge>
                      <Badge variant="outline" className="text-[10px]">Match {j.resume_match ?? 0}</Badge>
                    </div>
                  </div>
                ))}
                <Button variant="ghost" size="sm" asChild className="w-full">
                  <Link to="/high-probability">All ready-to-apply <ArrowUpRight className="h-3 w-3 ml-1" /></Link>
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" /> Activity log</CardTitle>
              <Button variant="ghost" size="sm" asChild><Link to="/tracker">View tracker</Link></Button>
            </CardHeader>
            <CardContent>
              {recentLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No activity yet.</p>
              ) : (
                <div className="divide-y divide-border">
                  {recentLogs.map((log: any) => (
                    <div key={log.id} className="py-3 flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm">
                          <span className="font-medium capitalize">{log.action.replace(/_/g, " ")}</span>
                          {log.details?.status && <span className="text-muted-foreground"> — {log.details.status}</span>}
                          {log.details?.new_status && <span className="text-muted-foreground"> → {log.details.new_status}</span>}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">{new Date(log.created_at).toLocaleString()}</div>
                      </div>
                      <StatusBadge status={log.status === "success" ? "approved" : "rejected"} />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
