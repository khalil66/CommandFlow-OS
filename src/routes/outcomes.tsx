import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getOutcomeDashboard,
  recalibrateInterviewProbabilities,
  generateWeeklyRecommendations,
} from "@/lib/outcome-learning.functions";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Sparkles, TrendingUp, AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { ChartCard, EmptyChart, humanizeReason } from "@/components/chart-card";

export const Route = createFileRoute("/outcomes")({
  head: () => ({
    meta: [
      { title: "Outcome Learning Engine" },
      { name: "description", content: "Track recruiter replies, interviews, and offers — and recalibrate scoring from real outcomes." },
    ],
  }),
  component: OutcomesPage,
});

function Stat({ label, value, suffix }: { label: string; value: string | number; suffix?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold">{value}{suffix}</div>
    </div>
  );
}

function FunnelBar({ label, n, of, color }: { label: string; n: number; of: number; color: string }) {
  const pct = of > 0 ? (n / of) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{n} <span className="text-muted-foreground">({pct.toFixed(1)}%)</span></span>
      </div>
      <div className="h-2 w-full rounded bg-muted overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
    </div>
  );
}

function SegmentTable({ title, rows }: { title: string; rows: any[] }) {
  if (!rows?.length) return null;
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-2">
          {rows.slice(0, 8).map((r) => (
            <div key={r.name} className="flex items-center justify-between gap-3 text-sm">
              <div className="truncate font-medium">{r.name}</div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="secondary">{r.funnel.submitted} sub</Badge>
                <Badge>{r.funnel.reply_rate}% reply</Badge>
                <Badge variant="outline">{r.funnel.interview_rate}% intv</Badge>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function OutcomesPage() {
  const fetchDash = useServerFn(getOutcomeDashboard);
  const recalibrate = useServerFn(recalibrateInterviewProbabilities);
  const generateWeekly = useServerFn(generateWeeklyRecommendations);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["outcome-dashboard"],
    queryFn: () => fetchDash(),
  });

  const recalMut = useMutation({
    mutationFn: () => recalibrate(),
    onSuccess: (r) => {
      toast.success(`Recalibrated ${r.updated} job probabilities (baseline ${r.baseline_reply_rate}%)`);
      qc.invalidateQueries({ queryKey: ["outcome-dashboard"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const weeklyMut = useMutation({
    mutationFn: () => generateWeekly(),
    onSuccess: (r) => toast.success(`Generated ${r.recommendations.length} recommendations`),
    onError: (e: any) => toast.error(e.message),
  });

  const f = data?.funnel;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Sparkles className="h-7 w-7" /> Outcome Learning Engine
          </h1>
          <p className="text-muted-foreground mt-1">
            Track recruiter replies, interviews, and offers — feed real outcomes back into scoring.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => recalMut.mutate()} disabled={recalMut.isPending} variant="outline">
            <RefreshCw className="h-4 w-4 mr-2" /> Recalibrate probabilities
          </Button>
          <Button onClick={() => weeklyMut.mutate()} disabled={weeklyMut.isPending}>
            <TrendingUp className="h-4 w-4 mr-2" /> Generate weekly plan
          </Button>
        </div>
      </div>

      {isLoading && <div className="text-muted-foreground">Loading…</div>}

      {f && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Submitted" value={f.submitted} />
            <Stat label="Recruiter replies" value={f.recruiter_reply} />
            <Stat label="Interviews" value={f.interview} />
            <Stat label="Offers" value={f.offer} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Conversion funnel</CardTitle>
              <CardDescription>End-to-end: {f.end_to_end}% of submissions become offers.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <FunnelBar label="Submitted" n={f.submitted} of={f.submitted} color="bg-primary" />
              <FunnelBar label="Recruiter reply" n={f.recruiter_reply} of={f.submitted} color="bg-blue-500" />
              <FunnelBar label="Interview" n={f.interview} of={f.submitted} color="bg-violet-500" />
              <FunnelBar label="Offer" n={f.offer} of={f.submitted} color="bg-emerald-500" />
              <div className="grid grid-cols-3 gap-3 pt-2 text-sm">
                <div><span className="text-muted-foreground">Sub → reply:</span> <strong>{f.reply_rate}%</strong></div>
                <div><span className="text-muted-foreground">Reply → interview:</span> <strong>{f.interview_rate}%</strong></div>
                <div><span className="text-muted-foreground">Interview → offer:</span> <strong>{f.offer_rate}%</strong></div>
              </div>
            </CardContent>
          </Card>

          <div className="grid md:grid-cols-3 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Top job category</CardTitle></CardHeader>
              <CardContent>
                {data.top_category ? (
                  <>
                    <div className="text-xl font-semibold">{data.top_category.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {data.top_category.funnel.reply_rate}% reply · {data.top_category.funnel.submitted} subs
                    </div>
                  </>
                ) : <div className="text-sm text-muted-foreground">Not enough data</div>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Highest-converting ATS</CardTitle></CardHeader>
              <CardContent>
                {data.top_ats ? (
                  <>
                    <div className="text-xl font-semibold">{data.top_ats.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {data.top_ats.funnel.reply_rate}% reply · {data.top_ats.funnel.interview_rate}% intv
                    </div>
                  </>
                ) : <div className="text-sm text-muted-foreground">Not enough data</div>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Best resume variant</CardTitle></CardHeader>
              <CardContent>
                {data.top_resume ? (
                  <>
                    <div className="text-xl font-semibold">{data.top_resume.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {data.top_resume.funnel.reply_rate}% reply · {data.top_resume.funnel.submitted} subs
                    </div>
                  </>
                ) : <div className="text-sm text-muted-foreground">Not enough data</div>}
              </CardContent>
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <SegmentTable title="By role" rows={data.by_role} />
            <SegmentTable title="By ATS" rows={data.by_ats} />
            <SegmentTable title="By resume variant" rows={data.by_resume} />
            <SegmentTable title="By company" rows={data.by_company} />
          </div>

          {weeklyMut.data && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5" /> Weekly recommendations
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {weeklyMut.data.narrative && (
                  <p className="text-sm leading-relaxed bg-muted p-3 rounded">{weeklyMut.data.narrative}</p>
                )}
                {weeklyMut.data.recommendations.map((r, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    {r.tone === "warning" ? <AlertTriangle className="h-4 w-4 text-amber-500 mt-1" /> :
                     r.tone === "positive" ? <TrendingUp className="h-4 w-4 text-emerald-500 mt-1" /> :
                     <Sparkles className="h-4 w-4 text-muted-foreground mt-1" />}
                    <div>
                      <div className="font-medium text-sm">{r.title}</div>
                      <div className="text-sm text-muted-foreground">{r.detail}</div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
