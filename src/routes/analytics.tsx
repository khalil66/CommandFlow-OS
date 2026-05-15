import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell, PieChart, Pie, Legend } from "recharts";
import { listApplications, listActivityLogs } from "@/lib/applications.functions";
import { listJobs } from "@/lib/jobs.functions";
import { listResumes } from "@/lib/resume.functions";
import { withRetry } from "@/lib/api-utils";
import { Loader2, BarChart3 } from "lucide-react";

export const Route = createFileRoute("/analytics")({ component: Analytics });

function Analytics() {
  const listAppsFn = useServerFn(listApplications);
  const listJobsFn = useServerFn(listJobs);
  const listLogsFn = useServerFn(listActivityLogs);
  const listResumesFn = useServerFn(listResumes);
  const [apps, setApps] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [resumes, setResumes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      withRetry(() => listAppsFn(), { label: "Apps", silent: true }),
      withRetry(() => listJobsFn(), { label: "Jobs", silent: true }),
      withRetry(() => listLogsFn(), { label: "Logs", silent: true }),
      withRetry(() => listResumesFn(), { label: "Resumes", silent: true }).catch(() => ({ resumes: [] })),
    ]).then(([a, j, l, r]: any) => {
      setApps(a.applications); setJobs(j.jobs); setLogs(l.logs); setResumes(r.resumes ?? []);
    }).catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const totals = useMemo(() => {
    const submitted = apps.filter(a => ["submitted","interview","offer"].includes(a.status));
    const interviews = apps.filter(a => a.status === "interview" || a.status === "offer");
    return {
      apps: apps.length, submitted: submitted.length, interviews: interviews.length,
      respRate: submitted.length ? Math.round((interviews.length / submitted.length) * 100) : 0,
    };
  }, [apps]);

  const dailyStats = useMemo(() => {
    const days: { day: string; saved: number; submitted: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0,10);
      const dayLogs = logs.filter((l: any) => l.created_at?.slice(0,10) === key);
      days.push({
        day: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        saved: dayLogs.length,
        submitted: apps.filter(a => a.submitted_at?.slice(0,10) === key).length,
      });
    }
    return days;
  }, [logs, apps]);

  const atsBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    jobs.forEach(j => { if (j.ats) counts[j.ats] = (counts[j.ats] ?? 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [jobs]);
  const colors = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)", "var(--color-chart-5)"];

  if (loading) return <div className="flex items-center justify-center py-32 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading analytics…</div>;
  if (error) return <div className="p-6 text-destructive">{error}</div>;

  const empty = apps.length === 0 && jobs.length === 0;

  return (
    <div className="p-6 space-y-6 max-w-[1500px] mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">Live performance from your application pipeline.</p>
      </div>

      {empty ? (
        <Card><CardContent className="flex flex-col items-center justify-center py-16 gap-3">
          <BarChart3 className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No data yet. Save some jobs from the Queue or seed sample data.</p>
        </CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPI label="Applications" value={totals.apps} />
            <KPI label="Submitted" value={totals.submitted} />
            <KPI label="Interviews" value={totals.interviews} />
            <KPI label="Response rate" value={`${totals.respRate}%`} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle className="text-base">Daily activity</CardTitle></CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyStats}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis dataKey="day" stroke="var(--color-muted-foreground)" fontSize={11} />
                    <YAxis stroke="var(--color-muted-foreground)" fontSize={11} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="saved" fill="var(--color-chart-1)" radius={[4,4,0,0]} />
                    <Bar dataKey="submitted" fill="var(--color-chart-2)" radius={[4,4,0,0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">ATS distribution</CardTitle></CardHeader>
              <CardContent className="h-72">
                {atsBreakdown.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center pt-12">No ATS data.</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={atsBreakdown} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
                        {atsBreakdown.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
                      </Pie>
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Resume versions</CardTitle></CardHeader>
            <CardContent>
              {resumes.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">No resume versions yet. Tailor one in Resume Studio.</p>
              ) : (
                <div className="space-y-3">
                  {resumes.map((r: any) => (
                    <div key={r.id} className="flex items-center gap-4 p-3 rounded-md border border-border">
                      <div className="font-mono text-sm w-48 truncate">{r.label || r.target_role || "Resume"}</div>
                      <div className="flex-1">
                        <div className="h-2 rounded-full bg-muted overflow-hidden">
                          <div className="h-full bg-accent" style={{ width: `${r.match_score ?? 0}%` }} />
                        </div>
                      </div>
                      <div className="text-sm font-semibold text-accent tabular-nums w-12 text-right">{r.match_score ?? 0}%</div>
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

function KPI({ label, value }: any) {
  return (
    <Card><CardContent className="p-5">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
    </CardContent></Card>
  );
}
