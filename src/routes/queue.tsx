import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScoreBar, StatusBadge } from "@/components/score-bar";
import { SUPPORTED_ATS } from "@/lib/mock-data";
import { Search, Filter as FilterIcon, ExternalLink, CheckCircle2, Save, FileDown, Package, Loader2, Database, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { listJobs, getJobPacket } from "@/lib/jobs.functions";
import { upsertApplication, listApplications } from "@/lib/applications.functions";
import { seedSampleData } from "@/lib/seed.functions";
import { withRetry } from "@/lib/api-utils";
import { exportApplicationPdf } from "@/lib/pdf-export";

export const Route = createFileRoute("/queue")({ component: QueuePage });

function QueuePage() {
  const [q, setQ] = useState("");
  const [remoteOnly, setRemote] = useState(true);
  const [salaryMin, setSalary] = useState([70]);
  const [matchMin, setMatch] = useState([0]);
  const [legitMin, setLegit] = useState([0]);
  const [ats, setAts] = useState("all");
  const [jobs, setJobs] = useState<any[]>([]);
  const [appByJob, setAppByJob] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const listJobsFn = useServerFn(listJobs);
  const listAppsFn = useServerFn(listApplications);
  const upsertAppFn = useServerFn(upsertApplication);
  const getPacketFn = useServerFn(getJobPacket);
  const seedFn = useServerFn(seedSampleData);

  const refresh = async () => {
    setLoading(true); setError(null);
    try {
      const [j, a]: any = await Promise.all([
        withRetry(() => listJobsFn(), { label: "Load jobs", silent: true }),
        withRetry(() => listAppsFn(), { label: "Load apps", silent: true }),
      ]);
      setJobs(j.jobs); 
      const map: Record<string, string> = {};
      a.applications.forEach((app: any) => { map[app.job_id] = app.id; });
      setAppByJob(map);
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
      setAppByJob(p => ({ ...p, [j.id]: res.application.id }));
      toast.success(`Saved ${j.company_name} to Manual Review`);
    } catch (e: any) { toast.error(e.message); }
  };

  const handleExportPdf = async (j: any) => {
    try {
      const packet: any = await withRetry(() => getPacketFn({ data: { jobId: j.id } }), { label: "Build packet" });
      if (!packet.job) return toast.error("Job not found");
      exportApplicationPdf(packet, `${(j.company_name||"job").replace(/\W+/g,"-")}-${j.title.replace(/\W+/g,"-")}.pdf`);
      toast.success("PDF exported");
    } catch (e: any) { toast.error(e.message); }
  };

  const handleExportJson = async (j: any) => {
    try {
      const packet = await withRetry(() => getPacketFn({ data: { jobId: j.id } }), { label: "Build packet" });
      const blob = new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `packet-${(j.company_name||"job").replace(/\W+/g,"-")}.json`;
      a.click(); URL.revokeObjectURL(url);
      toast.success("JSON packet exported");
    } catch (e: any) { toast.error(e.message); }
  };

  const filtered = useMemo(() => {
    return jobs.filter(j => {
      if (q && !`${j.title} ${j.company_name}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (remoteOnly && !j.remote) return false;
      if ((j.salary_min ?? 0) < salaryMin[0] * 1000) return false;
      if ((j.resume_match ?? 0) < matchMin[0]) return false;
      if ((j.legitimacy ?? 0) < legitMin[0]) return false;
      if (ats !== "all" && j.ats !== ats) return false;
      return true;
    }).sort((a, b) => (b.final_score ?? 0) - (a.final_score ?? 0));
  }, [jobs, q, remoteOnly, salaryMin, matchMin, legitMin, ats]);

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Job Search Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {loading ? "Loading…" : `${filtered.length} of ${jobs.length} jobs match your filters`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleSeed} disabled={seeding}>
          {seeding ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Database className="h-3.5 w-3.5 mr-1.5" />}
          Seed sample data
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
        <Card className="h-fit lg:sticky lg:top-20">
          <CardContent className="p-5 space-y-5">
            <div className="flex items-center gap-2 font-medium text-sm">
              <FilterIcon className="h-4 w-4" /> Filters
            </div>
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
              <div className="flex justify-between text-xs"><Label>Salary minimum</Label><span className="font-mono">${salaryMin[0]}k</span></div>
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
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
            {loading ? (
              <div className="flex items-center justify-center py-20 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading jobs…</div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
                <AlertCircle className="h-8 w-8 text-destructive" />
                <p className="text-sm text-destructive">{error}</p>
                <Button size="sm" variant="outline" onClick={refresh}>Retry</Button>
              </div>
            ) : jobs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
                <Database className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No jobs in your queue yet.</p>
                <Button size="sm" onClick={handleSeed} disabled={seeding}>
                  {seeding ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                  Seed sample data
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Role</TableHead>
                    <TableHead>ATS</TableHead>
                    <TableHead>Salary</TableHead>
                    <TableHead>Match</TableHead>
                    <TableHead>Legit</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(j => (
                    <TableRow key={j.id} className="hover:bg-muted/40">
                      <TableCell>
                        <div className="font-medium text-sm">{j.title}</div>
                        <div className="text-xs text-muted-foreground">{j.company_name} · {j.location}</div>
                      </TableCell>
                      <TableCell><span className="text-xs font-mono">{j.ats}</span></TableCell>
                      <TableCell className="text-xs tabular-nums">${((j.salary_min??0)/1000).toFixed(0)}–{((j.salary_max??0)/1000).toFixed(0)}k</TableCell>
                      <TableCell><ScoreBar value={j.resume_match ?? 0} /></TableCell>
                      <TableCell><ScoreBar value={j.legitimacy ?? 0} /></TableCell>
                      <TableCell><div className="text-lg font-semibold text-accent tabular-nums">{j.final_score ?? 0}</div></TableCell>
                      <TableCell><StatusBadge status={appByJob[j.id] ? "Manual Review" : "Needs Review"} /></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" title="Save to Manual Review" onClick={() => handleSave(j)} disabled={!!appByJob[j.id]}>
                            {appByJob[j.id] ? <CheckCircle2 className="h-3.5 w-3.5 text-accent" /> : <Save className="h-3.5 w-3.5" />}
                          </Button>
                          <Button size="sm" variant="ghost" title="Export PDF Packet" onClick={() => handleExportPdf(j)}>
                            <FileDown className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" title="Export JSON Packet" onClick={() => handleExportJson(j)}>
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
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
