import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/score-bar";
import { listApplications, updateApplicationStatus } from "@/lib/applications.functions";
import { markSubmittedManually, generateFollowUps, listFollowUpMessages } from "@/lib/outcomes.functions";
import { withRetry } from "@/lib/api-utils";
import { Loader2, Send, MessageSquare, Copy } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/tracker")({ component: Tracker });

const STATUS_OPTS = [
  "queued", "manual_review", "approved",
  "submitted", "submitted_manually",
  "follow_up_due", "interview_requested", "interview",
  "offer", "rejected", "ghosted", "withdrawn", "archived",
];

const FOLLOWUP_LABEL: Record<string, string> = {
  recruiter_followup: "Recruiter follow-up",
  linkedin_note: "LinkedIn note",
  thank_you: "Thank-you email",
  second_followup: "Second follow-up (7d)",
};

function Tracker() {
  const listFn = useServerFn(listApplications);
  const updateFn = useServerFn(updateApplicationStatus);
  const submitFn = useServerFn(markSubmittedManually);
  const genFn = useServerFn(generateFollowUps);
  const listMsgFn = useServerFn(listFollowUpMessages);
  const [apps, setApps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { applications } = await withRetry(() => listFn(), { label: "Load applications" });
      setApps(applications);
    } catch {} finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const onChangeStatus = async (id: string, status: string) => {
    try {
      await withRetry(() => updateFn({ data: { application_id: id, status: status as any } }), { label: "Update status" });
      setApps(prev => prev.map(a => a.id === id ? { ...a, status } : a));
      toast.success("Status updated");
    } catch {}
  };

  const groups = useMemo(() => ({
    All: apps,
    "Manual Review": apps.filter(a => a.status === "manual_review"),
    Approved: apps.filter(a => a.status === "approved"),
    Submitted: apps.filter(a => a.status === "submitted_manually" || a.status === "submitted"),
    "Follow-up Due": apps.filter(a => a.status === "follow_up_due"),
    Interview: apps.filter(a => a.status === "interview" || a.status === "interview_requested"),
    Offer: apps.filter(a => a.status === "offer"),
    Rejected: apps.filter(a => a.status === "rejected" || a.status === "ghosted"),
    Archived: apps.filter(a => a.status === "archived"),
  }), [apps]);

  return (
    <div className="p-6 space-y-6 max-w-[1500px] mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Application Tracker</h1>
        <p className="text-sm text-muted-foreground mt-1">Outcomes, manual submissions, and follow-up messaging — all in Manual Review mode.</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…</div>
      ) : (
        <Tabs defaultValue="All">
          <TabsList className="flex-wrap h-auto">
            {Object.entries(groups).map(([k, v]) => (
              <TabsTrigger key={k} value={k}>{k} <span className="ml-1.5 text-xs text-muted-foreground">{v.length}</span></TabsTrigger>
            ))}
          </TabsList>
          {Object.entries(groups).map(([k, v]) => (
            <TabsContent key={k} value={k}>
              <Card>
                <CardContent className="p-0 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Role</TableHead>
                        <TableHead>Company</TableHead>
                        <TableHead>ATS</TableHead>
                        <TableHead>Updated</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Change</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {v.length === 0 && (
                        <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No applications</TableCell></TableRow>
                      )}
                      {v.map((a: any) => {
                        const j = a.job_listings ?? {};
                        return (
                          <TableRow key={a.id}>
                            <TableCell className="font-medium text-sm">{j.title ?? "—"}</TableCell>
                            <TableCell className="text-sm">{j.company_name ?? "—"}</TableCell>
                            <TableCell className="text-xs font-mono">{j.ats ?? "—"}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{new Date(a.updated_at).toLocaleDateString()}</TableCell>
                            <TableCell><StatusBadge status={a.status} /></TableCell>
                            <TableCell>
                              <Select value={a.status} onValueChange={(v) => onChangeStatus(a.id, v)}>
                                <SelectTrigger className="h-7 text-xs w-[160px]"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {STATUS_OPTS.map(s => <SelectItem key={s} value={s} className="text-xs">{s.replace(/_/g," ")}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell className="text-right space-x-1 whitespace-nowrap">
                              <SubmitDialog app={a} onDone={load} submitFn={submitFn} />
                              <FollowUpDialog app={a} genFn={genFn} listMsgFn={listMsgFn} />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}

function SubmitDialog({ app, onDone, submitFn }: any) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(app.application_url ?? "");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await withRetry(() => submitFn({ data: {
        application_id: app.id,
        submitted_at: new Date(date).toISOString(),
        application_url: url || undefined,
        resume_version_id: app.resume_version_id ?? undefined,
        cover_letter_id: app.cover_letter_id ?? undefined,
        notes: notes || undefined,
      } }), { label: "Mark submitted" });
      toast.success("Marked as submitted manually");
      setOpen(false);
      onDone();
    } catch {} finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 text-xs"><Send className="h-3 w-3 mr-1" />Mark Submitted</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Mark as Submitted Manually</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Submitted date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Application URL</Label>
            <Input placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <div className="text-xs text-muted-foreground">
            Resume version: <span className="font-mono">{app.resume_version_id ? app.resume_version_id.slice(0, 8) : "none"}</span> ·
            Cover letter: <span className="font-mono">{app.cover_letter_id ? app.cover_letter_id.slice(0, 8) : "none"}</span>
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Referral, recruiter contact, anything useful…" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FollowUpDialog({ app, genFn, listMsgFn }: any) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);

  const load = async () => {
    try {
      const { messages } = await listMsgFn({ data: { application_id: app.id } });
      setMessages(messages);
    } catch {}
  };
  useEffect(() => { if (open) load(); }, [open]);

  const generate = async (kinds: string[]) => {
    setBusy(true);
    try {
      await withRetry(() => genFn({ data: { application_id: app.id, kinds: kinds as any } }), { label: "Generate follow-ups" });
      toast.success("Follow-ups generated");
      load();
    } catch {} finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 text-xs"><MessageSquare className="h-3 w-3 mr-1" />Follow-ups</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Follow-up Messages</DialogTitle></DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => generate(["recruiter_followup"])}>Recruiter</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => generate(["linkedin_note"])}>LinkedIn</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => generate(["thank_you"])}>Thank-you</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => generate(["second_followup"])}>2nd Follow-up (7d)</Button>
          <Button size="sm" disabled={busy} onClick={() => generate(["recruiter_followup","linkedin_note","thank_you","second_followup"])}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Generate all"}
          </Button>
        </div>
        <div className="space-y-3 mt-2">
          {messages.length === 0 && <div className="text-sm text-muted-foreground py-4 text-center">No messages yet. Generate above.</div>}
          {messages.map((m: any) => (
            <Card key={m.id}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Badge variant="secondary">{FOLLOWUP_LABEL[m.kind] ?? m.kind}</Badge>
                  <Button size="sm" variant="ghost" className="h-6" onClick={() => { navigator.clipboard.writeText(m.body); toast.success("Copied"); }}>
                    <Copy className="h-3 w-3 mr-1" />Copy
                  </Button>
                </div>
                <pre className="whitespace-pre-wrap text-sm font-sans">{m.body}</pre>
              </CardContent>
            </Card>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
