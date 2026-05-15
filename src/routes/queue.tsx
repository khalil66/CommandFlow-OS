import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
import { MOCK_JOBS, SUPPORTED_ATS } from "@/lib/mock-data";
import { Search, Filter as FilterIcon, ExternalLink, CheckCircle2, Save, Package } from "lucide-react";
import { toast } from "sonner";
import { saveJob, getJobPacket } from "@/lib/jobs.functions";
import { upsertApplication } from "@/lib/applications.functions";

export const Route = createFileRoute("/queue")({ component: QueuePage });

function QueuePage() {
  const [q, setQ] = useState("");
  const [remoteOnly, setRemote] = useState(true);
  const [usOnly, setUs] = useState(true);
  const [noLogin, setNoLogin] = useState(true);
  const [noMfa, setNoMfa] = useState(true);
  const [noCaptcha, setNoCaptcha] = useState(true);
  const [excludeStaffing, setStaff] = useState(true);
  const [excludeCommission, setComm] = useState(true);
  const [excludeUnpaid, setUnpaid] = useState(true);
  const [salaryMin, setSalary] = useState([80]);
  const [matchMin, setMatch] = useState([60]);
  const [legitMin, setLegit] = useState([70]);
  const [ats, setAts] = useState("all");
  const [savedIds, setSavedIds] = useState<Record<string, string>>({});
  const saveJobFn = useServerFn(saveJob);
  const upsertAppFn = useServerFn(upsertApplication);
  const getPacketFn = useServerFn(getJobPacket);

  const handleSave = async (j: any) => {
    try {
      const { job } = await saveJobFn({ data: {
        title: j.title, company_name: j.company, location: j.location,
        remote: j.remote, salary_min: j.salaryMin, salary_max: j.salaryMax,
        ats: j.ats, source_url: j.url ?? null,
        resume_match: j.resumeMatch, legitimacy: j.legitimacy,
        final_score: j.finalScore, blockers: j.blockers ?? [],
      }});
      await upsertAppFn({ data: { job_id: job.id, status: "manual_review" } });
      setSavedIds(prev => ({ ...prev, [j.id]: job.id }));
      toast.success(`Saved ${j.company} to Manual Review`);
    } catch (e: any) { toast.error(e.message); }
  };

  const handleExport = async (j: any) => {
    const dbId = savedIds[j.id];
    if (!dbId) return toast.error("Save the job first");
    try {
      const packet = await getPacketFn({ data: { jobId: dbId } });
      const blob = new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `packet-${j.company.replace(/\W+/g,"-")}.json`;
      a.click(); URL.revokeObjectURL(url);
      toast.success("Application packet exported");
    } catch (e: any) { toast.error(e.message); }
  };


  const filtered = useMemo(() => {
    return MOCK_JOBS.filter(j => {
      if (q && !`${j.title} ${j.company}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (remoteOnly && !j.remote) return false;
      if (j.salaryMin < salaryMin[0] * 1000) return false;
      if (j.resumeMatch < matchMin[0]) return false;
      if (j.legitimacy < legitMin[0]) return false;
      if (ats !== "all" && j.ats !== ats) return false;
      if (noLogin && j.blockers.includes("Login required")) return false;
      if (noCaptcha && j.blockers.includes("CAPTCHA detected")) return false;
      return true;
    }).sort((a, b) => b.finalScore - a.finalScore);
  }, [q, remoteOnly, salaryMin, matchMin, legitMin, ats, noLogin, noCaptcha]);

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Job Search Queue</h1>
        <p className="text-sm text-muted-foreground mt-1">{filtered.length} of {MOCK_JOBS.length} jobs match your filters</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
        <Card className="h-fit lg:sticky lg:top-20">
          <CardContent className="p-5 space-y-5">
            <div className="flex items-center gap-2 font-medium text-sm">
              <FilterIcon className="h-4 w-4" /> Advanced filters
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Job title / company</Label>
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
                  <SelectItem value="all">All supported</SelectItem>
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

            <div className="space-y-2.5 pt-2 border-t border-border">
              {[
                ["Remote only", remoteOnly, setRemote],
                ["U.S.-based only", usOnly, setUs],
                ["No login required", noLogin, setNoLogin],
                ["No MFA", noMfa, setNoMfa],
                ["No CAPTCHA", noCaptcha, setNoCaptcha],
                ["Exclude staffing agencies", excludeStaffing, setStaff],
                ["Exclude commission-only", excludeCommission, setComm],
                ["Exclude unpaid roles", excludeUnpaid, setUnpaid],
              ].map(([label, val, set]: any) => (
                <div key={label} className="flex items-center justify-between">
                  <Label className="text-xs cursor-pointer">{label}</Label>
                  <Switch checked={val} onCheckedChange={set} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0 overflow-x-auto">
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
                      <div className="text-xs text-muted-foreground">{j.company} · {j.location}</div>
                    </TableCell>
                    <TableCell><span className="text-xs font-mono">{j.ats}</span></TableCell>
                    <TableCell className="text-xs tabular-nums">${(j.salaryMin/1000).toFixed(0)}–{(j.salaryMax/1000).toFixed(0)}k</TableCell>
                    <TableCell><ScoreBar value={j.resumeMatch} /></TableCell>
                    <TableCell><ScoreBar value={j.legitimacy} /></TableCell>
                    <TableCell><div className="text-lg font-semibold text-accent tabular-nums">{j.finalScore}</div></TableCell>
                    <TableCell><StatusBadge status={j.status} /></TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" title="Save to Manual Review" onClick={() => handleSave(j)} disabled={!!savedIds[j.id]}>
                          {savedIds[j.id] ? <CheckCircle2 className="h-3.5 w-3.5 text-accent" /> : <Save className="h-3.5 w-3.5" />}
                        </Button>
                        <Button size="sm" variant="ghost" title="Export Application Packet" onClick={() => handleExport(j)} disabled={!savedIds[j.id]}>
                          <Package className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" title="Open"><ExternalLink className="h-3.5 w-3.5" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
