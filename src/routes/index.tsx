import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import { MOCK_JOBS, APPLIED_JOBS, DAILY_STATS } from "@/lib/mock-data";
import { StatusBadge, ScoreBar } from "@/components/score-bar";
import { TrendingUp, Target, CheckCircle2, Clock, ArrowUpRight, Zap } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

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

function Dashboard() {
  const ready = MOCK_JOBS.filter(j => j.status === "Ready to Apply");
  const review = MOCK_JOBS.filter(j => j.status === "Manual Review");
  const today = DAILY_STATS[DAILY_STATS.length - 1];
  const totalApps = DAILY_STATS.reduce((s, d) => s + d.applications, 0);
  const totalResp = DAILY_STATS.reduce((s, d) => s + d.responses, 0);
  const responseRate = Math.round((totalResp / totalApps) * 100);

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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat icon={Target} label="Ready to Apply" value={ready.length} sub="Score 90+ auto-prepared" accent="bg-success/15 text-success" />
        <Stat icon={Clock} label="Today's Apps" value={today.applications} sub={`${totalApps} this period`} accent="bg-info/15 text-info" />
        <Stat icon={TrendingUp} label="Response Rate" value={`${responseRate}%`} sub={`${totalResp} replies`} accent="bg-accent/15 text-accent-foreground" />
        <Stat icon={CheckCircle2} label="Manual Review" value={review.length} sub="Login / CAPTCHA flagged" accent="bg-warning/15 text-warning-foreground" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Application velocity (14 days)</CardTitle>
            <span className="text-xs text-muted-foreground">apps · responses · interviews</span>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={DAILY_STATS}>
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
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={11} />
                  <Tooltip contentStyle={{ background: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} />
                  <Area type="monotone" dataKey="applications" stroke="var(--color-chart-1)" fill="url(#g1)" strokeWidth={2} />
                  <Area type="monotone" dataKey="responses" stroke="var(--color-chart-2)" fill="url(#g2)" strokeWidth={2} />
                  <Area type="monotone" dataKey="interviews" stroke="var(--color-chart-3)" fill="transparent" strokeWidth={2} />
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
            {[...MOCK_JOBS].sort((a, b) => b.finalScore - a.finalScore).slice(0, 5).map(j => (
              <div key={j.id} className="flex items-start justify-between gap-3 p-3 rounded-md border border-border hover:bg-muted/40 transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{j.title}</div>
                  <div className="text-xs text-muted-foreground truncate">{j.company} · {j.ats}</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold tabular-nums text-accent">{j.finalScore}</div>
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
          <CardTitle className="text-base">Recent activity</CardTitle>
          <Button variant="ghost" size="sm" asChild><Link to="/tracker">View all</Link></Button>
        </CardHeader>
        <CardContent>
          <div className="divide-y divide-border">
            {APPLIED_JOBS.slice(0, 6).map(j => (
              <div key={j.id} className="py-3 flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate">{j.title} <span className="text-muted-foreground font-normal">· {j.company}</span></div>
                  <div className="text-xs text-muted-foreground mt-0.5">Resume {(j as any).resumeVersion} · {new Date((j as any).appliedDate).toLocaleDateString()}</div>
                </div>
                <ScoreBar value={j.finalScore} />
                <StatusBadge status={j.status} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
