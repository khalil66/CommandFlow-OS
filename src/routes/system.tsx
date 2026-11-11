import { pageMetadata } from "@/lib/page-metadata";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { getSystemHealth, exportAllData } from "@/lib/settings.functions";
import { withRetry } from "@/lib/api-utils";
import { toast } from "sonner";
import {
  Loader2, CheckCircle2, XCircle, AlertTriangle, Download, RefreshCw,
  Shield, Activity, ListChecks,
} from "lucide-react";

export const Route = createFileRoute("/system")({
  head: () => pageMetadata("System Health", "System Health for CommandFlow OS recruiting operations, with private account access and manual application approval."), component: SystemHealth });

const E2E_CHECKLIST = [
  { area: "Auth", items: [
    "Sign up creates user_settings row",
    "Sign in routes to dashboard",
    "Logged-out user is redirected from protected pages",
  ]},
  { area: "Onboarding", items: [
    "/onboarding completes and writes onboarded_at",
    "Salary floor + role categories persist",
    "Returning users skip onboarding",
  ]},
  { area: "Job ingestion", items: [
    "Add a Greenhouse / Lever URL on /sources",
    '"Import Jobs Now" populates /queue',
    "Imports respect $55K floor and remote-only filter",
    "Duplicate imports are skipped (23505 handled)",
  ]},
  { area: "Application packet", items: [
    "Open a job from /high-probability → packet renders",
    "Resume + cover letter generate without errors",
    "Quality score + confidence label appear",
  ]},
  { area: "Outcomes", items: [
    '"Mark Submitted Manually" updates status + sets follow-up',
    "Follow-up generator returns 4 message types",
    "Tracker filters by all new statuses",
  ]},
  { area: "Analytics", items: [
    "Response rates by resume / role / company / ATS render",
    "Recommendations panel shows at least one suggestion",
    "Daily metrics update after a batch run",
  ]},
  { area: "Safety", items: [
    "Manual Review mode cannot be disabled in Settings",
    "No browser automation or auto-submit code paths execute",
    "Service-role key never appears in client bundle",
  ]},
];

const SECURITY_SUMMARY = [
  { ok: true, item: "RLS enabled on every user-data table; policies scoped to auth.uid()" },
  { ok: true, item: "Server functions use requireSupabaseAuth middleware" },
  { ok: true, item: "Admin client (service-role) imported only from server-only modules" },
  { ok: true, item: "OpenAI key read inside server fn handlers (process.env), never bundled" },
  { ok: true, item: "Race-proof duplicate guard: unique index on (user_id, dedupe_hash)" },
  { ok: true, item: "Per-user AI generation cap (25/day) with persisted usage log" },
  { ok: true, item: "Application ownership re-verified on packet export" },
  { ok: true, item: "Leaked-password (HIBP) protection enabled in Auth" },
  { ok: true, item: "Manual Review mode globally enforced; auto_apply forced off" },
  { ok: true, item: "Job ingestion rejects login/CAPTCHA/MFA-walled ATS platforms" },
];

function SystemHealth() {
  const healthFn = useServerFn(getSystemHealth);
  const exportFn = useServerFn(exportAllData);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await withRetry(() => healthFn(), { label: "System health" });
      setData(res);
    } catch {} finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const downloadExport = async () => {
    setExporting(true);
    try {
      const res = await withRetry(() => exportFn(), { label: "Export" });
      const blob = new Blob([JSON.stringify(res, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `apply-command-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded");
    } catch {} finally { setExporting(false); }
  };

  return (
    <div className="p-6 space-y-6 max-w-[1300px] mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">System Health</h1>
          <p className="text-sm text-muted-foreground mt-1">Production readiness, error monitoring, security audit, backups.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />Refresh
          </Button>
          <Button size="sm" onClick={downloadExport} disabled={exporting} className="bg-accent text-accent-foreground hover:bg-accent/90">
            {exporting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
            Export all data
          </Button>
        </div>
      </div>

      <Tabs defaultValue="health">
        <TabsList>
          <TabsTrigger value="health"><Activity className="h-3.5 w-3.5 mr-1.5" />Health</TabsTrigger>
          <TabsTrigger value="errors"><AlertTriangle className="h-3.5 w-3.5 mr-1.5" />Errors</TabsTrigger>
          <TabsTrigger value="security"><Shield className="h-3.5 w-3.5 mr-1.5" />Security</TabsTrigger>
          <TabsTrigger value="e2e"><ListChecks className="h-3.5 w-3.5 mr-1.5" />E2E checklist</TabsTrigger>
        </TabsList>

        <TabsContent value="health" className="space-y-4">
          {loading || !data ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" />Checking…</div>
          ) : (
            <>
              <Card>
                <CardHeader><CardTitle className="text-base">System checks</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {data.checks.map((c: any) => (
                    <div key={c.name} className={`flex items-start gap-2 p-3 rounded-md border ${c.ok ? "border-success/20 bg-success/5" : "border-destructive/30 bg-destructive/5"}`}>
                      {c.ok ? <CheckCircle2 className="h-4 w-4 mt-0.5 text-success shrink-0" /> : <XCircle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />}
                      <div>
                        <div className="text-sm font-medium">{c.name}</div>
                        <div className="text-xs text-muted-foreground">{c.detail}</div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Workspace counts</CardTitle></CardHeader>
                <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {Object.entries(data.counts).map(([k, v]: any) => (
                    <div key={k} className="p-3 rounded-md bg-muted">
                      <div className="text-xs text-muted-foreground">{k.replace(/_/g, " ")}</div>
                      <div className="text-2xl font-semibold tabular-nums mt-1">{v}</div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="errors" className="space-y-4">
          {loading || !data ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" />Loading…</div>
          ) : (
            <>
              <Card>
                <CardHeader><CardTitle className="text-base">AI failures (last 24h)</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {data.ai_failures.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">No AI failures. </p>
                  ) : data.ai_failures.map((f: any) => (
                    <div key={f.id} className="p-3 rounded-md border border-destructive/30 bg-destructive/5 text-xs">
                      <div className="flex justify-between mb-1">
                        <span className="font-mono">{f.kind}</span>
                        <span className="text-muted-foreground">{new Date(f.created_at).toLocaleString()}</span>
                      </div>
                      <div className="text-destructive truncate">{f.error}</div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Activity log failures (last 24h)</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {data.log_failures.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">No log failures.</p>
                  ) : data.log_failures.map((l: any) => (
                    <div key={l.id} className="p-3 rounded-md border border-warning/30 bg-warning/5 text-xs">
                      <div className="flex justify-between mb-1">
                        <span className="font-mono">{l.action} — {l.status}</span>
                        <span className="text-muted-foreground">{new Date(l.created_at).toLocaleString()}</span>
                      </div>
                      <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap">{JSON.stringify(l.details, null, 0).slice(0, 240)}</pre>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="security" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Security audit summary</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {SECURITY_SUMMARY.map((s) => (
                <div key={s.item} className="flex items-start gap-2 p-2.5 rounded-md border border-success/20 bg-success/5">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 text-success shrink-0" />
                  <span className="text-sm">{s.item}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="e2e" className="space-y-4">
          {E2E_CHECKLIST.map((g) => (
            <Card key={g.area}>
              <CardHeader><CardTitle className="text-base">{g.area}</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {g.items.map((it) => (
                  <label key={it} className="flex items-start gap-2 text-sm cursor-pointer">
                    <input type="checkbox" className="mt-1 accent-accent" />
                    <span>{it}</span>
                  </label>
                ))}
              </CardContent>
            </Card>
          ))}
          <p className="text-xs text-muted-foreground">Checks are local-only. Use this tab as a manual verification list before publishing.</p>
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Download className="h-4 w-4 text-accent" />Backup & export</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">Download a full JSON backup of every table scoped to your account: settings, jobs, applications, resumes, follow-ups, logs, usage history.</p>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={downloadExport} disabled={exporting}>
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
              Download full backup (JSON)
            </Button>
            <Badge variant="outline">All applications stay in Manual Review mode</Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
