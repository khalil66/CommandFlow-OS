import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Activity, AlertTriangle, CheckCircle2, Clock, History, Loader2, PauseCircle,
  PlayCircle, RefreshCw, Trash2, Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  listRetryQueue, getRetryQueueMetrics, retryQueueItem,
  retryAllQueued, removeQueueItem,
} from "@/lib/retry-queue.functions";
import { withRetry } from "@/lib/api-utils";

export const Route = createFileRoute("/ai-queue")({ component: AIQueuePage });

function fmtCountdown(target: string | null): string {
  if (!target) return "—";
  const diff = new Date(target).getTime() - Date.now();
  if (diff <= 0) return "Due now";
  const m = Math.floor(diff / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

const STATUS_STYLE: Record<string, string> = {
  queued: "border-warning/40 text-warning-foreground",
  retrying: "border-accent/40 text-accent",
  completed: "border-success/40 text-success",
  failed: "border-destructive/40 text-destructive",
  quota_limited: "border-destructive/40 text-destructive",
};

const HEALTH_STYLE: Record<string, { label: string; cls: string; Icon: any }> = {
  healthy: { label: "Healthy", cls: "border-success/40 text-success", Icon: CheckCircle2 },
  throttled: { label: "Throttled", cls: "border-warning/40 text-warning-foreground", Icon: Activity },
  quota_limited: { label: "Quota Limited", cls: "border-destructive/40 text-destructive", Icon: AlertTriangle },
  paused: { label: "Paused", cls: "border-muted-foreground/40 text-muted-foreground", Icon: PauseCircle },
};

function AIQueuePage() {
  const [items, setItems] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const listFn = useServerFn(listRetryQueue);
  const metricsFn = useServerFn(getRetryQueueMetrics);
  const retryOneFn = useServerFn(retryQueueItem);
  const retryAllFn = useServerFn(retryAllQueued);
  const removeFn = useServerFn(removeQueueItem);

  const refresh = async () => {
    try {
      const [l, m]: any = await Promise.all([
        withRetry(() => listFn(), { label: "Queue", silent: true }),
        withRetry(() => metricsFn(), { label: "Metrics", silent: true }),
      ]);
      setItems(l.items); setMetrics(m);
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, []);
  // Auto-refresh metrics + countdown
  useEffect(() => {
    const i = setInterval(() => setTick(t => t + 1), 1000);
    const r = setInterval(refresh, 30_000);
    return () => { clearInterval(i); clearInterval(r); };
  }, []);

  const handleRetry = async (id: string) => {
    setBusy(id);
    try {
      const res: any = await retryOneFn({ data: { id } });
      if (res.ok) toast.success("Retry succeeded");
      else toast.warning(`Retry queued again: ${res.reason ?? "rate limit"}`);
      await refresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  const handleRetryAll = async () => {
    setBusy("all");
    try {
      const res: any = await retryAllFn();
      toast.success(`Processed ${res.processed} — ${res.succeeded} succeeded, ${res.failed} re-queued`);
      await refresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); }
  };

  const handleRemove = async (id: string) => {
    try {
      await removeFn({ data: { id } });
      toast.success("Removed from queue");
      await refresh();
    } catch (e: any) { toast.error(e.message); }
  };

  const sorted = useMemo(() => {
    const order = { queued: 0, retrying: 1, quota_limited: 2, failed: 3, completed: 4 } as any;
    return [...items].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  }, [items, tick]);

  const queuedCount = metrics?.queued ?? 0;
  const health = HEALTH_STYLE[metrics?.health ?? "healthy"];

  return (
    <div className="p-6 space-y-6 max-w-[1500px] mx-auto">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI Retry Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Quota-aware packet generation queue. Auto-retries every 15 minutes with backoff.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" disabled={busy === "all" || queuedCount === 0}>
                {busy === "all" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5 mr-1.5" />}
                Retry All Queued ({queuedCount})
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Retry every queued job now?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will process {queuedCount} queued/quota-limited jobs sequentially.
                  Requests are throttled to respect OpenAI rate limits. Items that hit the
                  quota again will be re-queued automatically.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleRetryAll}>Retry All</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard label="Queued" value={metrics?.queued ?? 0} Icon={Clock} tone="warning" />
        <MetricCard label="Retrying" value={metrics?.retrying ?? 0} Icon={Loader2} tone="accent" />
        <MetricCard label="Completed" value={metrics?.completed ?? 0} Icon={CheckCircle2} tone="success" />
        <MetricCard label="Failed" value={metrics?.failed ?? 0} Icon={AlertTriangle} tone="destructive" />
        <MetricCard label="Quota Limited" value={metrics?.quota_limited ?? 0} Icon={Zap} tone="destructive" />
        <MetricCard label="Due Now" value={metrics?.due_now ?? 0} Icon={PlayCircle} tone="accent" />
      </div>

      {/* Health */}
      <Card>
        <CardContent className="flex items-center justify-between py-4 px-5">
          <div className="flex items-center gap-3">
            <health.Icon className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-xs text-muted-foreground">Queue health</p>
              <Badge variant="outline" className={`mt-1 ${health.cls}`}>{health.label}</Badge>
            </div>
          </div>
          <p className="text-xs text-muted-foreground max-w-md text-right">
            {metrics?.health === "quota_limited"
              ? "OpenAI quota is exhausted. New attempts will be throttled until the next billing reset."
              : metrics?.health === "throttled"
              ? "Multiple jobs are being processed — throttling enforces a global concurrency cap."
              : "All systems nominal. New jobs will be processed on the next scheduled run."}
          </p>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <History className="h-4 w-4" /> Queue items ({sorted.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading queue…
            </div>
          ) : sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
              <CheckCircle2 className="h-8 w-8 text-success" />
              <p className="text-sm font-medium">Queue is empty</p>
              <p className="text-xs text-muted-foreground max-w-sm">
                Jobs hit by OpenAI quota or rate-limit errors land here. They retry
                automatically with exponential backoff (15m → 30m → 45m → 1h → 2h).
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Next retry</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>History</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map(item => <QueueRow
                  key={item.id} item={item}
                  busy={busy === item.id}
                  onRetry={handleRetry} onRemove={handleRemove}
                />)}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ label, value, Icon, tone }: { label: string; value: number; Icon: any; tone: string }) {
  const cls = tone === "success" ? "text-success" :
    tone === "warning" ? "text-warning-foreground" :
    tone === "destructive" ? "text-destructive" : "text-accent";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{label}</p>
          <Icon className={`h-4 w-4 ${cls}`} />
        </div>
        <p className="text-2xl font-semibold tabular-nums mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}

function QueueRow({ item, busy, onRetry, onRemove }: any) {
  const [open, setOpen] = useState(false);
  const job = item.job_listings;
  const isTerminal = item.status === "completed" || item.status === "failed";
  const history: any[] = Array.isArray(item.history) ? item.history : [];
  return (
    <>
      <TableRow className="hover:bg-muted/40">
        <TableCell>
          <div className="font-medium text-sm">{job?.company_name ?? "—"}</div>
          <div className="text-xs text-muted-foreground">{job?.title ?? item.job_id.slice(0, 8)}</div>
          {job?.ats && <div className="text-[10px] text-muted-foreground mt-0.5">{job.ats}</div>}
        </TableCell>
        <TableCell>
          <Badge variant="outline" className={`text-[10px] ${STATUS_STYLE[item.status] ?? ""}`}>
            {item.status.replace(/_/g, " ")}
          </Badge>
        </TableCell>
        <TableCell>
          <div className="text-xs tabular-nums">
            {item.retry_attempts}/{item.max_attempts}
          </div>
          {item.retry_attempts >= item.max_attempts - 1 && !isTerminal && (
            <div className="text-[10px] text-destructive mt-0.5">Last attempt</div>
          )}
        </TableCell>
        <TableCell>
          {isTerminal ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : (
            <div className="text-xs font-mono tabular-nums">
              {fmtCountdown(item.next_retry_at)}
            </div>
          )}
        </TableCell>
        <TableCell className="max-w-[260px]">
          <p className="text-xs truncate" title={item.retry_reason ?? ""}>
            {item.retry_reason ?? "—"}
          </p>
          {item.last_error && (
            <p className="text-[10px] text-destructive truncate mt-0.5" title={item.last_error}>
              {item.last_error}
            </p>
          )}
        </TableCell>
        <TableCell>
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 text-xs">
                {history.length} events
              </Button>
            </CollapsibleTrigger>
          </Collapsible>
        </TableCell>
        <TableCell>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" title="Retry now"
              onClick={() => onRetry(item.id)} disabled={busy || isTerminal}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </Button>
            <Button size="sm" variant="ghost" title="Remove from queue"
              onClick={() => onRemove(item.id)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {open && history.length > 0 && (
        <TableRow>
          <TableCell colSpan={7} className="bg-muted/30 p-3">
            <ol className="space-y-1">
              {history.slice().reverse().map((h, idx) => (
                <li key={idx} className="text-xs flex items-start gap-2 font-mono">
                  <span className="text-muted-foreground tabular-nums">
                    {new Date(h.ts).toLocaleString()}
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    #{h.attempt ?? "-"}
                  </Badge>
                  <span className="text-foreground">{h.event}</span>
                  {h.duration_ms != null && (
                    <span className="text-muted-foreground">
                      · {Math.round(h.duration_ms / 100) / 10}s
                    </span>
                  )}
                  {h.error && <span className="text-destructive truncate">· {h.error}</span>}
                  {h.next_retry_at && (
                    <span className="text-muted-foreground">
                      · next: {new Date(h.next_retry_at).toLocaleTimeString()}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
