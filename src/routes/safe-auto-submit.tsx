import { pageMetadata } from "@/lib/page-metadata";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CheckCircle2, XCircle, ShieldAlert, Pause, Play, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  getSafeAutoSubmitDashboard, confirmRealSubmit, setEmergencyPause,
} from "@/lib/safe-auto-submit-dashboard.functions";
import { runSafeAutoSubmitDryRun } from "@/lib/safe-auto-submit-dryrun.functions";

export const Route = createFileRoute("/safe-auto-submit")({
  head: () => pageMetadata("Submission Safety", "Submission Safety for CommandFlow OS recruiting operations, with private account access and manual application approval."), component: SafeAutoSubmitPage });

function YesNo({ value }: { value: boolean }) {
  return (
    <Badge variant={value ? "default" : "destructive"} className="gap-1">
      {value ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {value ? "Yes" : "No"}
    </Badge>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "ok" | "warn" | "bad" }) {
  const color = tone === "ok" ? "text-emerald-600" : tone === "bad" ? "text-destructive" : tone === "warn" ? "text-amber-600" : "";
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${color}`}>{value}</div>
    </div>
  );
}

function SafeAutoSubmitPage() {
  const qc = useQueryClient();
  const fetchDash = useServerFn(getSafeAutoSubmitDashboard);
  const runDry = useServerFn(runSafeAutoSubmitDryRun);
  const confirm = useServerFn(confirmRealSubmit);
  const pauseFn = useServerFn(setEmergencyPause);

  const { data, isLoading } = useQuery({
    queryKey: ["safe-auto-submit-dashboard"],
    queryFn: () => fetchDash(),
    refetchInterval: 30_000,
  });

  const dryMut = useMutation({
    mutationFn: () => runDry(),
    onSuccess: (r: any) => {
      toast.success(r?.passed ? "Dry run passed" : "Dry run completed with issues");
      qc.invalidateQueries({ queryKey: ["safe-auto-submit-dashboard"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Dry run failed"),
  });
  const confirmMut = useMutation({
    mutationFn: () => confirm(),
    onSuccess: () => {
      toast.success("Real submit confirmed for next 24 hours");
      qc.invalidateQueries({ queryKey: ["safe-auto-submit-dashboard"] });
    },
  });
  const pauseMut = useMutation({
    mutationFn: (paused: boolean) => pauseFn({ data: { paused } }),
    onSuccess: (r: any) => {
      toast.success(r?.paused ? "Automation paused" : "Automation resumed");
      qc.invalidateQueries({ queryKey: ["safe-auto-submit-dashboard"] });
    },
  });

  if (isLoading || !data) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading Safe Auto-Submit dashboard…
      </div>
    );
  }

  const d = data.dry_run;
  const s = data.submit;
  const p = data.preconditions;
  const blocks = data.recent_blocks ?? [];

  const preconditionRows: Array<[string, boolean]> = [
    ["Dry run passed within last 24h", p.dry_run_passed_within_24h],
    ["User explicitly confirmed real submit (24h)", p.user_confirmed_within_24h],
    ["Daily cap not exceeded", p.daily_cap_available],
    ["No safety blocks in last dry run", p.no_safety_blocks_in_last_run],
    ["Dry run mode disabled", p.dry_run_mode_off],
    ["Automation not paused", p.not_paused],
  ];
  const failed = preconditionRows.filter(([, v]) => !v).map(([k]) => k);

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <ShieldAlert className="h-6 w-6" /> Safe Auto-Submit Confirmation
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Real submissions only run when every gate is green. Anything else routes to Manual Review.
          </p>
        </div>
        <Button
          variant={s.automation_paused ? "default" : "destructive"}
          onClick={() => pauseMut.mutate(!s.automation_paused)}
          disabled={pauseMut.isPending}
        >
          {s.automation_paused ? <><Play className="h-4 w-4" /> Resume Automation</> : <><Pause className="h-4 w-4" /> Emergency Pause</>}
        </Button>
      </div>

      {s.automation_paused && (
        <Alert variant="destructive">
          <AlertTitle>Automation is paused</AlertTitle>
          <AlertDescription>All automated submissions are blocked until you resume.</AlertDescription>
        </Alert>
      )}

      {!s.real_submit_enabled && (
        <Alert>
          <AlertTitle>Real submit is currently disabled</AlertTitle>
          <AlertDescription>
            {failed.length ? `Blocked by: ${failed.join(" · ")}` : "All gates pending."} Jobs that would have auto-submitted will route to Manual Review.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Dry Run</CardTitle>
          <Button size="sm" variant="outline" onClick={() => dryMut.mutate()} disabled={dryMut.isPending}>
            <RefreshCw className={`h-4 w-4 ${dryMut.isPending ? "animate-spin" : ""}`} /> Run Dry Run
          </Button>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Passed</div>
            <div className="mt-1"><YesNo value={d.passed} /></div>
            <div className="text-xs text-muted-foreground mt-2">
              {d.last_run_at ? new Date(d.last_run_at).toLocaleString() : "Never run"}
            </div>
          </div>
          <Stat label="Ready candidates" value={d.ready} tone="ok" />
          <Stat label="Blocked" value={d.blocked} tone={d.blocked > 0 ? "bad" : undefined} />
          <Stat label="Missing fields" value={d.missing_fields} tone={d.missing_fields > 0 ? "warn" : undefined} />
          <Stat label="Manual review req." value={d.manual_review_required} tone={d.manual_review_required > 0 ? "warn" : undefined} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Real Submit Status</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">Real submit enabled</div>
            <div className="mt-1"><YesNo value={s.real_submit_enabled} /></div>
          </div>
          <Stat label="Daily cap" value={s.daily_cap} />
          <Stat label="Used today" value={s.used_today} tone={s.used_today >= s.daily_cap ? "bad" : "ok"} />
          <Stat label="Remaining" value={s.remaining} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preconditions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {preconditionRows.map(([label, ok]) => (
            <div key={label} className="flex items-center justify-between border-b last:border-0 py-2">
              <span className="text-sm">{label}</span>
              <YesNo value={ok} />
            </div>
          ))}
          <div className="pt-3">
            <Button
              onClick={() => confirmMut.mutate()}
              disabled={confirmMut.isPending || !d.passed || d.blocked > 0}
            >
              {s.confirm_fresh ? "Re-confirm Real Submit (24h)" : "Confirm Real Submit (24h)"}
            </Button>
            <p className="text-xs text-muted-foreground mt-2">
              Confirmation expires after 24 hours and must be renewed.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent Safety Blocks (24h)</CardTitle></CardHeader>
        <CardContent>
          {blocks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No blocks in the last 24 hours.</p>
          ) : (
            <div className="space-y-2">
              {blocks.map((b: any) => (
                <div key={b.id} className="text-sm border rounded p-2">
                  <div className="font-medium">{b.job_title ?? "—"} <span className="text-muted-foreground">@ {b.company_name ?? "—"}</span></div>
                  <div className="text-xs text-muted-foreground">{b.ats} · {new Date(b.created_at).toLocaleString()}</div>
                  <div className="text-xs mt-1">{b.reason}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
