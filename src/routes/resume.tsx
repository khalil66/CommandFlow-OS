import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles, Copy } from "lucide-react";
import { toast } from "sonner";
import { ScoreBar } from "@/components/score-bar";
import { tailorResume } from "@/lib/resume.functions";

export const Route = createFileRoute("/resume")({ component: ResumeStudio });

function ResumeStudio() {
  const [title, setTitle] = useState("Senior Data Analyst");
  const [company, setCompany] = useState("Linear");
  const [jd, setJd] = useState("");
  const [category, setCategory] = useState("data-analyst");
  const [out, setOut] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const tailor = useServerFn(tailorResume);

  const generate = async () => {
    if (jd.trim().length < 20) return toast.error("Paste the job description first");
    setLoading(true);
    try {
      const result = await tailor({ data: { title, company, category, job_description: jd, save: true } });
      setOut(result);
      toast.success("Tailored resume generated and saved");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to generate");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-[1500px] mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Resume Tailoring Studio</h1>
        <p className="text-sm text-muted-foreground mt-1">AI tailors Khalil's master resume to each job description.</p>
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

function buildOutput(title: string, company: string, _category: string) {
  return {
    matchScore: 88,
    summary: `Data Analyst & Technical Operations Specialist with 5+ years analyzing 10,000+ Tier 2/3 support cases to drive measurable business outcomes. Reduced escalations 25% and sustained 91% CSAT by building SQL-driven KPI dashboards in Tableau and forecasting models that informed staffing, SLA strategy, and customer revenue analysis. Seeking to bring operational rigor and analytical depth to ${title} at ${company}.`,
    skills: ["SQL", "Tableau", "Excel (advanced)", "Salesforce", "Zendesk", "Data Analysis", "KPI Optimization", "Forecasting", "Operations Strategy", "Stakeholder Reporting", "Process Automation"],
    bullets: [
      `Analyzed 10,000+ Tier 2/3 support tickets in SQL to identify root-cause patterns, reducing escalations by 25% over two quarters.`,
      `Built executive Tableau dashboards tracking CSAT, FRT, and resolution velocity that drove a sustained 91% CSAT across 18 months.`,
      `Designed forecasting models in Excel and SQL that improved fulfillment efficiency by 35%, informing weekly staffing and capacity decisions.`,
      `Partnered with Customer Success and Revenue Operations to surface at-risk accounts, enabling proactive saves on six-figure ARR.`,
      `Standardized Zendesk + Salesforce reporting pipelines, cutting weekly reporting prep from 6 hours to 45 minutes.`,
      `Translated operational data into clear narratives for non-technical leaders, accelerating decision cycles on hiring and tooling.`,
      `Documented analytical playbooks and trained two junior analysts, raising team self-service reporting adoption above 80%.`,
    ],
    keywords: ["SQL", "Tableau", "KPI dashboards", "forecasting", "CSAT", "Zendesk", "Salesforce", "operations analyst", "ticket analysis", "customer success", "process improvement", "data-driven decisions"],
    cover: `Hi ${company} team,\n\nThe ${title} role caught my attention because it sits exactly at the intersection of analysis and operational impact — which is where I do my best work. At my last role I analyzed over 10,000 Tier 2/3 support cases, built the Tableau and SQL dashboards leadership used weekly, and shipped forecasting models that lifted fulfillment efficiency by 35% while reducing escalations 25% and holding CSAT at 91%.\n\nI'd love to bring that combination of rigor, clarity, and customer empathy to ${company}. Happy to share dashboards or walk through a recent forecasting project on a quick call.\n\nBest,\nKhalil Hickson\nkhalilhickson.com · Jacksonville, FL`,
    explanation: `Strong overlap on SQL, Tableau, KPI dashboards, and forecasting (primary JD requirements). Quantified outcomes (25%, 91%, 35%) align to the impact-driven language in the description. Minor gap: leadership scope language can be reinforced if JD emphasizes management.`,
  };
}
