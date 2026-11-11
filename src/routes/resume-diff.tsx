import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, FileDiff, AlertTriangle, CheckCircle2, ArrowRight, Gauge } from "lucide-react";
import { getResumeDiff } from "@/lib/intelligence.functions";
import { listResumes } from "@/lib/resume.functions";

export const Route = createFileRoute("/resume-diff")({
  component: ResumeDiffPage,
  validateSearch: (s: Record<string, unknown>): { resume_id?: string; variant_key?: string } => ({
    resume_id: typeof s.resume_id === "string" ? s.resume_id : undefined,
    variant_key: typeof s.variant_key === "string" ? s.variant_key : undefined,
  }),
});

function ResumeDiffPage() {
  const search = Route.useSearch();
  const diffFn = useServerFn(getResumeDiff);
  const listFn = useServerFn(listResumes);
  const [data, setData] = useState<any>(null);
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | undefined>(search.resume_id);

  useEffect(() => {
    listFn().then((r: any) => {
      setList(r.resumes);
      if (!selected && r.resumes[0]) setSelected(r.resumes[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selected && !search.variant_key) return;
    setLoading(true);
    diffFn({ data: { resume_id: selected, variant_key: search.variant_key } })
      .then(setData)
      .finally(() => setLoading(false));
  }, [selected, search.variant_key]);

  return (
    <div className="p-6 space-y-6 max-w-[1500px] mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <FileDiff className="h-5 w-5" /> Resume Diff Viewer
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Compare master profile vs tailored resume — keywords, bullets, readability, ATS fit.</p>
        </div>
        {list.length > 0 && (
          <select
            value={selected ?? ""}
            onChange={(e) => setSelected(e.target.value)}
            className="px-3 py-2 text-sm bg-card border border-border rounded-md min-w-[280px]"
          >
            {list.map((r) => (
              <option key={r.id} value={r.id}>{r.label ?? r.variant_key} — {r.match_score}/100</option>
            ))}
          </select>
        )}
      </div>

      {loading && <div className="flex items-center justify-center py-32 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading diff…</div>}

      {!loading && data && !data.tailored && (
        <Card><CardContent className="py-16 text-center text-sm text-muted-foreground">
          No tailored resumes yet. <Link to="/resume" className="text-accent underline">Generate one in Resume Studio →</Link>
        </CardContent></Card>
      )}

      {!loading && data?.tailored && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Metric label="Match score" value={`${data.tailored.match_score}/100`} accent="text-accent" />
            <Metric label="Match Δ vs master" value={`${data.diff.match_improvement >= 0 ? "+" : ""}${data.diff.match_improvement}`} accent={data.diff.match_improvement >= 0 ? "text-success" : "text-destructive"} />
            <Metric label="Keywords added" value={data.diff.keywords_added.length} />
            <Metric label="Bullets" value={data.diff.bullets_changed} />
            <Metric label="Readability" value={data.diff.readability} icon={Gauge} />
          </div>

          {data.diff.stuffing_warning && (
            <Card className="border-warning/40 bg-warning/5">
              <CardContent className="p-4 flex items-start gap-3">
                <AlertTriangle className="h-4 w-4 mt-0.5 text-warning-foreground" />
                <div>
                  <div className="text-sm font-medium">Possible keyword stuffing</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Repeated 4+ times: {data.diff.stuffed_keywords.join(", ")}</div>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Side title="Master (baseline)" subtitle="Khalil's general profile">
              <Block title="Summary"><p className="text-sm leading-relaxed">{data.master.summary}</p></Block>
              <Block title="Skills">
                <div className="flex flex-wrap gap-1">{data.master.skills.map((s: string) => <Badge key={s} variant="outline">{s}</Badge>)}</div>
              </Block>
              <Block title="Bullets">
                <ul className="space-y-2 text-sm">{data.master.bullets.map((b: string, i: number) => <li key={i} className="flex gap-2"><span className="text-muted-foreground">•</span>{b}</li>)}</ul>
              </Block>
            </Side>

            <Side title="Tailored" subtitle={data.tailored.label} highlight>
              <Block title="Summary"><p className="text-sm leading-relaxed">{data.tailored.summary}</p></Block>
              <Block title={`Skills (${data.tailored.skills.length})`}>
                <div className="flex flex-wrap gap-1">{data.tailored.skills.map((s: string) => {
                  const added = data.diff.skills_added.includes(s);
                  return <Badge key={s} variant={added ? "default" : "outline"} className={added ? "bg-success/15 text-success border-success/30" : ""}>{added && <CheckCircle2 className="h-3 w-3 mr-1" />}{s}</Badge>;
                })}</div>
              </Block>
              <Block title={`ATS keywords (${data.tailored.keywords.length})`}>
                <div className="flex flex-wrap gap-1">{data.tailored.keywords.map((k: string) => {
                  const added = data.diff.keywords_added.includes(k);
                  return <Badge key={k} variant={added ? "default" : "secondary"} className={added ? "bg-accent/20 text-accent-foreground border-accent/30" : ""}>{added && <ArrowRight className="h-3 w-3 mr-1" />}{k}</Badge>;
                })}</div>
              </Block>
              <Block title="Bullets">
                <ul className="space-y-2 text-sm">{data.tailored.bullets.map((b: string, i: number) => <li key={i} className="flex gap-2"><span className="text-accent">→</span>{b}</li>)}</ul>
              </Block>
              {data.tailored.explanation && (
                <Block title="Why this scored">
                  <p className="text-xs text-muted-foreground italic">{data.tailored.explanation}</p>
                </Block>
              )}
            </Side>
          </div>

          <div className="flex gap-3">
            <Button asChild variant="outline"><Link to="/resume">Back to Resume Studio</Link></Button>
            <Button asChild variant="outline"><Link to="/analytics">Analytics</Link></Button>
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, accent, icon: Icon }: any) {
  return (
    <Card><CardContent className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums ${accent ?? ""}`}>{value}</div>
        </div>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </div>
    </CardContent></Card>
  );
}

function Side({ title, subtitle, highlight, children }: any) {
  return (
    <Card className={highlight ? "border-accent/30" : ""}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

function Block({ title, children }: any) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{title}</div>
      {children}
    </div>
  );
}
