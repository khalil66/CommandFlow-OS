import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
  LineChart, Line, PieChart, Pie, Cell, Legend,
} from "recharts";
import { Activity, Eye, MousePointerClick, Smartphone, Monitor, Loader2, TrendingUp } from "lucide-react";
import { ChartCard, EmptyChart, chartTooltipStyle, chartAxisProps } from "@/components/chart-card";

export const Route = createFileRoute("/engagement")({ component: EngagementPage });

type EventRow = {
  id: string;
  session_id: string;
  event_name: string;
  path: string | null;
  section: string | null;
  label: string | null;
  device: string | null;
  referrer_host: string | null;
  duration_ms: number | null;
  created_at: string;
};

const EVENT_LABELS: Record<string, string> = {
  page_view: "Page View",
  cta_click: "CTA Click",
  section_view: "Section View",
  tour_start: "Tour Started",
  tour_complete: "Tour Completed",
  tour_exit: "Tour Exited",
  resume_download: "Resume Download",
  time_on_page: "Time on Page",
};

const PATH_LABELS: Record<string, string> = {
  "/sandbox": "Sandbox",
  "/demo": "Demo",
  "/case-study": "Case Study",
  "/portfolio": "Portfolio",
};

const COLORS = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];

function EngagementPage() {
  const [rows, setRows] = useState<EventRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    (async () => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("engagement_events")
        .select("*")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (!on) return;
      if (error) setErr(error.message);
      else setRows((data ?? []) as EventRow[]);
    })();
    return () => { on = false; };
  }, []);

  if (err) {
    return (
      <div className="p-6">
        <Card><CardContent className="p-6 text-sm text-destructive">Failed to load engagement: {err}</CardContent></Card>
      </div>
    );
  }
  if (!rows) {
    return (
      <div className="p-12 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading engagement data…
      </div>
    );
  }

  // Aggregates
  const total = rows.length;
  const uniqueSessions = new Set(rows.map((r) => r.session_id)).size;
  const ctaClicks = rows.filter((r) => r.event_name === "cta_click").length;
  const tourStarts = rows.filter((r) => r.event_name === "tour_start").length;
  const tourCompletes = rows.filter((r) => r.event_name === "tour_complete").length;
  const tourCompletionPct = tourStarts ? Math.round((tourCompletes / tourStarts) * 100) : 0;

  // Page views by path
  const byPath: Record<string, number> = {};
  rows.filter((r) => r.event_name === "page_view").forEach((r) => {
    const k = r.path || "(unknown)";
    byPath[k] = (byPath[k] || 0) + 1;
  });
  const pageData = Object.entries(byPath)
    .map(([path, count]) => ({ path: PATH_LABELS[path] || path, count }))
    .sort((a, b) => b.count - a.count);

  // CTA performance
  const ctaCounts: Record<string, number> = {};
  rows.filter((r) => r.event_name === "cta_click").forEach((r) => {
    const k = r.label || "(unlabeled)";
    ctaCounts[k] = (ctaCounts[k] || 0) + 1;
  });
  const ctaData = Object.entries(ctaCounts)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Section views (heat-style)
  const sectionCounts: Record<string, number> = {};
  rows.filter((r) => r.event_name === "section_view").forEach((r) => {
    const k = r.section || "(unknown)";
    sectionCounts[k] = (sectionCounts[k] || 0) + 1;
  });
  const sectionData = Object.entries(sectionCounts)
    .map(([section, count]) => ({ section, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  // Device split
  const deviceCounts: Record<string, number> = { mobile: 0, desktop: 0 };
  rows.forEach((r) => {
    if (r.device === "mobile" || r.device === "desktop") deviceCounts[r.device]++;
  });
  const deviceData = [
    { name: "Mobile", value: deviceCounts.mobile },
    { name: "Desktop", value: deviceCounts.desktop },
  ];

  // Daily engagement trend (last 14 days)
  const days: Record<string, number> = {};
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const k = d.toISOString().slice(0, 10);
    days[k] = 0;
  }
  rows.forEach((r) => {
    const k = r.created_at.slice(0, 10);
    if (k in days) days[k]++;
  });
  const trendData = Object.entries(days).map(([date, count]) => ({
    date: date.slice(5),
    count,
  }));

  // Avg time on page (in seconds)
  const tops = rows.filter((r) => r.event_name === "time_on_page" && typeof r.duration_ms === "number");
  const avgSec = tops.length ? Math.round(tops.reduce((s, r) => s + (r.duration_ms || 0), 0) / tops.length / 1000) : 0;

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Recruiter Engagement</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Privacy-safe analytics for public portfolio pages. No PII, no fingerprinting — anonymous session counts only. Last 30 days.
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <Link to="/portfolio" className="underline text-muted-foreground hover:text-foreground">View Portfolio</Link>
          <Link to="/analytics" className="underline text-muted-foreground hover:text-foreground">Operator Analytics →</Link>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi icon={<Eye className="w-4 h-4" />} label="Events" value={total.toLocaleString()} />
        <Kpi icon={<Activity className="w-4 h-4" />} label="Unique Visitors" value={uniqueSessions.toLocaleString()} />
        <Kpi icon={<MousePointerClick className="w-4 h-4" />} label="CTA Clicks" value={ctaClicks.toLocaleString()} />
        <Kpi icon={<TrendingUp className="w-4 h-4" />} label="Tour Completion" value={`${tourCompletionPct}%`} hint={`${tourCompletes}/${tourStarts}`} />
        <Kpi icon={<Smartphone className="w-4 h-4" />} label="Mobile" value={deviceCounts.mobile.toLocaleString()} />
        <Kpi icon={<Monitor className="w-4 h-4" />} label="Avg Time" value={`${avgSec}s`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Engagement trend" description="Total tracked events per day (last 14 days)">
          {trendData.some((d) => d.count > 0) ? (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" {...chartAxisProps} />
                <YAxis {...chartAxisProps} />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Line type="monotone" dataKey="count" stroke={COLORS[0]} strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : <EmptyChart hint="No engagement yet — share the portfolio link to start collecting data." />}
        </ChartCard>

        <ChartCard title="Most-viewed pages" description="Page views across public routes">
          {pageData.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={pageData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="path" {...chartAxisProps} />
                <YAxis {...chartAxisProps} />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {pageData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart hint="No page views recorded yet." />}
        </ChartCard>

        <ChartCard title="Top CTA performance" description="Most-clicked calls to action across public pages">
          {ctaData.length ? (
            <ResponsiveContainer width="100%" height={Math.max(240, ctaData.length * 28)}>
              <BarChart data={ctaData} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" {...chartAxisProps} />
                <YAxis dataKey="label" type="category" width={140} {...chartAxisProps} />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Bar dataKey="count" fill={COLORS[1]} radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <EmptyChart hint="No CTA clicks recorded yet." />}
        </ChartCard>

        <ChartCard title="Mobile vs desktop" description="Device mix across all visitors">
          {deviceCounts.mobile + deviceCounts.desktop > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={deviceData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
                  {deviceData.map((_, i) => <Cell key={i} fill={COLORS[i]} />)}
                </Pie>
                <Tooltip contentStyle={chartTooltipStyle} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : <EmptyChart hint="No device data yet." />}
        </ChartCard>
      </div>

      <ChartCard title="Section heatmap" description="Most-viewed sections inside public pages (top 12)">
        {sectionData.length ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {(() => {
              const max = Math.max(...sectionData.map((d) => d.count));
              return sectionData.map((d) => {
                const ratio = d.count / max;
                return (
                  <div
                    key={d.section}
                    className="rounded-lg border border-border p-3 transition-colors"
                    style={{ backgroundColor: `hsl(var(--primary) / ${0.08 + ratio * 0.35})` }}
                  >
                    <div className="text-xs font-medium truncate">{d.section}</div>
                    <div className="text-lg font-semibold mt-1">{d.count}</div>
                  </div>
                );
              });
            })()}
          </div>
        ) : <EmptyChart hint="No section views tracked yet." />}
      </ChartCard>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent recruiter activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground mb-2">
            Last 25 events — anonymous session IDs only, no IP, no PII.
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-3">Time</th>
                  <th className="text-left py-2 pr-3">Event</th>
                  <th className="text-left py-2 pr-3">Page</th>
                  <th className="text-left py-2 pr-3">Detail</th>
                  <th className="text-left py-2 pr-3">Device</th>
                  <th className="text-left py-2 pr-3">Session</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 25).map((r) => (
                  <tr key={r.id} className="border-b border-border/40">
                    <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="py-2 pr-3">{EVENT_LABELS[r.event_name] || r.event_name}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{PATH_LABELS[r.path || ""] || r.path || "—"}</td>
                    <td className="py-2 pr-3">{r.label || r.section || (r.duration_ms ? `${Math.round(r.duration_ms / 1000)}s` : "—")}</td>
                    <td className="py-2 pr-3 capitalize">{r.device || "—"}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">{r.session_id.slice(0, 8)}…</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No activity yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {icon} {label}
        </div>
        <div className="text-2xl font-semibold mt-2">{value}</div>
        {hint && <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}
