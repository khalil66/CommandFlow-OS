import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DAILY_STATS, RESUME_VERSIONS, MOCK_JOBS } from "@/lib/mock-data";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell, PieChart, Pie, Legend } from "recharts";

export const Route = createFileRoute("/analytics")({ component: Analytics });

function Analytics() {
  const totalApps = DAILY_STATS.reduce((s, d) => s + d.applications, 0);
  const totalResp = DAILY_STATS.reduce((s, d) => s + d.responses, 0);
  const totalInt = DAILY_STATS.reduce((s, d) => s + d.interviews, 0);

  const atsBreakdown = ["Greenhouse", "Lever", "Ashby", "Breezy"].map(a => ({
    name: a, value: MOCK_JOBS.filter(j => j.ats === a).length,
  }));
  const colors = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)"];

  return (
    <div className="p-6 space-y-6 max-w-[1500px] mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">Performance over the last 14 days.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI label="Applications" value={totalApps} />
        <KPI label="Responses" value={totalResp} sub={`${Math.round(totalResp/totalApps*100)}% rate`} />
        <KPI label="Interviews" value={totalInt} sub={`${Math.round(totalInt/totalApps*100)}% rate`} />
        <KPI label="Best resume" value="v3-DataAnalyst" sub="32% response rate" small />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Daily applications</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={DAILY_STATS}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="day" stroke="var(--color-muted-foreground)" fontSize={11} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={11} />
                <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="applications" fill="var(--color-chart-1)" radius={[4,4,0,0]} />
                <Bar dataKey="responses" fill="var(--color-chart-2)" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">ATS distribution</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={atsBreakdown} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={2}>
                  {atsBreakdown.map((_, i) => <Cell key={i} fill={colors[i]} />)}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Resume version performance</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-3">
            {RESUME_VERSIONS.map(r => (
              <div key={r.name} className="flex items-center gap-4 p-3 rounded-md border border-border">
                <div className="font-mono text-sm w-40">{r.name}</div>
                <div className="flex-1">
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-accent" style={{ width: `${r.rate * 2}%` }} />
                  </div>
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">{r.responses}/{r.sent} sent</div>
                <div className="text-sm font-semibold text-accent tabular-nums w-12 text-right">{r.rate}%</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function KPI({ label, value, sub, small }: any) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`mt-2 ${small ? "text-lg" : "text-3xl"} font-semibold tabular-nums`}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}
