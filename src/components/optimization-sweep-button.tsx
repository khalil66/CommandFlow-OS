import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Rocket, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { runSmartApply } from "@/lib/smart-apply.functions";
import {
  recomputeSourcePriority,
  backfillFreshness,
  generateWeeklyLearningReport,
  getDashboardOptimization,
} from "@/lib/optimization.functions";

type StepKey = "smart_apply" | "source_priority" | "freshness" | "weekly_report" | "dashboard";

const STEPS: { key: StepKey; label: string }[] = [
  { key: "smart_apply", label: "Run Smart Apply cycle" },
  { key: "source_priority", label: "Recompute source priority" },
  { key: "freshness", label: "Backfill freshness buckets" },
  { key: "weekly_report", label: "Generate weekly learning report" },
  { key: "dashboard", label: "Refresh optimization metrics" },
];

const LAST_SWEEP_KEY = "lastOptimizationSweepAt";

export function OptimizationSweepButton({
  variant = "default",
  size = "default",
  className,
  onComplete,
}: {
  variant?: "default" | "outline" | "secondary";
  size?: "default" | "sm" | "lg";
  className?: string;
  onComplete?: () => void;
}) {
  const nav = useNavigate();
  const smartApplyFn = useServerFn(runSmartApply);
  const sourceFn = useServerFn(recomputeSourcePriority);
  const freshnessFn = useServerFn(backfillFreshness);
  const weeklyFn = useServerFn(generateWeeklyLearningReport);
  const dashFn = useServerFn(getDashboardOptimization);

  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);
  const [stepStatus, setStepStatus] = useState<Record<StepKey, "pending" | "active" | "done" | "error">>({
    smart_apply: "pending", source_priority: "pending", freshness: "pending", weekly_report: "pending", dashboard: "pending",
  });
  const [report, setReport] = useState<any>(null);
  const [lastSweep, setLastSweep] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setLastSweep(localStorage.getItem(LAST_SWEEP_KEY));
    }
  }, []);

  const runSweep = async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session?.access_token) {
      toast.error("Please sign in to run optimization sweep.");
      nav({ to: "/auth" });
      return;
    }

    setRunning(true);
    setOpen(true);
    setReport(null);
    setStepIdx(0);
    setStepStatus({ smart_apply: "active", source_priority: "pending", freshness: "pending", weekly_report: "pending", dashboard: "pending" });

    const results: any = {};
    try {
      // 1. Smart Apply
      results.smartApply = await smartApplyFn();
      setStepStatus((s) => ({ ...s, smart_apply: "done", source_priority: "active" }));
      setStepIdx(1);

      // 2. Source priority
      results.source = await sourceFn();
      setStepStatus((s) => ({ ...s, source_priority: "done", freshness: "active" }));
      setStepIdx(2);

      // 3. Freshness
      results.freshness = await freshnessFn();
      setStepStatus((s) => ({ ...s, freshness: "done", weekly_report: "active" }));
      setStepIdx(3);

      // 4. Weekly report
      results.weekly = await weeklyFn();
      setStepStatus((s) => ({ ...s, weekly_report: "done", dashboard: "active" }));
      setStepIdx(4);

      // 5. Dashboard refresh + QC failures count (today)
      const todayIso = new Date(); todayIso.setHours(0, 0, 0, 0);
      const [dash, qcRes] = await Promise.all([
        dashFn(),
        supabase.from("applications").select("id", { count: "exact", head: true })
          .eq("qc_passed", false).gte("created_at", todayIso.toISOString()),
      ]);
      results.dashboard = dash;
      results.qcFailures = qcRes.count ?? 0;
      setStepStatus((s) => ({ ...s, dashboard: "done" }));
      setStepIdx(5);

      const ts = new Date().toISOString();
      localStorage.setItem(LAST_SWEEP_KEY, ts);
      setLastSweep(ts);

      const summary = results.smartApply?.summary ?? {};
      const w: any = results.weekly?.report ?? results.weekly ?? {};
      const d = results.dashboard ?? {};
      setReport({
        jobs_scanned: summary.jobs_scanned ?? 0,
        fresh_imported: summary.fresh_imported ?? 0,
        auto_reviewed: summary.auto_reviewed ?? 0,
        manual_review: summary.manual_review ?? 0,
        qc_failures: results.qcFailures ?? 0,
        safety_blocked: summary.safety_blocked ?? 0,
        best_source: d.best_source?.name ?? w.best_source?.name ?? "—",
        best_resume: d.best_variant?.label ?? "—",
        best_role_category: w.best_role_category ?? "—",
        top_company_category: w.best_company_type ?? "—",
        follow_ups_pending: d.follow_ups_pending ?? 0,
        interviews_this_week: d.interviews_this_week ?? 0,
        weekly_recommendation: d.weekly_recommendation ?? w.recommendations?.[0] ?? "No recommendation yet",
      });

      toast.success("Optimization sweep complete");
      onComplete?.();
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (/unauthorized/i.test(msg)) {
        toast.error("Session expired — please sign in again.");
        nav({ to: "/auth" });
      } else {
        toast.error(`Sweep failed: ${msg}`);
      }
      setStepStatus((s) => {
        const next = { ...s };
        const active = (Object.keys(next) as StepKey[]).find((k) => next[k] === "active");
        if (active) next[active] = "error";
        return next;
      });
    } finally {
      setRunning(false);
    }
  };

  const progress = Math.round((stepIdx / STEPS.length) * 100);

  return (
    <>
      <div className="inline-flex flex-col items-start gap-1">
        <Button onClick={runSweep} disabled={running} variant={variant} size={size} className={className}>
          {running ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Rocket className="h-4 w-4 mr-1.5" />}
          Run Full Optimization Sweep
        </Button>
        {lastSweep && (
          <span className="text-[11px] text-muted-foreground">
            Last sweep: {new Date(lastSweep).toLocaleString()}
          </span>
        )}
      </div>

      <Dialog open={open} onOpenChange={(o) => { if (!running) setOpen(o); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Rocket className="h-4 w-4 text-accent" /> Optimization Sweep
            </DialogTitle>
            <DialogDescription>
              Manual Review fallback enabled · Auto Review cap 5/day · No auto-submit · No browser automation
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <Progress value={progress} />
            <ul className="space-y-2">
              {STEPS.map((s) => {
                const st = stepStatus[s.key];
                return (
                  <li key={s.key} className="flex items-center gap-2 text-sm">
                    {st === "done" && <CheckCircle2 className="h-4 w-4 text-success" />}
                    {st === "active" && <Loader2 className="h-4 w-4 animate-spin text-accent" />}
                    {st === "error" && <XCircle className="h-4 w-4 text-destructive" />}
                    {st === "pending" && <span className="h-4 w-4 rounded-full border border-muted-foreground/30" />}
                    <span className={st === "pending" ? "text-muted-foreground" : ""}>{s.label}</span>
                  </li>
                );
              })}
            </ul>

            {report && (
              <div className="mt-4 rounded-lg border bg-muted/40 p-4 space-y-2 text-sm">
                <div className="font-medium text-foreground mb-2">Sweep Report</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 tabular-nums">
                  <Row label="Jobs scanned" value={report.jobs_scanned} />
                  <Row label="Jobs imported" value={report.fresh_imported} />
                  <Row label="Auto-reviewed" value={report.auto_reviewed} />
                  <Row label="Manual review" value={report.manual_review} />
                  <Row label="QC failures" value={report.qc_failures} />
                  <Row label="Safety-blocked" value={report.safety_blocked} />
                  <Row label="Follow-ups scheduled" value={report.follow_ups_pending} />
                  <Row label="Interviews this week" value={report.interviews_this_week} />
                </div>
                <div className="pt-2 border-t space-y-1.5">
                  <KV label="Best source" value={report.best_source} />
                  <KV label="Best resume" value={report.best_resume} />
                  <KV label="Best role category" value={report.best_role_category} />
                  <KV label="Top company category" value={report.top_company_category} />
                </div>
                <div className="pt-2 border-t">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Weekly recommendation</div>
                  <div className="text-sm">{report.weekly_recommendation}</div>
                </div>
                <div className="pt-2 flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">Auto Review cap 5/day</Badge>
                  <Badge variant="outline" className="text-[10px]">Manual Review fallback</Badge>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Row({ label, value }: { label: string; value: any }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value ?? 0}</span>
    </>
  );
}
function KV({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-sm font-medium truncate max-w-[60%] text-right">{value || "—"}</span>
    </div>
  );
}
