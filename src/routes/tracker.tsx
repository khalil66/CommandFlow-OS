import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { APPLIED_JOBS } from "@/lib/mock-data";
import { StatusBadge } from "@/components/score-bar";

export const Route = createFileRoute("/tracker")({ component: Tracker });

function Tracker() {
  const groups = {
    All: APPLIED_JOBS,
    Applied: APPLIED_JOBS.filter(j => j.status === "Applied"),
    Interview: APPLIED_JOBS.filter(j => j.status === "Interview"),
    Offer: APPLIED_JOBS.filter(j => j.status === "Offer"),
  };

  return (
    <div className="p-6 space-y-6 max-w-[1500px] mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Application Tracker</h1>
        <p className="text-sm text-muted-foreground mt-1">Every submitted application, with resume version and outcome.</p>
      </div>

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
                      <TableHead>Applied</TableHead>
                      <TableHead>Resume</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {v.map(j => (
                      <TableRow key={j.id}>
                        <TableCell className="font-medium text-sm">{j.title}</TableCell>
                        <TableCell className="text-sm">{j.company}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Date((j as any).appliedDate).toLocaleDateString()}</TableCell>
                        <TableCell><span className="text-xs font-mono px-1.5 py-0.5 rounded bg-secondary">{(j as any).resumeVersion}</span></TableCell>
                        <TableCell className="font-semibold tabular-nums text-accent">{j.finalScore}</TableCell>
                        <TableCell><StatusBadge status={j.status} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
