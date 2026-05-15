import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Sparkles, CheckCircle2, XCircle, Bookmark, FileDown, Building2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { generatePacket, getLatestPacket, decideApplication } from "@/lib/packet.functions";
import { exportApplicationPdf } from "@/lib/pdf-export";

export const Route = createFileRoute("/packet/$jobId")({ component: PacketPage });

function confidenceVariant(c: string) {
  if (c === "Strong Match") return "default";
  if (c === "Good Match") return "secondary";
  if (c === "Stretch Opportunity") return "outline";
  return "destructive";
}

function PacketPage() {
  const { jobId } = Route.useParams();
  const getFn = useServerFn(getLatestPacket);
  const genFn = useServerFn(generatePacket);
  const decideFn = useServerFn(decideApplication);

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const load = async () => {
    setLoading(true);
    try { setData(await getFn({ data: { job_id: jobId } })); }
    catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [jobId]);

  const generate = async () => {
    setGenerating(true);
    try {
      const r = await genFn({ data: { job_id: jobId } });
      setData((d: any) => ({ ...d, ...r, _generated: r }));
      toast.success(`Packet ready · ${r.quality.confidence} (${r.quality.score}/100)`);
    } catch (e: any) { toast.error(e.message); }
    finally { setGenerating(false); }
  };

  const decide = async (decision: "approve" | "reject" | "save_for_later") => {
    try {
      const r = await decideFn({ data: { job_id: jobId, decision } });
      toast.success(`Marked ${r.status}`);
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  const exportPdf = () => {
    const g = data?._generated;
    const job = data?.job;
    if (!job) return;
    exportApplicationPdf({
      job: {
        title: job.title, company_name: job.company_name, location: job.location,
        ats: job.ats, salary_min: job.salary_min, salary_max: job.salary_max, source_url: job.source_url,
      },
      resume: g?.resume ?? data?.resume,
      cover: g?.cover ?? data?.cover,
      prep: g ? {
        quality_score: g.quality?.score, confidence: g.quality?.confidence,
        why_company: g.prep?.why_company, portfolio_project: g.portfolio_project,
        talking_points: g.prep?.talking_points, recruiter_questions: g.prep?.recruiter_questions,
        technical_questions: g.prep?.technical_questions, star_examples: g.prep?.star_examples,
        linkedin_tips: g.prep?.linkedin_tips, ats_summary: g.prep?.ats_summary,
      } : null,
    }, `${job.company_name}-${job.title}-packet.pdf`.replace(/\s+/g, "-"));
    toast.success("PDF exported");
  };

  if (loading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!data?.job) return <div className="p-6">Job not found.</div>;

  const job = data.job;
  const company = data.company;
  const g = data._generated;
  const resume = g?.resume ?? data.resume;
  const cover = g?.cover ?? data.cover;
  const prep = g?.prep;
  const quality = g?.quality;
  const app = data.application;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs text-muted-foreground"><Link to="/queue" className="hover:underline">← Back to queue</Link></div>
          <h1 className="text-2xl font-semibold">{job.title}</h1>
          <p className="text-muted-foreground">{job.company_name} · {job.location ?? "Remote"}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant="outline">{job.ats ?? "Unknown ATS"}</Badge>
            {job.salary_min && <Badge variant="secondary">${(job.salary_min/1000).toFixed(0)}k–${(job.salary_max ?? job.salary_min)/1000}k{job.salary_estimated && " (est.)"}</Badge>}
            {company?.trust_score != null && <Badge>Trust {company.trust_score}</Badge>}
            <Badge variant="secondary">Interview {job.interview_probability ?? 0}%</Badge>
            {quality && <Badge variant={confidenceVariant(quality.confidence) as any}>{quality.confidence} · {quality.score}/100</Badge>}
            {app && <Badge variant="outline">Status: {app.status}</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={generate} disabled={generating}>
            {generating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {g ? "Regenerate Packet" : "Generate Packet"}
          </Button>
          <Button variant="outline" onClick={exportPdf} disabled={!resume}><FileDown className="mr-2 h-4 w-4" />Export PDF</Button>
          <Button variant="outline" asChild disabled={!resume}><Link to="/resume-diff">Resume Diff</Link></Button>
          <Button variant="default" onClick={() => decide("approve")}><CheckCircle2 className="mr-2 h-4 w-4" />Approve</Button>
          <Button variant="outline" onClick={() => decide("save_for_later")}><Bookmark className="mr-2 h-4 w-4" />Save</Button>
          <Button variant="destructive" onClick={() => decide("reject")}><XCircle className="mr-2 h-4 w-4" />Reject</Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">Manual Review only · No auto-submit · No browser automation. Approving marks the application ready for you to submit by hand.</p>

      {/* Top row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Building2 className="h-4 w-4" />Company Overview</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="font-medium">{company?.name ?? job.company_name}</div>
            {company?.category && <Badge variant="outline">{company.category}</Badge>}
            {company?.funding_stage && <div className="text-muted-foreground">Stage: {company.funding_stage}</div>}
            <div className="text-muted-foreground">
              {company?.is_remote_first ? "Remote-first" : "Hybrid/onsite"}{company?.mba_friendly ? " · MBA-friendly" : ""}
            </div>
            {company?.careers_url && <a className="flex items-center gap-1 text-primary hover:underline" href={company.careers_url} target="_blank" rel="noopener noreferrer">Careers <ExternalLink className="h-3 w-3" /></a>}
            {company?.red_flags?.length > 0 && (
              <div className="text-xs text-destructive">Flags: {company.red_flags.slice(0,3).join(", ")}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Role Summary</CardTitle></CardHeader>
          <CardContent className="text-sm">
            <p className="line-clamp-6 text-muted-foreground">{job.description ?? "—"}</p>
            {job.source_url && <a href={job.source_url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-primary hover:underline">Original posting <ExternalLink className="h-3 w-3" /></a>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Application Quality</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {quality ? (
              <>
                <div className="text-3xl font-semibold">{quality.score}<span className="text-base text-muted-foreground">/100</span></div>
                <Badge variant={confidenceVariant(quality.confidence) as any}>{quality.confidence}</Badge>
                <Separator className="my-2" />
                <ul className="space-y-1 text-xs">
                  {Object.entries(quality.breakdown).map(([k, v]: any) => (
                    <li key={k} className="flex justify-between"><span className="capitalize text-muted-foreground">{k.replace(/_/g, " ")}</span><span>{v}</span></li>
                  ))}
                </ul>
                {g?.readiness_explanation && <p className="text-xs text-muted-foreground">{g.readiness_explanation}</p>}
              </>
            ) : (
              <p className="text-muted-foreground">Click <em>Generate Packet</em> to compute the quality score.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Resume + cover preview + prep tabs */}
      <Tabs defaultValue="resume">
        <TabsList>
          <TabsTrigger value="resume">Tailored Resume</TabsTrigger>
          <TabsTrigger value="cover">Cover Letter</TabsTrigger>
          <TabsTrigger value="why">Why This Company</TabsTrigger>
          <TabsTrigger value="interview">Interview Readiness</TabsTrigger>
          <TabsTrigger value="linkedin">LinkedIn & ATS</TabsTrigger>
        </TabsList>

        <TabsContent value="resume">
          <Card><CardContent className="space-y-3 pt-6 text-sm">
            {resume ? (
              <>
                <div><div className="font-medium">Summary</div><p className="text-muted-foreground">{resume.summary}</p></div>
                {resume.skills?.length > 0 && <div><div className="font-medium">Core Skills</div><p className="text-muted-foreground">{resume.skills.join(" · ")}</p></div>}
                {resume.bullets?.length > 0 && (
                  <div><div className="font-medium">Tailored Bullets</div>
                    <ul className="ml-5 list-disc space-y-1 text-muted-foreground">{resume.bullets.map((b: string, i: number) => <li key={i}>{b}</li>)}</ul>
                  </div>
                )}
                {resume.keywords?.length > 0 && <div><div className="font-medium">ATS Keywords</div><p className="text-xs text-muted-foreground">{resume.keywords.join(", ")}</p></div>}
                {g?.portfolio_project && <Badge variant="secondary">Portfolio: {g.portfolio_project}</Badge>}
              </>
            ) : <p className="text-muted-foreground">No resume yet. Generate the packet.</p>}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="cover">
          <Card><CardContent className="pt-6 text-sm">
            {cover?.body ? (
              <pre className="whitespace-pre-wrap font-sans text-muted-foreground">{cover.body}</pre>
            ) : <p className="text-muted-foreground">No cover letter yet.</p>}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="why">
          <Card><CardContent className="space-y-3 pt-6 text-sm">
            {prep?.why_company ? (
              <p className="text-muted-foreground">{prep.why_company}</p>
            ) : <p className="text-muted-foreground">Generate the packet to produce a tailored "why this company" narrative.</p>}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="interview">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card><CardHeader><CardTitle className="text-base">Talking Points</CardTitle></CardHeader>
              <CardContent className="text-sm">
                {prep?.talking_points?.length ? (
                  <ul className="ml-5 list-disc space-y-1 text-muted-foreground">{prep.talking_points.map((p: string, i: number) => <li key={i}>{p}</li>)}</ul>
                ) : <p className="text-muted-foreground">—</p>}
              </CardContent>
            </Card>
            <Card><CardHeader><CardTitle className="text-base">Recruiter Questions</CardTitle></CardHeader>
              <CardContent className="text-sm">
                {prep?.recruiter_questions?.length ? (
                  <ul className="ml-5 list-disc space-y-1 text-muted-foreground">{prep.recruiter_questions.map((p: string, i: number) => <li key={i}>{p}</li>)}</ul>
                ) : <p className="text-muted-foreground">—</p>}
              </CardContent>
            </Card>
            <Card><CardHeader><CardTitle className="text-base">Technical Questions</CardTitle></CardHeader>
              <CardContent className="text-sm">
                {prep?.technical_questions?.length ? (
                  <ul className="ml-5 list-disc space-y-1 text-muted-foreground">{prep.technical_questions.map((p: string, i: number) => <li key={i}>{p}</li>)}</ul>
                ) : <p className="text-muted-foreground">—</p>}
              </CardContent>
            </Card>
            <Card><CardHeader><CardTitle className="text-base">STAR Examples</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                {prep?.star_examples?.length ? prep.star_examples.map((s: any, i: number) => (
                  <div key={i} className="rounded border p-2">
                    <div className="font-medium">{s.question}</div>
                    <div className="text-xs text-muted-foreground"><b>S:</b> {s.situation}</div>
                    <div className="text-xs text-muted-foreground"><b>T:</b> {s.task}</div>
                    <div className="text-xs text-muted-foreground"><b>A:</b> {s.action}</div>
                    <div className="text-xs text-muted-foreground"><b>R:</b> {s.result}</div>
                  </div>
                )) : <p className="text-muted-foreground">—</p>}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="linkedin">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card><CardHeader><CardTitle className="text-base">LinkedIn Optimization</CardTitle></CardHeader>
              <CardContent className="text-sm">
                {prep?.linkedin_tips?.length ? (
                  <ul className="ml-5 list-disc space-y-1 text-muted-foreground">{prep.linkedin_tips.map((p: string, i: number) => <li key={i}>{p}</li>)}</ul>
                ) : <p className="text-muted-foreground">—</p>}
              </CardContent>
            </Card>
            <Card><CardHeader><CardTitle className="text-base">ATS Keyword Summary</CardTitle></CardHeader>
              <CardContent className="text-sm">
                <p className="text-muted-foreground">{prep?.ats_summary || g?.ats_summary || "Generate the packet to produce an ATS keyword summary."}</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
