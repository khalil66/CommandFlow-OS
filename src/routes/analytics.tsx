import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell,
  PieChart, Pie, Legend, LineChart, Line,
} from "recharts";
import { getAnalyticsBreakdown } from "@/lib/engine.functions";
import { getLearningInsights } from "@/lib/outcomes.functions";
import { withRetry } from "@/lib/api-utils";
import { ResponseHeatmap } from "@/components/response-heatmap";
import { Link } from "@tanstack/react-router";
import { Loader2, BarChart3, TrendingUp, Target, CheckCircle2, XCircle, BellRing, Lightbulb, AlertTriangle, Info, Clock, FileDiff } from "lucide-react";

export const Route = createFileRoute("/analytics")({ component: Analytics });

const COLORS = [
  "var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)",
  "var(--color-chart-4)", "var(--color-chart-5)",
];

const tooltipStyle = { background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 };
const axisProps = { stroke: "var(--color-muted-foreground)", fontSize: 11 };

function Analytics() {
  const fn = useServerFn(getAnalyticsBreakdown);
  const learnFn = useServerFn(getLearningInsights);
  const [data, setData] = useState<any>(null);
  const [learn, setLearn] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      withRetry(() => fn(), { label: "Analytics", silent: true }),
      withRetry(() => learnFn(), { label: "Learning insights", silent: true }),
    ])
      .then(([d, l]) => { setData(d); setLearn(l); })
      .catch((e: any) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex items-center justify-center py-32 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading analytics…</div>;
  if (error) return <div className="p-6 text-destructive">{error}</div>;
  if (!data) return null;

  const empty = data.funnel.every((f: any) => f.value === 0) && data.resume_performance.length === 0;

  return (
    <div className="p-6 space-y-6 max-w-[1500px] mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics Engine</h1>
        <p className="text-sm text-muted-foreground mt-1">Live performance — what's converting, what's not.</p>
      </div>

      {empty ? (
        <Card><CardContent className="flex flex-col items-center justify-center py-16 gap-3">
          <BarChart3 className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No data yet. Run today's batch or seed sample data.</p>
        </CardContent></Card>
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KPI icon={CheckCircle2} accent="text-success" label="Approval rate" value={`${data.approval_rate}%`} sub={`${data.decided_count} decided`} />
            <KPI icon={XCircle} accent="text-destructive" label="Rejection rate" value={`${data.rejection_rate}%`} />
            <KPI icon={BellRing} accent="text-warning-foreground" label="Follow-up completion" value={`${data.follow_up_completion}%`} />
            <KPI icon={TrendingUp} accent="text-accent" label="Activity today" value={data.logs_today} sub="logged events" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Best-performing resume version */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">Best-performing resume versions</CardTitle>
                <Link to="/resume-diff" className="text-xs text-accent inline-flex items-center gap-1 hover:underline"><FileDiff className="h-3 w-3" /> View diff</Link>
              </CardHeader>
              <CardContent>
                {data.resume_performance.length === 0 ? <Empty msg="No resume versions yet." /> : (
                  <div className="space-y-3">
                    {data.resume_performance.slice(0, 6).map((r: any) => (
                      <div key={r.name} className="flex items-center gap-3 p-3 rounded-md border border-border">
                        <div className="font-mono text-xs w-48 truncate">{r.name}</div>
                        <div className="flex-1">
                          <div className="h-2 rounded-full bg-muted overflow-hidden">
                            <div className="h-full bg-accent" style={{ width: `${r.match_score}%` }} />
                          </div>
                        </div>
                        <div className="text-xs tabular-nums w-24 text-right text-muted-foreground">{r.interviews}/{r.applications} int</div>
                        <div className="text-sm font-semibold tabular-nums w-12 text-right text-accent">{r.match_score}</div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Highest interview probability roles */}
            <Card>
              <CardHeader><CardTitle className="text-base">Highest interview-probability roles</CardTitle></CardHeader>
              <CardContent className="h-72">
                {data.role_probability.length === 0 ? <Empty msg="No role data." /> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.role_probability} layout="vertical" margin={{ left: 100 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                      <XAxis type="number" {...axisProps} />
                      <YAxis type="category" dataKey="name" {...axisProps} width={140} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="value" fill="var(--color-chart-1)" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Best-performing company categories */}
            <Card>
              <CardHeader><CardTitle className="text-base">Best-performing company categories</CardTitle></CardHeader>
              <CardContent className="h-72">
                {data.category_performance.length === 0 ? <Empty msg="No category data." /> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.category_performance}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                      <XAxis dataKey="name" {...axisProps} />
                      <YAxis {...axisProps} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="value" fill="var(--color-chart-2)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Best-performing ATS platforms */}
            <Card>
              <CardHeader><CardTitle className="text-base">Best-performing ATS platforms</CardTitle></CardHeader>
              <CardContent className="h-72">
                {data.ats_performance.length === 0 ? <Empty msg="No ATS data." /> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.ats_performance}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                      <XAxis dataKey="name" {...axisProps} />
                      <YAxis {...axisProps} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                        {data.ats_performance.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Interview response trends */}
            <Card>
              <CardHeader><CardTitle className="text-base">Interview response trends (14 days)</CardTitle></CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.response_trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis dataKey="day" {...axisProps} />
                    <YAxis {...axisProps} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="submitted" stroke="var(--color-chart-1)" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="interviews" stroke="var(--color-chart-2)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Resume keyword performance */}
            <Card>
              <CardHeader><CardTitle className="text-base">Resume keyword performance</CardTitle></CardHeader>
              <CardContent className="h-72">
                {data.keyword_performance.length === 0 ? <Empty msg="No keywords yet." /> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.keyword_performance} layout="vertical" margin={{ left: 80 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                      <XAxis type="number" {...axisProps} />
                      <YAxis type="category" dataKey="name" {...axisProps} width={120} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="value" fill="var(--color-chart-3)" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* Application funnel */}
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle className="text-base">Application funnel</CardTitle></CardHeader>
              <CardContent className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.funnel}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis dataKey="name" {...axisProps} />
                    <YAxis {...axisProps} allowDecimals={false} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {data.funnel.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Approval / rejection */}
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle className="text-base">Approval vs rejection rates</CardTitle></CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        { name: "Approved", value: data.approval_rate },
                        { name: "Rejected", value: data.rejection_rate },
                        { name: "Pending", value: Math.max(0, 100 - data.approval_rate - data.rejection_rate) },
                      ]}
                      dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} paddingAngle={2}
                    >
                      <Cell fill="var(--color-chart-2)" />
                      <Cell fill="var(--color-chart-4)" />
                      <Cell fill="var(--color-muted)" />
                    </Pie>
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Tooltip contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Learning loop */}
          {learn && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KPI icon={Target} label="Total submitted" value={learn.total_submitted} />
                <KPI icon={CheckCircle2} accent="text-success" label="Total responses" value={learn.total_responses} />
                <KPI icon={Clock} label="Avg days to response" value={learn.avg_days_to_response ?? "—"} />
                <KPI icon={TrendingUp} label="Recommendations" value={learn.recommendations.length} />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <RateCard title="Response rate by resume version" rows={learn.by_resume} />
                <RateCard title="Response rate by role category" rows={learn.by_role} />
                <RateCard title="Response rate by company type" rows={learn.by_company_type} />
                <RateCard title="Response rate by ATS platform" rows={learn.by_ats} />
              </div>

              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Lightbulb className="h-4 w-4 text-warning-foreground" />Recommendations</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {learn.recommendations.map((r: any, i: number) => (
                    <div key={i} className="flex items-start gap-3 p-3 rounded-md border bg-card/50">
                      {r.tone === "positive" && <CheckCircle2 className="h-4 w-4 mt-0.5 text-success" />}
                      {r.tone === "warning" && <AlertTriangle className="h-4 w-4 mt-0.5 text-warning-foreground" />}
                      {r.tone === "info" && <Info className="h-4 w-4 mt-0.5 text-muted-foreground" />}
                      <div>
                        <div className="text-sm font-medium">{r.title}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{r.detail}</div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

function KPI({ icon: Icon, label, value, sub, accent }: any) {
  return (
    <Card><CardContent className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
          {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
        </div>
        {Icon && <Icon className={`h-5 w-5 ${accent ?? "text-muted-foreground"}`} />}
      </div>
    </CardContent></Card>
  );
}
function Empty({ msg }: { msg: string }) {
  return <p className="text-xs text-muted-foreground text-center pt-12">{msg}</p>;
}

function RateCard({ title, rows }: { title: string; rows: any[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <Empty msg="No data yet" />
        ) : (
          <div className="space-y-2">
            {rows.slice(0, 8).map((r) => (
              <div key={r.name} className="flex items-center justify-between text-sm">
                <div className="truncate flex-1">
                  <span className="font-medium">{r.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{r.submitted}/{r.total}</span>
                </div>
                <div className="flex items-center gap-2 ml-3">
                  <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-accent" style={{ width: `${Math.min(100, r.response_rate)}%` }} />
                  </div>
                  <span className="font-semibold tabular-nums w-10 text-right">{r.response_rate}%</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
