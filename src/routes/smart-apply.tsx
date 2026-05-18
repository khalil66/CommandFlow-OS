import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Shield, ShieldAlert, ShieldCheck, PauseCircle, PlayCircle, Loader2,
  CalendarClock, Sparkles, AlertOctagon, Activity, ListChecks, Zap, Clock, Lock,
  Database, Download, FlaskConical, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import {
  getSmartApplyMetrics, runSmartApply, listSafetyLogs,
  setAutomationPaused, setApplicationMode, AUTO_GATES,
} from "@/lib/smart-apply.functions";
import {
  importJobsNow, seedDefaultJobSources, testSourceFetch, getSmartApplyDiagnostics,
} from "@/lib/ingest.functions";
import { updateSettings } from "@/lib/settings.functions";

export const Route = createFileRoute("/smart-apply")({ component: SmartApplyPage });

const ACTION_STYLES: Record<string, string> = {
  auto_approved: "bg-success/15 text-success border-success/30",
  safety_blocked: "bg-destructive/15 text-destructive border-destructive/30",
  prepared: "bg-info/15 text-info border-info/30",
  skipped: "bg-muted text-muted-foreground border-border",
  paused: "bg-warning/15 text-warning-foreground border-warning/30",
  resumed: "bg-success/15 text-success border-success/30",
  error: "bg-destructive/15 text-destructive border-destructive/30",
};

const DAY_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

function MetricCard({ icon: Icon, label, value, sub, accent }: any) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</div>
            {sub && <div className="mt-1 text-[11px] text-muted-foreground truncate">{sub}</div>}
          </div>
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg shrink-0 ${accent}`}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SmartApplyPage() {
  const metricsFn = useServerFn(getSmartApplyMetrics);
  const runFn = useServerFn(runSmartApply);
  const logsFn = useServerFn(listSafetyLogs);
  const pauseFn = useServerFn(setAutomationPaused);
  const modeFn = useServerFn(setApplicationMode);
  const saveFn = useServerFn(updateSettings);
  const importFn = useServerFn(importJobsNow);
  const seedFn = useServerFn(seedDefaultJobSources);
  const testFn = useServerFn(testSourceFetch);
  const diagFn = useServerFn(getSmartApplyDiagnostics);

  const [m, setM] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [diag, setDiag] = useState<any>(null);
  const [testResults, setTestResults] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async () => {
    const [mm, ll, dd]: any = await Promise.all([
      metricsFn().catch(() => null),
      logsFn().catch(() => ({ logs: [] })),
      diagFn().catch(() => null),
    ]);
    setM(mm); setLogs(ll.logs ?? []); setDiag(dd);
  };

  useEffect(() => { refresh().finally(() => setLoading(false)); }, []);

  const togglePause = async (paused: boolean) => {
    try {
      await pauseFn({ data: { paused } });
      toast.success(paused ? "Automation paused" : "Automation resumed");
      await refresh();
    } catch (e: any) { toast.error(e.message); }
  };

  const switchMode = async (auto: boolean) => {
    try {
      await modeFn({ data: { mode: auto ? "auto_review" : "manual_review" } });
      toast.success(`Switched to ${auto ? "Auto" : "Manual"} Review mode`);
      await refresh();
    } catch (e: any) { toast.error(e.message); }
  };

  const toggleFridayPrepareOnly = async (v: boolean) => {
    try {
      await saveFn({ data: { friday_prepare_only: v } });
      toast.success(`Friday prepare-only: ${v ? "on" : "off"}`);
      await refresh();
    } catch (e: any) { toast.error(e.message); }
  };

  const handleSeed = async () => {
    setBusy("seed");
    try {
      const r: any = await seedFn();
      toast.success(`Seeded ${r.inserted} sources (${r.skipped} already present · ${r.total} total active)`);
      await refresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  const handleTest = async () => {
    setBusy("test");
    setTestResults(null);
    try {
      const r: any = await testFn({ data: {} });
      if (!r.ok) { toast.warning(r.error ?? "No active sources"); setTestResults([]); return; }
      setTestResults(r.results);
      const okCount = r.results.filter((x: any) => x.ok).length;
      const totalJobs = r.results.reduce((a: number, x: any) => a + (x.count ?? 0), 0);
      toast.success(`Fetched ${totalJobs} raw jobs from ${okCount}/${r.results.length} sources`);
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  const handleImportOnly = async () => {
    setBusy("import");
    try {
      const r: any = await importFn({ data: {} });
      const t = r.totals;
      if (r.runs.length === 0) toast.warning("No active sources — click 'Seed Default Sources' first");
      else toast.success(`Ingestion: ${t.imported} imported · ${t.manual_review} manual · ${t.duplicate} dupes · ${t.rejected} rejected · ${t.skipped} skipped (found ${t.found})`);
      await refresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  const handleRun = async () => {
    setRunning(true);
    try {
      // 1. Ingest first
      let importTotals: any = null;
      try {
        const ir: any = await importFn({ data: {} });
        importTotals = ir.totals;
        if (ir.runs.length === 0) {
          toast.warning("No active sources — Smart Apply will scan 0 jobs. Click 'Seed Default Sources'.");
        }
      } catch (e: any) {
        toast.error(`Ingestion failed: ${e.message}`);
      }

      // 2. Then score / route
      const r: any = await runFn();
      if (!r.ok) toast.warning(`Skipped: ${r.reason}`);
      else {
        const sm = r.summary ?? {};
        const scanned = sm.jobs_scanned ?? 0;
        if (scanned === 0) {
          const reason = importTotals
            ? `Ingestion found ${importTotals.found}, imported ${importTotals.imported}, rejected ${importTotals.rejected}, skipped ${importTotals.skipped}. No fresh jobs (<14 days) to score.`
            : "No jobs in database. Seed sources and run ingestion.";
          toast.warning(`Smart Apply scanned 0 jobs. ${reason}`);
        } else {
          toast.success(`Smart Apply: ${scanned} scanned · ${sm.fresh_imported ?? 0} fresh · ${sm.auto_reviewed ?? 0} auto · ${sm.manual_review ?? 0} manual · ${sm.safety_blocked ?? 0} blocked · pass ${((sm.pass_rate ?? 0) * 100).toFixed(1)}%`);
        }
        if (r.sms?.status === "skipped:not_configured") toast.info(`SMS skipped: missing ${(r.sms.missing ?? []).join(", ")}`);
        else if (r.sms?.status === "sent") toast.info("Summary SMS sent");
      }
      await refresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setRunning(false); }
  };

  if (loading || !m) {
    return <div className="flex items-center justify-center py-32 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" />Loading…</div>;
  }

  const isAuto = m.mode === "auto_review";
  const paused = m.paused;

  return (
    <div className="p-6 space-y-6 max-w-[1500px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Zap className="h-5 w-5 text-accent" /> Daily Smart Apply
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Safety-gated daily automation. No CAPTCHA bypass, no MFA bypass, no bot-detection evasion.
            Manual Review remains the default — Auto Review only acts when every gate passes.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={paused ? "default" : "destructive"}
            onClick={() => togglePause(!paused)}
          >
            {paused ? <PlayCircle className="h-4 w-4 mr-1.5" /> : <PauseCircle className="h-4 w-4 mr-1.5" />}
            {paused ? "Resume Automation" : "Pause Automation"}
          </Button>
          <Button onClick={handleRun} disabled={running || paused} className="bg-accent text-accent-foreground hover:bg-accent/90">
            {running ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-1.5" />}
            Run Today's Smart-Apply
          </Button>
        </div>
      </div>

      {/* Status banner */}
      {paused && (
        <div className="rounded-md border border-warning/30 bg-warning/10 p-3 flex items-center gap-2 text-sm text-warning-foreground">
          <AlertOctagon className="h-4 w-4" /> Emergency stop active — no automated actions will run until you resume.
        </div>
      )}
      {!m.is_active_day && !paused && (
        <div className="rounded-md border border-border bg-muted/40 p-3 flex items-center gap-2 text-sm">
          <Clock className="h-4 w-4" /> Today is not an active automation weekday. Best-day logic prefers Mon–Thu mornings.
        </div>
      )}
      {m.is_friday_prepare_only && (
        <div className="rounded-md border border-info/30 bg-info/10 p-3 flex items-center gap-2 text-sm text-info">
          <CalendarClock className="h-4 w-4" /> Friday prepare-only: packets will be generated, but nothing is auto-approved.
        </div>
      )}

      {/* Mode + schedule controls */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Shield className="h-4 w-4" /> Application Mode</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-sm">{isAuto ? "Auto Review Mode" : "Manual Review Mode"}</div>
                <p className="text-xs text-muted-foreground mt-0.5 max-w-md">
                  {isAuto
                    ? "System may mark packets as ready and proceed only if every safety gate passes. You can switch back to Manual Review at any time."
                    : "Every packet requires your explicit approval before submission."}
                </p>
              </div>
              <Switch checked={isAuto} onCheckedChange={switchMode} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-sm">Friday prepare-only</div>
                <p className="text-xs text-muted-foreground mt-0.5">Friday only prepares packets — never auto-submits.</p>
              </div>
              <Switch checked={!!m.is_friday_prepare_only || true} onCheckedChange={toggleFridayPrepareOnly} />
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border text-xs">
              <div>
                <div className="text-muted-foreground">Daily run time</div>
                <div className="font-mono mt-0.5">{String(m.schedule.hour).padStart(2,"0")}:{String(m.schedule.minute).padStart(2,"0")} local</div>
              </div>
              <div>
                <div className="text-muted-foreground">Active weekdays</div>
                <div className="mt-0.5 flex gap-1 flex-wrap">
                  {DAY_LABELS.map((d, i) => (
                    <Badge key={d} variant={m.schedule.weekdays.includes(i) ? "default" : "outline"} className="text-[10px]">{d}</Badge>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Lock className="h-4 w-4 text-success" /> Safety Gates</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-xs">
            <Gate label={`Trust ≥ ${AUTO_GATES.trust}`} />
            <Gate label={`Interview prob ≥ ${AUTO_GATES.interview}`} />
            <Gate label={`Quality ≥ ${AUTO_GATES.quality}`} />
            <Gate label={`Salary ≥ $${AUTO_GATES.salary.toLocaleString()}`} />
            <Gate label="Remote only" />
            <Gate label={`ATS in ${AUTO_GATES.atsAllowed.join(", ")}`} />
            <Gate label={`Posted ≤ ${AUTO_GATES.freshDays} days`} />
            <Gate label="No login / MFA / CAPTCHA" />
            <Gate label="No scam flags / duplicates / 30d company repeats" />
          </CardContent>
        </Card>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        <MetricCard icon={isAuto ? Sparkles : Shield} label="Mode" value={isAuto ? "Auto" : "Manual"} sub={paused ? "Paused" : "Active"} accent={isAuto ? "bg-accent/15 text-accent-foreground" : "bg-info/15 text-info"} />
        <MetricCard icon={Sparkles} label="Fresh Jobs Found" value={m.fresh_jobs} sub="≤ 14 days" accent="bg-success/15 text-success" />
        <MetricCard icon={CalendarClock} label="Jobs Under 14 Days" value={m.fresh_jobs} sub={`${m.missing_posted_at} missing posted_at`} accent="bg-info/15 text-info" />
        <MetricCard icon={ShieldCheck} label="Auto Approved Today" value={m.auto_approved_today} sub={`cap ${m.caps.auto_review_daily_cap}/day`} accent="bg-success/15 text-success" />
        <MetricCard icon={ShieldAlert} label="Safety Blocked" value={m.safety_blocked_today} sub="moved to manual" accent="bg-destructive/15 text-destructive" />
        <MetricCard icon={ListChecks} label="Manual Review" value={m.manual_review_pending} sub="awaiting approval" accent="bg-warning/15 text-warning-foreground" />
        <MetricCard icon={Activity} label="Daily Limit Remaining" value={`${m.auto_remaining}/${m.packet_remaining}`} sub="auto · packets" accent="bg-chart-2/15 text-chart-2" />
      </div>

      {/* Safety logs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4" /> Automation Safety Logs</CardTitle>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No automation activity yet. Run today's Smart-Apply to populate this log.</p>
          ) : (
            <div className="divide-y divide-border">
              {logs.map((l) => (
                <div key={l.id} className="py-3 flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className={`text-[10px] ${ACTION_STYLES[l.action] ?? ""}`}>
                        {l.action.replace(/_/g, " ")}
                      </Badge>
                      <span className="text-sm font-medium truncate">{l.job_title ?? "—"}</span>
                      {l.company_name && <span className="text-xs text-muted-foreground">@ {l.company_name}</span>}
                      {l.ats && <Badge variant="outline" className="text-[10px]">{l.ats}</Badge>}
                    </div>
                    {l.reason && <div className="text-xs text-muted-foreground mt-1">{l.reason}</div>}
                    {l.gates?.failed?.length > 0 && (
                      <div className="text-[11px] text-destructive mt-1">Failed gates: {l.gates.failed.join(" · ")}</div>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                    {new Date(l.created_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground text-center">
        Compliance: no CAPTCHA bypass · no MFA bypass · no bot-detection evasion · no auto-retry after safety block.
      </p>
    </div>
  );
}

function Gate({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2">
      <ShieldCheck className="h-3 w-3 text-success shrink-0" />
      <span>{label}</span>
    </div>
  );
}
