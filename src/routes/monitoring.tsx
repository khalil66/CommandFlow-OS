import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Activity, AlertTriangle, BellRing, CheckCircle2, Database, Loader2,
  RefreshCw, Search, ShieldAlert, XCircle, Zap,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getMonitoringDashboard, evaluateAndAlert } from "@/lib/monitoring.functions";
import { getOpenAiHealth, validateOpenAi } from "@/lib/openai-validate.functions";
import { humanizeReason, EmptyChart } from "@/components/chart-card";

export const Route = createFileRoute("/monitoring")({
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
  },
  component: MonitoringPage,
});

type Win = "1h" | "24h" | "7d";

function fmtAgo(iso: string | null) {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

function MonitoringPage() {
  const dashFn = useServerFn(getMonitoringDashboard);
  const alertFn = useServerFn(evaluateAndAlert);
  const openAiHealthFn = useServerFn(getOpenAiHealth);
  const openAiValidateFn = useServerFn(validateOpenAi);
  const [data, setData] = useState<any>(null);
  const [openAi, setOpenAi] = useState<any>(null);
  const [validating, setValidating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [win, setWin] = useState<Win>("24h");
  const [alerting, setAlerting] = useState(false);
  const [q, setQ] = useState("");

  const load = async (w: Win = win) => {
    setLoading(true);
    try {
      const [d, ai] = await Promise.all([dashFn({ data: { window: w } }), openAiHealthFn().catch(() => null)]);
      setData(d); setOpenAi(ai);
    }
    catch (e: any) { toast.error(e?.message ?? "Failed to load monitoring"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(win); /* eslint-disable-next-line */ }, [win]);

  const runAlerts = async () => {
    setAlerting(true);
    try {
      const r: any = await alertFn();
      if (!r.alerts?.length) toast.success("No alerts triggered");
      else toast.warning(`${r.alerts.length} alert(s) evaluated, ${r.sent?.filter((s: any) => s.sms?.ok).length ?? 0} SMS sent`);
    } catch (e: any) { toast.error(e?.message ?? "Alert eval failed"); }
    finally { setAlerting(false); }
  };

  const validateAi = async () => {
    setValidating(true);
    try {
      const r: any = await openAiValidateFn();
      setOpenAi(r);
      r.ok ? toast.success("OpenAI key valid") : toast.error(`OpenAI: ${r.message ?? "invalid"}`);
    } catch (e: any) { toast.error(e?.message ?? "Validation failed"); }
    finally { setValidating(false); }
  };

  const filteredLogs = useMemo(() => {
    const rows: any[] = data?.structured_logs ?? [];
    if (!q.trim()) return rows;
    const t = q.toLowerCase();
    return rows.filter((r) =>
      [r.action, r.status, r.company, r.ats, r.reason].some(
        (v) => v && String(v).toLowerCase().includes(t),
      ),
    );
  }, [data, q]);

  return (
    <div className="p-6 space-y-6 max-w-[1300px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Production Monitoring</h1>
          <p className="text-sm text-muted-foreground mt-1">
            API failures, health markers, queue backlog, alerts, and a searchable log feed.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Tabs value={win} onValueChange={(v) => setWin(v as Win)}>
            <TabsList>
              <TabsTrigger value="1h">1h</TabsTrigger>
              <TabsTrigger value="24h">24h</TabsTrigger>
              <TabsTrigger value="7d">7d</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />Refresh
          </Button>
          <Button size="sm" onClick={runAlerts} disabled={alerting}>
            {alerting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <BellRing className="h-3.5 w-3.5 mr-1.5" />}
            Evaluate alerts
          </Button>
        </div>
      </div>

      {loading || !data ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />Loading metrics…
        </div>
      ) : (
        <>
          {/* Health markers */}
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4 text-accent" />Health</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <HealthTile ok={data.health.supabase_healthy} label="Database"
                value={`${data.health.supabase_latency_ms}ms`} sub="round-trip" icon={<Database className="h-4 w-4" />} />
              <HealthTile ok={!!data.health.last_successful_scan_at} label="Last successful scan"
                value={fmtAgo(data.health.last_successful_scan_at)} sub={data.health.last_scan_attempt_at ? `attempt ${fmtAgo(data.health.last_scan_attempt_at)}` : ""}
                icon={<Search className="h-4 w-4" />} />
              <HealthTile ok={!!data.health.last_successful_packet_at} label="Last packet generated"
                value={fmtAgo(data.health.last_successful_packet_at)} sub="" icon={<Zap className="h-4 w-4" />} />
              <HealthTile ok={!!data.health.last_successful_sms_at} label="Last SMS sent"
                value={fmtAgo(data.health.last_successful_sms_at)} sub="" icon={<BellRing className="h-4 w-4" />} />
            </CardContent>
          </Card>

          {/* OpenAI key health */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldAlert className={`h-4 w-4 ${openAi?.ok ? "text-success" : "text-destructive"}`} />
                OpenAI key
                {openAi && (
                  <Badge variant={openAi.ok ? "default" : "destructive"} className="text-[10px]">
                    {openAi.ok ? "valid" : openAi.configured ? `invalid (${openAi.status ?? "err"})` : "not configured"}
                  </Badge>
                )}
              </CardTitle>
              <Button size="sm" variant="outline" onClick={validateAi} disabled={validating}>
                {validating ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                Validate now
              </Button>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-1">
              <div>Env var read: <code className="text-foreground">{openAi?.env_var ?? "OPENAI_API_KEY"}</code></div>
              {openAi?.message && <div className="text-destructive">{openAi.message}</div>}
              <div>Checked {openAi?.checked_at ? fmtAgo(openAi.checked_at) : "never"} {openAi?.cached ? "(cached)" : ""}</div>
              {!openAi?.ok && (
                <div className="pt-1 text-warning-foreground">
                  Packet generation is disabled. New imports are routed to Manual Review with reason <code>invalid_openai_key</code>.
                </div>
              )}
            </CardContent>
          </Card>

          {/* Failure counts */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <FailTile label="OpenAI failures" n={data.failures.openai.count} />
            <FailTile label="Twilio / SMS failures" n={data.failures.sms.count} />
            <FailTile label="Import failures" n={data.failures.imports.count} />
            <FailTile label="Automation failures" n={data.failures.automation.count} />
            <FailTile label="Safety blocks" n={data.failures.safety_blocks.count} variant="warn" />
            <FailTile label="Dry-run failures" n={data.failures.dry_run.count} variant="warn" />
            <FailTile label="Packet failures" n={data.failures.packet.count} />
            <FailTile label="Error rate" n={`${data.health.error_rate_pct}%`} variant={data.health.error_rate_pct >= 25 ? "crit" : data.health.error_rate_pct >= 10 ? "warn" : "ok"} />
          </div>

          {/* Backlog */}
          <Card>
            <CardHeader><CardTitle className="text-base">Queue backlog</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <Stat label="New jobs" n={data.backlog.new_jobs} />
              <Stat label="Manual review" n={data.backlog.manual_review} />
              <Stat label="Queued" n={data.backlog.queued} />
              <Stat label="Apps (24h)" n={data.applications_24h.total} />
              <Stat label="Auto-submitted (24h)" n={data.applications_24h.submitted_automatically} />
            </CardContent>
          </Card>

          {/* Structured log feed */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle className="text-base">Structured logs ({filteredLogs.length})</CardTitle>
              <div className="relative w-64">
                <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)}
                  placeholder="filter action / company / ats / reason"
                  className="pl-7 h-8 text-xs" />
              </div>
            </CardHeader>
            <CardContent className="space-y-1.5 max-h-[520px] overflow-y-auto">
              {filteredLogs.length === 0 ? (
                <EmptyChart title="No matching events" hint="Try clearing the filter or expanding the time window." />
              ) : filteredLogs.map((r: any, i: number) => (
                <div key={i} className="grid grid-cols-[110px_160px_1fr_auto] gap-3 items-start text-xs p-2 rounded-md border border-border/40 hover:bg-muted/30 transition-colors">
                  <span className="text-muted-foreground tabular-nums">{new Date(r.ts).toLocaleTimeString()}</span>
                  <span className="font-medium truncate">{humanizeReason(r.action)}</span>
                  <span className="truncate">
                    {r.company && <span className="font-medium">{r.company}</span>}
                    {r.ats && <span className="text-muted-foreground"> · {r.ats}</span>}
                    {r.reason && <span className="text-muted-foreground"> — {humanizeReason(String(r.reason)).slice(0, 160)}</span>}
                  </span>
                  <StatusBadge status={r.status} />
                </div>
              ))}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            Alerts evaluate the last hour and send SMS only when enabled in Settings. Auto-send email, login/MFA/CAPTCHA bypass, and Manual-Review fallback removal are all disabled.
          </p>
        </>
      )}
    </div>
  );
}

function HealthTile({ ok, label, value, sub, icon }: any) {
  return (
    <div className={`p-3 rounded-md border ${ok ? "border-success/20 bg-success/5" : "border-destructive/30 bg-destructive/5"}`}>
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">{icon}{label}</div>
        {ok ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-destructive" />}
      </div>
      <div className="text-lg font-semibold mt-1 tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function FailTile({ label, n, variant = "auto" }: { label: string; n: number | string; variant?: "ok" | "warn" | "crit" | "auto" }) {
  const num = typeof n === "number" ? n : parseFloat(String(n));
  const v = variant === "auto" ? (num >= 5 ? "crit" : num >= 1 ? "warn" : "ok") : variant;
  const cls = v === "crit" ? "border-destructive/30 bg-destructive/5"
    : v === "warn" ? "border-warning/30 bg-warning/5"
    : "border-success/20 bg-success/5";
  return (
    <div className={`p-3 rounded-md border ${cls}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-1">{n}</div>
    </div>
  );
}

function Stat({ label, n }: { label: string; n: number }) {
  return (
    <div className="p-3 rounded-md bg-muted">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums mt-1">{n}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = String(status || "").toLowerCase();
  const bad = s.includes("fail") || s.includes("error") || s.includes("block");
  const warn = s.includes("skip") || s.includes("dry") || s.includes("pending");
  const variant: any = bad ? "destructive" : warn ? "secondary" : "outline";
  return (
    <Badge variant={variant} className="text-[10px] uppercase tracking-wide">
      {bad && <AlertTriangle className="h-3 w-3 mr-1" />}
      {!bad && warn && <ShieldAlert className="h-3 w-3 mr-1" />}
      {humanizeReason(String(status))}
    </Badge>
  );
}
