import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertTriangle, CheckCircle2, X, FileDown, Loader2, ExternalLink,
  Eye, Copy, Send, RotateCcw, Clock, ShieldAlert, Ban, Archive,
} from "lucide-react";
import { toast } from "sonner";
import {
  listApplications,
  decideApplication,
  listApplicationActivity,
} from "@/lib/applications.functions";
import { getJobPacket } from "@/lib/jobs.functions";
import { withRetry } from "@/lib/api-utils";
import { exportApplicationPdf } from "@/lib/pdf-export";

export const Route = createFileRoute("/review")({ component: Review });

type TabKey = "manual_review" | "approved" | "rejected" | "safety_blocked" | "skipped_cap";

const TAB_META: Record<TabKey, { label: string; icon: any; statuses: string[] }> = {
  manual_review: { label: "Manual Review", icon: AlertTriangle, statuses: ["manual_review"] },
  approved: { label: "Approved / Ready Packets", icon: CheckCircle2, statuses: ["approved", "submitted_manually", "submitted_manual", "submitted", "follow_up_due", "interview_requested", "recruiter_screen", "technical_interview", "final_interview", "interview"] },
  rejected: { label: "Rejected", icon: Ban, statuses: ["rejected"] },
  safety_blocked: { label: "Safety Blocked", icon: ShieldAlert, statuses: ["safety_blocked"] },
  skipped_cap: { label: "Skipped / Capped", icon: Archive, statuses: ["skipped_cap"] },
};

function submissionBadge(status: string) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
    manual_review: { label: "Prepared", variant: "outline" },
    approved: { label: "Ready to Apply", variant: "default" },
    submitted: { label: "Submitted", variant: "secondary" },
    submitted_manually: { label: "Submitted Manually", variant: "secondary" },
    submitted_manual: { label: "Submitted Manually", variant: "secondary" },
    follow_up_due: { label: "Follow-up Scheduled", variant: "outline" },
    interview_requested: { label: "Interview Requested", variant: "default" },
    recruiter_screen: { label: "Recruiter Screen", variant: "default" },
    technical_interview: { label: "Technical Interview", variant: "default" },
    final_interview: { label: "Final Interview", variant: "default" },
    interview: { label: "Interview", variant: "default" },
    rejected: { label: "Rejected", variant: "destructive" },
    safety_blocked: { label: "Safety Blocked", variant: "destructive" },
    skipped_cap: { label: "Skipped (Cap)", variant: "outline" },
  };
  const m = map[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

function Review() {
  const listFn = useServerFn(listApplications);
  const decideFn = useServerFn(decideApplication);
  const packetFn = useServerFn(getJobPacket);
  const activityFn = useServerFn(listApplicationActivity);

  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<TabKey>("manual_review");
  const [openTimeline, setOpenTimeline] = useState<Record<string, any[]>>({});

  const load = async () => {
    setLoading(true);
    try {
      const { applications } = await withRetry(() => listFn(), { label: "Load applications" });
      setItems(applications);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const counts = useMemo(() => {
    const out: Record<TabKey, number> = {
      manual_review: 0, approved: 0, rejected: 0, safety_blocked: 0, skipped_cap: 0,
    };
    for (const a of items) {
      for (const k of Object.keys(TAB_META) as TabKey[]) {
        if (TAB_META[k].statuses.includes(a.status)) out[k]++;
      }
    }
    return out;
  }, [items]);

  const visibleItems = useMemo(
    () => items.filter((a) => TAB_META[tab].statuses.includes(a.status)),
    [items, tab],
  );

  const decide = async (app: any, decision: "approve" | "reject" | "review_anyway") => {
    setBusy(app.id);
    try {
      const res: any = await withRetry(
        () => decideFn({ data: { application_id: app.id, decision, note: notes[app.id] } }),
        { label: "Update status" },
      );
      if (decision === "approve") {
        if (res?.packet_generated) {
          toast.success("Application approved and packet created");
        } else if (res?.packet_error) {
          toast.error(`Packet generation failed — kept in Manual Review. ${res.packet_error.slice(0, 160)}`);
        }
      } else if (decision === "reject") {
        toast.success("Rejected");
      } else {
        toast.success("Moved back to Manual Review");
      }
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Action failed");
    } finally {
      setBusy(null);
    }
  };

  const exportPdf = async (app: any) => {
    setBusy(app.id);
    try {
      const packet = await withRetry(() => packetFn({ data: { jobId: app.job_id } }), { label: "Build packet" });
      if (!packet.job) return toast.error("Job not found");
      exportApplicationPdf(packet as any, `${packet.job.company_name.replace(/\W+/g, "-")}-packet.pdf`);
      toast.success("PDF exported");
    } catch (e: any) {
      toast.error(e?.message ?? "Export failed");
    } finally {
      setBusy(null);
    }
  };

  const copyPacketPiece = async (app: any, which: "resume" | "cover") => {
    try {
      const packet: any = await packetFn({ data: { jobId: app.job_id } });
      const text =
        which === "resume"
          ? [packet?.resume?.summary, ...(packet?.resume?.bullets ?? [])].filter(Boolean).join("\n\n")
          : packet?.cover?.body ?? "";
      if (!text) return toast.error(`No ${which} found. Generate the packet first.`);
      await navigator.clipboard.writeText(text);
      toast.success(`${which === "resume" ? "Resume" : "Cover letter"} copied`);
    } catch (e: any) {
      toast.error(e?.message ?? "Copy failed");
    }
  };

  const loadTimeline = async (app: any) => {
    if (openTimeline[app.id]) {
      setOpenTimeline((p) => { const c = { ...p }; delete c[app.id]; return c; });
      return;
    }
    try {
      const { logs } = await activityFn({ data: { application_id: app.id } });
      setOpenTimeline((p) => ({ ...p, [app.id]: logs }));
    } catch (e: any) {
      toast.error(e?.message ?? "Timeline failed");
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Application Review</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Browser automation is disabled. Approving creates a packet you submit by hand.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList className="flex flex-wrap h-auto">
          {(Object.keys(TAB_META) as TabKey[]).map((k) => {
            const Icon = TAB_META[k].icon;
            return (
              <TabsTrigger key={k} value={k} className="gap-2">
                <Icon className="h-3.5 w-3.5" />
                {TAB_META[k].label}
                <Badge variant="secondary" className="ml-1 tabular-nums">{counts[k]}</Badge>
              </TabsTrigger>
            );
          })}
        </TabsList>

        {(Object.keys(TAB_META) as TabKey[]).map((k) => (
          <TabsContent key={k} value={k} className="mt-4">
            {loading ? (
              <div className="flex items-center justify-center py-20 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
              </div>
            ) : visibleItems.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-12 border border-dashed rounded-md">
                Nothing here yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {visibleItems.map((app) => {
                  const j = app.job_listings ?? {};
                  const isManual = app.status === "manual_review";
                  const isApproved = TAB_META.approved.statuses.includes(app.status);
                  const isCapped = app.status === "skipped_cap";
                  const isBlocked = app.status === "safety_blocked";
                  return (
                    <Card
                      key={app.id}
                      className={
                        isApproved ? "border-l-4 border-l-success"
                        : isBlocked ? "border-l-4 border-l-destructive"
                        : isCapped ? "border-l-4 border-l-muted-foreground"
                        : "border-l-4 border-l-warning"
                      }
                    >
                      <CardContent className="p-5 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="font-semibold truncate">{j.title ?? "—"}</div>
                            <div className="text-sm text-muted-foreground">
                              {j.company_name ?? "—"} · {j.ats || "—"}
                            </div>
                          </div>
                          <div className="text-right space-y-1">
                            <div className="text-2xl font-semibold text-accent tabular-nums">{j.final_score ?? "—"}</div>
                            {submissionBadge(app.status)}
                          </div>
                        </div>

                        {app.notes && (
                          <div className="text-xs text-muted-foreground bg-muted/40 rounded px-2 py-1.5 line-clamp-3">
                            {app.notes}
                          </div>
                        )}

                        {Array.isArray(j.blockers) && j.blockers.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {j.blockers.map((b: string) => {
                              const isAi = b === "invalid_openai_key" || b === "packet_generation_disabled";
                              return (
                                <Badge
                                  key={b}
                                  variant={isAi ? "destructive" : "outline"}
                                  className="text-[10px] font-normal"
                                  title={
                                    b === "invalid_openai_key" ? "OpenAI key invalid — packet generation unavailable" :
                                    b === "packet_generation_disabled" ? "Packet generation was skipped for this job" :
                                    b.startsWith("mapped_salary_source:") ? `Salary source remapped from ${b.split(":")[1]} → unknown` :
                                    b
                                  }
                                >
                                  {b}
                                </Badge>
                              );
                            })}
                          </div>
                        )}

                        {isApproved && (
                          <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs space-y-2">
                            <div className="font-medium flex items-center gap-1.5">
                              <AlertTriangle className="h-3.5 w-3.5 text-warning-foreground" />
                              This application has NOT been submitted automatically.
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {j.source_url && (
                                <Button size="sm" variant="default" asChild>
                                  <a href={j.source_url} target="_blank" rel="noreferrer">
                                    <Send className="h-3.5 w-3.5 mr-1" /> Apply on Company Site
                                  </a>
                                </Button>
                              )}
                              <Button size="sm" variant="outline" onClick={() => copyPacketPiece(app, "resume")}>
                                <Copy className="h-3.5 w-3.5 mr-1" /> Copy Resume
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => copyPacketPiece(app, "cover")}>
                                <Copy className="h-3.5 w-3.5 mr-1" /> Copy Cover Letter
                              </Button>
                            </div>
                          </div>
                        )}

                        {isManual && (
                          <Textarea
                            placeholder="Note for this decision (optional)…"
                            value={notes[app.id] ?? ""}
                            onChange={(e) => setNotes((p) => ({ ...p, [app.id]: e.target.value }))}
                            rows={2}
                            className="text-xs"
                          />
                        )}

                        <div className="flex flex-wrap gap-2 pt-1">
                          {j.source_url && (
                            <Button size="sm" variant="outline" asChild>
                              <a href={j.source_url} target="_blank" rel="noreferrer">
                                <ExternalLink className="h-3.5 w-3.5 mr-1" /> Open Job Posting
                              </a>
                            </Button>
                          )}
                          <Button size="sm" variant="outline" asChild>
                            <Link to="/packet/$jobId" params={{ jobId: app.job_id }}>
                              <Eye className="h-3.5 w-3.5 mr-1" /> View Packet
                            </Link>
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => exportPdf(app)} title="Export PDF">
                            <FileDown className="h-3.5 w-3.5 mr-1" /> PDF
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => loadTimeline(app)}>
                            <Clock className="h-3.5 w-3.5 mr-1" />
                            {openTimeline[app.id] ? "Hide Timeline" : "Audit Timeline"}
                          </Button>

                          {isManual && (
                            <>
                              <Button
                                size="sm"
                                disabled={busy === app.id}
                                className="bg-success text-success-foreground hover:bg-success/90"
                                onClick={() => decide(app, "approve")}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
                              </Button>
                              <Button size="sm" variant="outline" disabled={busy === app.id} onClick={() => decide(app, "reject")}>
                                <X className="h-3.5 w-3.5 mr-1" /> Reject
                              </Button>
                            </>
                          )}

                          {(isCapped || isBlocked) && (
                            <Button size="sm" variant="default" disabled={busy === app.id} onClick={() => decide(app, "review_anyway")}>
                              <RotateCcw className="h-3.5 w-3.5 mr-1" /> Review Anyway
                            </Button>
                          )}
                        </div>

                        {openTimeline[app.id] && (
                          <div className="border-t pt-2 mt-2 space-y-1.5">
                            <div className="text-xs font-medium text-muted-foreground">Audit timeline</div>
                            {openTimeline[app.id].length === 0 ? (
                              <div className="text-xs text-muted-foreground">No activity recorded yet.</div>
                            ) : (
                              <ol className="space-y-1 text-xs">
                                {openTimeline[app.id].map((l: any) => (
                                  <li key={l.id} className="flex items-center gap-2">
                                    <span className="text-muted-foreground tabular-nums">
                                      {new Date(l.created_at).toLocaleString()}
                                    </span>
                                    <Badge variant="outline" className="font-mono text-[10px]">{l.action}</Badge>
                                    {l.details?.note && <span className="text-muted-foreground truncate">{l.details.note}</span>}
                                  </li>
                                ))}
                              </ol>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
