import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles, Copy, Gauge } from "lucide-react";
import { toast } from "sonner";
import { ScoreBar } from "@/components/score-bar";
import { tailorResume } from "@/lib/resume.functions";
import { getUsageToday } from "@/lib/usage.functions";

export const Route = createFileRoute("/resume")({ component: ResumeStudio });

function ResumeStudio() {
  const [title, setTitle] = useState("Senior Data Analyst");
  const [company, setCompany] = useState("Linear");
  const [jd, setJd] = useState("");
  const [category, setCategory] = useState("data-analyst");
  const [out, setOut] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [usage, setUsage] = useState<any>(null);
  const tailor = useServerFn(tailorResume);
  const usageFn = useServerFn(getUsageToday);

  const refreshUsage = () => usageFn().then(setUsage).catch(() => {});
  useEffect(() => { refreshUsage(); }, []);

  const generate = async () => {
    if (jd.trim().length < 20) return toast.error("Paste the job description first");
    setLoading(true);
    try {
      const result = await tailor({ data: { title, company, category, job_description: jd, save: true } });
      setOut(result);
      toast.success("Tailored resume generated and saved");
      refreshUsage();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to generate");
      refreshUsage();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-[1500px] mx-auto">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Resume Tailoring Studio</h1>
          <p className="text-sm text-muted-foreground mt-1">AI tailors Khalil's master resume to each job description.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/resume-diff" search={{ resume_id: undefined, variant_key: undefined }} className="text-xs px-3 py-1.5 rounded-md border border-border bg-card hover:bg-muted/40 inline-flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-accent" /> Compare versions (Diff)
          </Link>
          {usage && (
            <div className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-md border border-border bg-card">
              <Gauge className="h-3.5 w-3.5 text-accent" />
              <span className="font-medium tabular-nums">{usage.resume_remaining}</span>
              <span className="text-muted-foreground">of {usage.resume_cap} generations left today</span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Job inputs</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Job title</Label>
                <Input value={title} onChange={e => setTitle(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Company</Label>
                <Input value={company} onChange={e => setCompany(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Target role category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="data-analyst">Data Analyst</SelectItem>
                  <SelectItem value="tech-ops">Technical Operations</SelectItem>
                  <SelectItem value="csm">Customer Success</SelectItem>
                  <SelectItem value="pm">Project Manager</SelectItem>
                  <SelectItem value="support">Technical Support</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Job description</Label>
              <Textarea value={jd} onChange={e => setJd(e.target.value)} rows={10} placeholder="Paste full JD here…" />
            </div>
            <Button onClick={generate} disabled={loading} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
              <Sparkles className="h-4 w-4 mr-1.5" /> {loading ? "Generating…" : "Generate tailored resume"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Tailored output</CardTitle>
            {out && <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">Match</span><ScoreBar value={out.matchScore} /></div>}
          </CardHeader>
          <CardContent>
            {!out ? (
              <div className="text-sm text-muted-foreground py-12 text-center border border-dashed rounded-md">
                Fill the inputs and click Generate to see a fully tailored resume.
              </div>
            ) : (
              <Tabs defaultValue="summary">
                <TabsList className="grid grid-cols-5 w-full">
                  <TabsTrigger value="summary">Summary</TabsTrigger>
                  <TabsTrigger value="skills">Skills</TabsTrigger>
                  <TabsTrigger value="bullets">Bullets</TabsTrigger>
                  <TabsTrigger value="keywords">Keywords</TabsTrigger>
                  <TabsTrigger value="cover">Cover</TabsTrigger>
                </TabsList>
                <TabsContent value="summary" className="mt-4 space-y-2">
                  <SectionWithCopy text={out.summary}>
                    <p className="text-sm leading-relaxed">{out.summary}</p>
                  </SectionWithCopy>
                </TabsContent>
                <TabsContent value="skills" className="mt-4">
                  <SectionWithCopy text={out.skills.join(", ")}>
                    <div className="flex flex-wrap gap-1.5">
                      {out.skills.map((s: string) => <span key={s} className="text-xs px-2 py-1 rounded bg-secondary border border-border">{s}</span>)}
                    </div>
                  </SectionWithCopy>
                </TabsContent>
                <TabsContent value="bullets" className="mt-4">
                  <SectionWithCopy text={out.bullets.map((b:string)=>"• "+b).join("\n")}>
                    <ul className="space-y-2 text-sm leading-relaxed">
                      {out.bullets.map((b: string, i: number) => <li key={i} className="flex gap-2"><span className="text-accent">▸</span><span>{b}</span></li>)}
                    </ul>
                  </SectionWithCopy>
                </TabsContent>
                <TabsContent value="keywords" className="mt-4">
                  <SectionWithCopy text={out.keywords.join(", ")}>
                    <div className="flex flex-wrap gap-1.5">
                      {out.keywords.map((k: string) => <span key={k} className="text-xs font-mono px-2 py-1 rounded bg-accent/10 text-accent-foreground border border-accent/20">{k}</span>)}
                    </div>
                  </SectionWithCopy>
                </TabsContent>
                <TabsContent value="cover" className="mt-4">
                  <SectionWithCopy text={out.cover}>
                    <div className="text-sm leading-relaxed whitespace-pre-line">{out.cover}</div>
                  </SectionWithCopy>
                </TabsContent>
              </Tabs>
            )}
            {out && (
              <div className="mt-4 p-3 rounded-md bg-muted text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Why this scored {out.matchScore}: </span>{out.explanation}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SectionWithCopy({ children, text }: { children: React.ReactNode; text: string }) {
  return (
    <div className="relative group">
      <Button size="sm" variant="ghost" className="absolute top-0 right-0 opacity-0 group-hover:opacity-100" onClick={() => { navigator.clipboard.writeText(text); toast.success("Copied"); }}>
        <Copy className="h-3 w-3" />
      </Button>
      {children}
    </div>
  );
}

