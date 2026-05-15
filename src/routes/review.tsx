import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, CheckCircle2, X, FileDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { listApplications, decideApplication } from "@/lib/applications.functions";
import { getJobPacket } from "@/lib/jobs.functions";
import { withRetry } from "@/lib/api-utils";
import { exportApplicationPdf } from "@/lib/pdf-export";
import { StatusBadge } from "@/components/score-bar";

export const Route = createFileRoute("/review")({ component: Review });

function Review() {
  const listFn = useServerFn(listApplications);
  const decideFn = useServerFn(decideApplication);
  const packetFn = useServerFn(getJobPacket);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    try {
      const { applications } = await withRetry(() => listFn(), { label: "Load applications" });
      setItems(applications.filter((a: any) => a.status === "manual_review"));
    } catch {} finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const decide = async (app: any, decision: "approve" | "reject") => {
    setBusy(app.id);
    try {
      await withRetry(() => decideFn({ data: { application_id: app.id, decision, note: notes[app.id] } }), { label: "Update status" });
      toast.success(decision === "approve" ? "Approved (queued for manual submission)" : "Rejected");
      setItems(prev => prev.filter(i => i.id !== app.id));
    } catch {} finally { setBusy(null); }
  };

  const exportPdf = async (app: any) => {
    setBusy(app.id);
    try {
      const packet = await withRetry(() => packetFn({ data: { jobId: app.job_id } }), { label: "Build packet" });
      if (!packet.job) return toast.error("Job not found");
      exportApplicationPdf(packet as any, `${packet.job.company_name.replace(/\W+/g,"-")}-packet.pdf`);
      toast.success("PDF exported");
    } catch {} finally { setBusy(null); }
  };

  return (
    <div className="p-6 space-y-6 max-w-[1300px] mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Manual Review Queue</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Browser automation is disabled. Approving queues a packet for you to submit by hand.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-12 border border-dashed rounded-md">
          No applications waiting for review. Save jobs from the Queue to populate this list.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map(app => {
            const j = app.job_listings ?? {};
            return (
              <Card key={app.id} className="border-l-4 border-l-warning">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold">{j.title}</div>
                      <div className="text-sm text-muted-foreground">{j.company_name} · {j.ats || "—"}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-semibold text-accent tabular-nums">{j.final_score ?? "—"}</div>
                      <StatusBadge status={app.status} />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <AlertTriangle className="h-3.5 w-3.5 text-warning-foreground" />
                    Manual Review only — auto-submit disabled
                  </div>

                  <Textarea
                    placeholder="Note for this decision (optional)…"
                    value={notes[app.id] ?? ""}
                    onChange={e => setNotes(prev => ({ ...prev, [app.id]: e.target.value }))}
                    rows={2}
                    className="text-xs"
                  />

                  <div className="flex gap-2 pt-2">
                    <Button size="sm" disabled={busy === app.id} className="flex-1 bg-success text-success-foreground hover:bg-success/90" onClick={() => decide(app, "approve")}>
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
                    </Button>
                    <Button size="sm" disabled={busy === app.id} variant="outline" onClick={() => decide(app, "reject")}>
                      <X className="h-3.5 w-3.5 mr-1" /> Reject
                    </Button>
                    <Button size="sm" disabled={busy === app.id} variant="outline" onClick={() => exportPdf(app)} title="Export PDF">
                      <FileDown className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
