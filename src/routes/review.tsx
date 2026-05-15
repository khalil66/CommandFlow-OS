import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MOCK_JOBS } from "@/lib/mock-data";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/review")({ component: Review });

function Review() {
  const items = MOCK_JOBS.filter(j => j.status === "Manual Review" || (j.blockers.length > 0 && j.status !== "Rejected"));

  return (
    <div className="p-6 space-y-6 max-w-[1300px] mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Manual Review Queue</h1>
        <p className="text-sm text-muted-foreground mt-1">Jobs blocked by login, MFA, or CAPTCHA — needs your decision.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {items.map(j => (
          <Card key={j.id} className="border-l-4 border-l-warning">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold">{j.title}</div>
                  <div className="text-sm text-muted-foreground">{j.company} · {j.ats}</div>
                </div>
                <div className="text-2xl font-semibold text-accent tabular-nums">{j.finalScore}</div>
              </div>

              <div className="space-y-1.5">
                {j.blockers.map(b => (
                  <div key={b} className="flex items-center gap-2 text-xs">
                    <AlertTriangle className="h-3.5 w-3.5 text-warning-foreground" /> {b}
                  </div>
                ))}
              </div>

              <div className="flex gap-2 pt-2">
                <Button size="sm" className="flex-1 bg-success text-success-foreground hover:bg-success/90" onClick={() => toast.success("Marked for manual apply")}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> I'll apply manually
                </Button>
                <Button size="sm" variant="outline" onClick={() => toast("Skipped")}>
                  <X className="h-3.5 w-3.5 mr-1" /> Skip
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {items.length === 0 && (
          <div className="md:col-span-2 text-sm text-muted-foreground text-center py-12 border border-dashed rounded-md">
            Nothing waiting. The bot is handling everything.
          </div>
        )}
      </div>
    </div>
  );
}
