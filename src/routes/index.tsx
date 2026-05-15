import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge, ScoreBar } from "@/components/score-bar";
import { TrendingUp, Target, CheckCircle2, Clock, ArrowUpRight, Zap, Activity, Loader2, Database, Shield, Lock, Sparkles, XCircle } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { listApplications, listActivityLogs } from "@/lib/applications.functions";
import { listJobs } from "@/lib/jobs.functions";
import { checkBackendStatus } from "@/lib/seed.functions";
import { withRetry } from "@/lib/api-utils";

export const Route = createFileRoute("/")({ component: Dashboard });

function Stat({ icon: Icon, label, value, sub, accent }: any) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
            {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
          </div>
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${accent}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
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

function Dashboard() {
  const listAppsFn = useServerFn(listApplications);
  const listJobsFn = useServerFn(listJobs);
  const listLogsFn = useServerFn(listActivityLogs);
  const statusFn = useServerFn(checkBackendStatus);
  const [apps, setApps] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      withRetry(() => listAppsFn(), { label: "Apps", silent: true }).catch(() => ({ applications: [] })),
      withRetry(() => listJobsFn(), { label: "Jobs", silent: true }).catch(() => ({ jobs: [] })),
      withRetry(() => listLogsFn(), { label: "Logs", silent: true }).catch(() => ({ logs: [] })),
      withRetry(() => statusFn(), { label: "Status", silent: true }).catch(() => null),
    ]).then(([a, j, l, s]: any) => {
      setApps(a.applications); setJobs(j.jobs); setLogs(l.logs); setStatus(s);
    }).finally(() => setLoading(false));
  }, []);

  const stats = useMemo(() => {
    const review = apps.filter(a => a.status === "manual_review").length;
    const approved = apps.filter(a => a.status === "approved").length;
    const submitted = apps.filter(a => ["submitted","interview","offer"].includes(a.status)).length;
    const interview = apps.filter(a => a.status === "interview").length;
    const responseRate = submitted > 0 ? Math.round((interview / submitted) * 100) : 0;
    return { review, approved, submitted, responseRate };
  }, [apps]);

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

  const topJobs = useMemo(() => [...jobs].sort((a, b) => (b.final_score ?? 0) - (a.final_score ?? 0)).slice(0, 5), [jobs]);
  const recentLogs = logs.slice(0, 6);

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Command Center</h1>
          <p className="text-sm text-muted-foreground mt-1">
            AI-driven remote job applications · Targeting Data Analyst, TechOps, CSM, PM roles
          </p>
        </div>
        <Button asChild className="bg-accent text-accent-foreground hover:bg-accent/90">
          <Link to="/queue"><Zap className="h-4 w-4 mr-1.5" /> Run Discovery</Link>
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat icon={Clock} label="Manual Review" value={stats.review} sub="Awaiting your decision" accent="bg-info/15 text-info" />
            <Stat icon={Target} label="Approved" value={stats.approved} sub="Ready to submit" accent="bg-success/15 text-success" />
            <Stat icon={CheckCircle2} label="Submitted" value={stats.submitted} sub="Tracking outcome" accent="bg-accent/15 text-accent-foreground" />
            <Stat icon={TrendingUp} label="Interview Rate" value={`${stats.responseRate}%`} sub="of submissions" accent="bg-warning/15 text-warning-foreground" />
          </div>

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

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top scoring jobs</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {topJobs.length === 0 && <p className="text-xs text-muted-foreground">No saved jobs yet. Visit the Queue to save some.</p>}
                {topJobs.map(j => (
                  <div key={j.id} className="flex items-start justify-between gap-3 p-3 rounded-md border border-border hover:bg-muted/40 transition-colors">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">{j.title}</div>
                      <div className="text-xs text-muted-foreground truncate">{j.company_name} · {j.ats}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-semibold tabular-nums text-accent">{j.final_score ?? 0}</div>
                    </div>
                  </div>
                ))}
                <Button variant="ghost" size="sm" asChild className="w-full">
                  <Link to="/queue">View queue <ArrowUpRight className="h-3 w-3 ml-1" /></Link>
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
