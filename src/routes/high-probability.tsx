import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Sparkles, FileDown, Package } from "lucide-react";
import { toast } from "sonner";
import { listHighProbabilityJobs } from "@/lib/engine.functions";
import { getJobPacket } from "@/lib/jobs.functions";
import { exportApplicationPdf } from "@/lib/pdf-export";
import { withRetry } from "@/lib/api-utils";

export const Route = createFileRoute("/high-probability")({ component: HighProb });

function HighProb() {
  const listFn = useServerFn(listHighProbabilityJobs);
  const packetFn = useServerFn(getJobPacket);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    withRetry(() => listFn(), { label: "Load", silent: true })
      .then((r: any) => setJobs(r.jobs))
      .finally(() => setLoading(false));
  }, []);

  const exportPdf = async (j: any) => {
    try {
      const packet: any = await packetFn({ data: { jobId: j.id } });
      exportApplicationPdf(packet, `${j.company_name.replace(/\W+/g,"-")}-${j.title.replace(/\W+/g,"-")}.pdf`);
      toast.success("PDF exported");
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="p-6 space-y-6 max-w-[1500px] mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-accent" /> High-Probability Applications
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Trust 90+ · Interview probability 85+ · Salary ≥ $55K · Remote · Supported ATS · Manual Review only.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Ready to apply</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…</div>
          ) : jobs.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              No high-probability jobs yet. Run today's batch from the Dashboard.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead>Trust</TableHead>
                  <TableHead>Probability</TableHead>
                  <TableHead>Salary</TableHead>
                  <TableHead>ATS</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((j) => (
                  <TableRow key={j.id} className="hover:bg-muted/40">
                    <TableCell>
                      <div className="font-medium text-sm">{j.title}</div>
                      <div className="text-xs text-muted-foreground">{j.company_name}</div>
                    </TableCell>
                    <TableCell><Badge variant="outline" className="border-success/40 text-success">{j.companies?.trust_score ?? j.legitimacy ?? 0}</Badge></TableCell>
                    <TableCell><span className="text-lg font-semibold tabular-nums text-accent">{j.interview_probability}</span></TableCell>
                    <TableCell className="text-xs tabular-nums">${((j.salary_min??0)/1000).toFixed(0)}–{((j.salary_max??0)/1000).toFixed(0)}k</TableCell>
                    <TableCell><span className="text-xs font-mono">{j.ats}</span></TableCell>
                    <TableCell className="flex gap-1">
                      <Button asChild size="sm" variant="outline"><Link to="/packet/$jobId" params={{ jobId: j.id }}><Package className="h-3.5 w-3.5" /></Link></Button>
                      <Button size="sm" variant="ghost" onClick={() => exportPdf(j)}><FileDown className="h-3.5 w-3.5" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
