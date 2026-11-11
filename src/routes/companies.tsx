import { pageMetadata } from "@/lib/page-metadata";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, RefreshCw, Building2 } from "lucide-react";
import { toast } from "sonner";
import { listCompanies, verifyCompany } from "@/lib/engine.functions";
import { withRetry } from "@/lib/api-utils";

export const Route = createFileRoute("/companies")({
  head: () => pageMetadata("Companies", "Companies for CommandFlow OS recruiting operations, with private account access and manual application approval."), component: CompaniesPage });

function CompaniesPage() {
  const listFn = useServerFn(listCompanies);
  const verifyFn = useServerFn(verifyCompany);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    setLoading(true);
    withRetry(() => listFn(), { label: "Load", silent: true })
      .then((r: any) => setRows(r.companies))
      .finally(() => setLoading(false));
  };
  useEffect(() => { refresh(); }, []);

  const reverify = async (id: string, name: string) => {
    try {
      await verifyFn({ data: { company_id: id } });
      toast.success(`Re-verified ${name}`);
      refresh();
    } catch (e: any) { toast.error(e.message); }
  };

  const statusBadge = (s: string) => {
    if (s === "verified") return <Badge className="bg-success/15 text-success border-success/30">Verified</Badge>;
    if (s === "manual_review") return <Badge variant="outline" className="border-warning/40 text-warning-foreground">Manual review</Badge>;
    return <Badge variant="destructive">Rejected</Badge>;
  };

  return (
    <div className="p-6 space-y-6 max-w-[1500px] mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2"><Building2 className="h-5 w-5" /> Companies</h1>
        <p className="text-sm text-muted-foreground mt-1">Trust scores · verification status · 30-day re-apply guard.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">{rows.length} companies</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…</div>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">No companies yet. Seed sample data from the Queue.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Trust</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Hiring</TableHead>
                  <TableHead>Last applied</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id} className="hover:bg-muted/40">
                    <TableCell>
                      <div className="font-medium text-sm">{c.name}</div>
                      <div className="text-xs text-muted-foreground">{c.domain}</div>
                    </TableCell>
                    <TableCell><span className="text-xs font-mono">{c.category}</span></TableCell>
                    <TableCell><span className="text-lg font-semibold tabular-nums text-accent">{c.trust_score ?? 0}</span></TableCell>
                    <TableCell>{statusBadge(c.verification_status)}</TableCell>
                    <TableCell><span className="text-xs tabular-nums">{c.hiring_activity ?? 0}</span></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{c.last_applied_at ? new Date(c.last_applied_at).toLocaleDateString() : "—"}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => reverify(c.id, c.name)} title="Re-verify">
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
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
