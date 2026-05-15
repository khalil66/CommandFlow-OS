import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/score-bar";
import { listApplications, updateApplicationStatus } from "@/lib/applications.functions";
import { withRetry } from "@/lib/api-utils";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/tracker")({ component: Tracker });

const STATUS_OPTS = ["queued","manual_review","approved","submitted","interview","rejected","offer","withdrawn"];

function Tracker() {
  const listFn = useServerFn(listApplications);
  const updateFn = useServerFn(updateApplicationStatus);
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
    Submitted: apps.filter(a => a.status === "submitted"),
    Interview: apps.filter(a => a.status === "interview"),
    Offer: apps.filter(a => a.status === "offer"),
  }), [apps]);

  return (
    <div className="p-6 space-y-6 max-w-[1500px] mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Application Tracker</h1>
        <p className="text-sm text-muted-foreground mt-1">Persisted application history with editable status.</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…</div>
      ) : (
        <Tabs defaultValue="All">
          <TabsList>
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
                        <TableHead>Score</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Change</TableHead>
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
                            <TableCell className="font-semibold tabular-nums text-accent">{j.final_score ?? "—"}</TableCell>
                            <TableCell><StatusBadge status={a.status} /></TableCell>
                            <TableCell>
                              <Select value={a.status} onValueChange={(v) => onChangeStatus(a.id, v)}>
                                <SelectTrigger className="h-7 text-xs w-[140px]"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {STATUS_OPTS.map(s => <SelectItem key={s} value={s} className="text-xs">{s.replace(/_/g," ")}</SelectItem>)}
                                </SelectContent>
                              </Select>
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
