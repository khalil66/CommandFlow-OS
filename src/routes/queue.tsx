import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScoreBar } from "@/components/score-bar";
import { SUPPORTED_ATS } from "@/lib/mock-data";
import {
  Search, Filter as FilterIcon, ExternalLink, CheckCircle2, Save, FileDown,
  Package, Loader2, Database, AlertCircle, Sparkles, Calendar, Briefcase,
} from "lucide-react";
import { toast } from "sonner";
import { listJobs, getJobPacket } from "@/lib/jobs.functions";
import { upsertApplication, listApplications } from "@/lib/applications.functions";
import { listHighProbabilityJobs, listDailyBatchQueue } from "@/lib/engine.functions";
import { seedSampleData } from "@/lib/seed.functions";
import { withRetry } from "@/lib/api-utils";
import { exportApplicationPdf } from "@/lib/pdf-export";
import { projectsForRole } from "@/lib/portfolio";

export const Route = createFileRoute("/queue")({ component: QueuePage });

function QueuePage() {
  const [tab, setTab] = useState("high");
  const [q, setQ] = useState("");
  const [remoteOnly, setRemote] = useState(true);
  const [salaryMin, setSalary] = useState([55]);
  const [matchMin, setMatch] = useState([0]);
  const [legitMin, setLegit] = useState([0]);
  const [ats, setAts] = useState("all");
  const [allJobs, setAllJobs] = useState<any[]>([]);
  const [highJobs, setHighJobs] = useState<any[]>([]);
  const [batchJobs, setBatchJobs] = useState<any[]>([]);
  const [batchDate, setBatchDate] = useState<string>("");
  const [appByJob, setAppByJob] = useState<Record<string, any>>({});
  const [resumeByJob, setResumeByJob] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const listJobsFn = useServerFn(listJobs);
  const listAppsFn = useServerFn(listApplications);
  const upsertAppFn = useServerFn(upsertApplication);
  const getPacketFn = useServerFn(getJobPacket);
  const seedFn = useServerFn(seedSampleData);
  const highFn = useServerFn(listHighProbabilityJobs);
  const batchFn = useServerFn(listDailyBatchQueue);

  const refresh = async () => {
    setLoading(true); setError(null);
    try {
      const [j, a, h, b]: any = await Promise.all([
        withRetry(() => listJobsFn(), { label: "Jobs", silent: true }),
        withRetry(() => listAppsFn(), { label: "Apps", silent: true }),
        withRetry(() => highFn(), { label: "High", silent: true }).catch(() => ({ jobs: [] })),
        withRetry(() => batchFn(), { label: "Batch", silent: true }).catch(() => ({ jobs: [], date: "" })),
      ]);
      setAllJobs(j.jobs); setHighJobs(h.jobs); setBatchJobs(b.jobs); setBatchDate(b.date);
      const map: Record<string, any> = {};
      const rmap: Record<string, any> = {};
      a.applications.forEach((app: any) => {
        map[app.job_id] = app;
        if (app.resume_version_id) rmap[app.job_id] = app.resume_version_id;
      });
      setAppByJob(map); setResumeByJob(rmap);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, []);

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const res: any = await withRetry(() => seedFn(), { label: "Seed sample data" });
      toast.success(`Seeded ${res.jobs} jobs, ${res.companies} companies, ${res.resumes} resumes, ${res.applications} apps`);
      await refresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setSeeding(false); }
  };

  const handleSave = async (j: any) => {
    try {
      const res: any = await withRetry(() => upsertAppFn({ data: { job_id: j.id, status: "manual_review" } }), { label: "Save application", silent: true });
      setAppByJob(p => ({ ...p, [j.id]: res.application }));
      toast.success(`Saved ${j.company_name} to Manual Review`);
    } catch (e: any) { toast.error(e.message); }
  };

  const handleExportPdf = async (j: any) => {
    try {
      const packet: any = await withRetry(() => getPacketFn({ data: { jobId: j.id } }), { label: "Build packet" });
      if (!packet.job) return toast.error("Job not found");
      exportApplicationPdf(packet, `${(j.company_name || "job").replace(/\W+/g, "-")}-${j.title.replace(/\W+/g, "-")}.pdf`);
      toast.success("PDF exported");
    } catch (e: any) { toast.error(e.message); }
  };

  const handleExportJson = async (j: any) => {
    try {
      const packet = await withRetry(() => getPacketFn({ data: { jobId: j.id } }), { label: "Build packet" });
      const blob = new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `packet-${(j.company_name || "job").replace(/\W+/g, "-")}.json`;
      a.click(); URL.revokeObjectURL(url);
      toast.success("JSON packet exported");
    } catch (e: any) { toast.error(e.message); }
  };

  const filtered = useMemo(() => {
    return allJobs.filter(j => {
      if (q && !`${j.title} ${j.company_name}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (remoteOnly && !j.remote) return false;
      if ((j.salary_min ?? 0) < salaryMin[0] * 1000) return false;
      if ((j.resume_match ?? 0) < matchMin[0]) return false;
      if ((j.legitimacy ?? 0) < legitMin[0]) return false;
      if (ats !== "all" && j.ats !== ats) return false;
      return true;
    }).sort((a, b) => (b.final_score ?? 0) - (a.final_score ?? 0));
  }, [allJobs, q, remoteOnly, salaryMin, matchMin, legitMin, ats]);

  return (
    <div className="p-6 space-y-6 max-w-[1700px] mx-auto">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Job Search Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manual Review only · Browser automation disabled
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleSeed} disabled={seeding}>
          {seeding ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Database className="h-3.5 w-3.5 mr-1.5" />}
          Seed sample data
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full max-w-2xl grid-cols-3">
          <TabsTrigger value="high"><Sparkles className="h-3.5 w-3.5 mr-1.5" /> High-Probability ({highJobs.length})</TabsTrigger>
          <TabsTrigger value="all"><Briefcase className="h-3.5 w-3.5 mr-1.5" /> All Jobs ({allJobs.length})</TabsTrigger>
          <TabsTrigger value="batch"><Calendar className="h-3.5 w-3.5 mr-1.5" /> Daily Batch ({batchJobs.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="high" className="mt-4">
          <RichJobTable
            loading={loading} error={error} jobs={highJobs} appByJob={appByJob} resumeByJob={resumeByJob}
            onSave={handleSave} onExportPdf={handleExportPdf} onExportJson={handleExportJson}
            emptyHint="No high-probability jobs yet. Run today's batch from the dashboard."
            onRetry={refresh}
          />
        </TabsContent>

        <TabsContent value="all" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
            <Card className="h-fit lg:sticky lg:top-20">
              <CardContent className="p-5 space-y-5">
                <div className="flex items-center gap-2 font-medium text-sm"><FilterIcon className="h-4 w-4" /> Filters</div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Search</Label>
                  <div className="relative">
                    <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                    <Input value={q} onChange={e => setQ(e.target.value)} className="pl-8" placeholder="Data Analyst…" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">ATS platform</Label>
                  <Select value={ats} onValueChange={setAts}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {SUPPORTED_ATS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs"><Label>Salary min</Label><span className="font-mono">${salaryMin[0]}k</span></div>
                  <Slider value={salaryMin} onValueChange={setSalary} min={50} max={200} step={5} />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs"><Label>Resume match</Label><span className="font-mono">{matchMin[0]}+</span></div>
                  <Slider value={matchMin} onValueChange={setMatch} min={0} max={100} step={5} />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs"><Label>Legitimacy</Label><span className="font-mono">{legitMin[0]}+</span></div>
                  <Slider value={legitMin} onValueChange={setLegit} min={0} max={100} step={5} />
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <Label className="text-xs cursor-pointer">Remote only</Label>
                  <Switch checked={remoteOnly} onCheckedChange={setRemote} />
                </div>
                <p className="text-xs text-muted-foreground">{filtered.length} of {allJobs.length} match</p>
              </CardContent>
            </Card>
            <RichJobTable
              loading={loading} error={error} jobs={filtered} appByJob={appByJob} resumeByJob={resumeByJob}
              onSave={handleSave} onExportPdf={handleExportPdf} onExportJson={handleExportJson}
              onRetry={refresh}
              emptyHint={allJobs.length === 0 ? "No jobs yet. Seed sample data to begin." : "No jobs match your filters."}
              showSeed={allJobs.length === 0} onSeed={handleSeed} seeding={seeding}
            />
          </div>
        </TabsContent>

        <TabsContent value="batch" className="mt-4">
          {batchDate && (
            <p className="text-xs text-muted-foreground mb-3">Showing jobs prepared on <span className="font-medium text-foreground">{batchDate}</span></p>
          )}
          <RichJobTable
            loading={loading} error={error} jobs={batchJobs} appByJob={appByJob} resumeByJob={resumeByJob}
            onSave={handleSave} onExportPdf={handleExportPdf} onExportJson={handleExportJson}
            emptyHint="No jobs prepared today yet. Click 'Run Today's Batch' on the dashboard."
            onRetry={refresh}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RichJobTable({
  loading, error, jobs, appByJob, resumeByJob, onSave, onExportPdf, onExportJson,
  emptyHint, onRetry, showSeed, onSeed, seeding,
}: any) {
  if (loading) return <Card><CardContent className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…</CardContent></Card>;
  if (error) return <Card><CardContent className="flex flex-col items-center justify-center py-20 gap-3"><AlertCircle className="h-8 w-8 text-destructive" /><p className="text-sm text-destructive">{error}</p><Button size="sm" variant="outline" onClick={onRetry}>Retry</Button></CardContent></Card>;
  if (jobs.length === 0) {
    return (
      <Card><CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-center">
        <Database className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{emptyHint}</p>
        {showSeed && <Button size="sm" onClick={onSeed} disabled={seeding}>{seeding ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}Seed sample data</Button>}
      </CardContent></Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company / Role</TableHead>
              <TableHead>ATS</TableHead>
              <TableHead>Trust</TableHead>
              <TableHead>Interview</TableHead>
              <TableHead>Salary</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead>Portfolio</TableHead>
              <TableHead>Resume</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Verification</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((j: any) => {
              const co = j.companies ?? {};
              const trust = co.trust_score ?? j.legitimacy ?? 0;
              const verification = co.verification_status ?? "manual_review";
              const portfolio = projectsForRole(j.role_category ?? j.title)[0];
              const app = appByJob[j.id];
              return (
                <TableRow key={j.id} className="hover:bg-muted/40">
                  <TableCell>
                    <div className="font-medium text-sm">{j.company_name}</div>
                    <div className="text-xs text-muted-foreground">{j.title}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {j.remote ? "Remote" : j.location} {co.is_remote_first ? "· remote-first" : ""}
                    </div>
                  </TableCell>
                  <TableCell><span className="text-xs font-mono">{j.ats}</span></TableCell>
                  <TableCell><Badge variant="outline" className={trust >= 90 ? "border-success/40 text-success" : trust >= 70 ? "border-warning/40 text-warning-foreground" : "border-destructive/40 text-destructive"}>{trust}</Badge></TableCell>
                  <TableCell>
                    <div className="text-base font-semibold tabular-nums text-accent">{j.interview_probability ?? j.final_score ?? 0}</div>
                    <ScoreBar value={j.interview_probability ?? j.final_score ?? 0} />
                  </TableCell>
                  <TableCell className="text-xs tabular-nums whitespace-nowrap">${((j.salary_min ?? 0) / 1000).toFixed(0)}–{((j.salary_max ?? 0) / 1000).toFixed(0)}k</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1 max-w-[180px]">
                      {co.mba_friendly && <Badge variant="secondary" className="text-[10px]">MBA-friendly</Badge>}
                      {co.funding_stage && <Badge variant="secondary" className="text-[10px]">{co.funding_stage}</Badge>}
                      {co.category && <Badge variant="outline" className="text-[10px]">{String(co.category).replace(/_/g, " ")}</Badge>}
                    </div>
                  </TableCell>
                  <TableCell><span className="text-xs">{portfolio ?? "—"}</span></TableCell>
                  <TableCell>
                    {resumeByJob[j.id] ? <Badge variant="outline" className="text-[10px]">Tailored</Badge> : <span className="text-[10px] text-muted-foreground">none</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] capitalize">{app?.priority ?? "manual"}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={verification === "verified" ? "border-success/40 text-success text-[10px]" : verification === "rejected" ? "border-destructive/40 text-destructive text-[10px]" : "border-warning/40 text-warning-foreground text-[10px]"}>
                      {String(verification).replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" title="Save to Manual Review" onClick={() => onSave(j)} disabled={!!app}>
                        {app ? <CheckCircle2 className="h-3.5 w-3.5 text-accent" /> : <Save className="h-3.5 w-3.5" />}
                      </Button>
                      <Button size="sm" variant="ghost" title="Export PDF Packet" onClick={() => onExportPdf(j)}>
                        <FileDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" title="Export JSON Packet" onClick={() => onExportJson(j)}>
                        <Package className="h-3.5 w-3.5" />
                      </Button>
                      {j.source_url && (
                        <Button size="sm" variant="ghost" title="Open" asChild>
                          <a href={j.source_url} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
