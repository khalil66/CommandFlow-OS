import { pageMetadata } from "@/lib/page-metadata";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, CalendarDays, Play } from "lucide-react";
import { toast } from "sonner";
import { listBatches, runDailyBatch } from "@/lib/engine.functions";
import { withRetry } from "@/lib/api-utils";

export const Route = createFileRoute("/batches")({
  head: () => pageMetadata("Daily Batches", "Daily Batches for CommandFlow OS recruiting operations, with private account access and manual application approval."), component: BatchesPage });

const SCHEDULE = [
  { day: "Monday", category: "SaaS startups" },
  { day: "Tuesday", category: "Data / analytics" },
  { day: "Wednesday", category: "Customer success & ops" },
  { day: "Thursday", category: "Product / project management" },
  { day: "Friday", category: "Remote-first tech" },
  { day: "Saturday", category: "MBA-friendly startups" },
  { day: "Sunday", category: "Review & follow-ups" },
];

function BatchesPage() {
  const listFn = useServerFn(listBatches);
  const runFn = useServerFn(runDailyBatch);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const refresh = () => {
    setLoading(true);
    withRetry(() => listFn(), { label: "Load", silent: true })
      .then((r: any) => setRows(r.batches))
      .finally(() => setLoading(false));
  };
  useEffect(() => { refresh(); }, []);

  const run = async () => {
    setRunning(true);
    try {
      const res: any = await runFn();
      toast.success(res.reviewDay ? "Review day batch logged" : `Batch complete · ${res.batch?.applications_prepared ?? 0} applications prepared`);
      refresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setRunning(false); }
  };

  return (
    <div className="p-6 space-y-6 max-w-[1500px] mx-auto">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2"><CalendarDays className="h-5 w-5" /> Daily Batches</h1>
          <p className="text-sm text-muted-foreground mt-1">Company rotation · 30-day reapply guard · Manual Review only.</p>
        </div>
        <Button onClick={run} disabled={running} className="bg-accent text-accent-foreground hover:bg-accent/90">
          {running ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Play className="h-4 w-4 mr-1.5" />}
          Run today's batch
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Weekly rotation</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
            {SCHEDULE.map((s) => (
              <div key={s.day} className="border border-border rounded-md p-3 text-center">
                <div className="text-xs font-medium">{s.day}</div>
                <div className="text-[11px] text-muted-foreground mt-1">{s.category}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent batches</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…</div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-12 text-center">No batches yet. Click "Run today's batch".</p>
          ) : (
            <div className="divide-y divide-border">
              {rows.map((b) => (
                <div key={b.id} className="py-3 flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <div className="text-sm font-medium">{b.batch_date} · {b.day_of_week}</div>
                    <div className="text-xs text-muted-foreground">{b.category}</div>
                  </div>
                  <div className="flex gap-4 text-xs">
                    <Stat label="Reviewed" v={b.companies_reviewed} />
                    <Stat label="Found" v={b.jobs_found} />
                    <Stat label="Rejected" v={b.jobs_rejected} />
                    <Stat label="Prepared" v={b.applications_prepared} />
                    <Badge variant="outline">{b.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, v }: any) {
  return (
    <div className="text-center">
      <div className="text-base font-semibold tabular-nums">{v ?? 0}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
