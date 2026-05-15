import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { getSettings, completeOnboarding } from "@/lib/settings.functions";
import { withRetry } from "@/lib/api-utils";
import { toast } from "sonner";
import { Loader2, ChevronRight, Check } from "lucide-react";

export const Route = createFileRoute("/onboarding")({ component: Onboarding });

const ROLE_CATEGORIES = [
  { id: "data", label: "Data Analyst" },
  { id: "operations", label: "Operations / Strategy" },
  { id: "customer_success", label: "Customer Success" },
  { id: "technical_support", label: "Technical Support" },
  { id: "product_pm", label: "Product / Project Mgmt" },
  { id: "saas", label: "SaaS / GTM" },
];

const SUGGESTED_ROLES = [
  "Data Analyst", "Technical Operations Specialist", "Customer Success Manager",
  "Project Manager", "Operations Analyst", "Technical Support Engineer", "SaaS Support Specialist",
];

const SUGGESTED_PREFERRED = [
  "Notion","Linear","Vercel","Stripe","Figma","Webflow","Replit","Posthog","Retool","Airtable",
];

function Onboarding() {
  const nav = useNavigate();
  const getFn = useServerFn(getSettings);
  const saveFn = useServerFn(completeOnboarding);

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("Khalil Hickson");
  const [location, setLocation] = useState("Jacksonville, FL");
  const [website, setWebsite] = useState("https://khalilhickson.com");
  const [linkedin, setLinkedin] = useState("https://www.linkedin.com/in/khalilhickson");
  const [roles, setRoles] = useState<string[]>(SUGGESTED_ROLES);
  const [cats, setCats] = useState<string[]>(["data","operations","customer_success","technical_support"]);
  const [salary, setSalary] = useState([55]);
  const [preferred, setPreferred] = useState<string[]>([]);
  const [resumeText] = useState(`Khalil Hickson — Data Analyst & Technical Operations Specialist
- 10,000+ Tier 2/3 support tickets analyzed (Zendesk + Salesforce)
- 25% reduction in escalations after triage redesign
- 91% CSAT sustained across 18 months
- 24-hour avg resolution; 92% SLA compliance
- 50,000+ customer transactions analyzed; $1.2M+ revenue analyzed
- 35% efficiency improvement from forecasting models; 92% forecast accuracy`);

  useEffect(() => {
    getFn().then((res: any) => {
      const s = res?.settings;
      if (s?.onboarded_at) {
        nav({ to: "/" });
        return;
      }
      if (s) {
        setName(s.full_name || name);
        setLocation(s.location || location);
        setWebsite(s.website || website);
        setLinkedin(s.linkedin_url || linkedin);
        if (Array.isArray(s.target_roles) && s.target_roles.length) setRoles(s.target_roles);
        if (Array.isArray(s.role_categories) && s.role_categories.length) setCats(s.role_categories);
        if (s.salary_min) setSalary([Math.round(s.salary_min / 1000)]);
        if (Array.isArray(s.excluded_companies)) {/* leave preferred separate */}
      }
    }).finally(() => setLoading(false));
  }, []);

  const toggle = (arr: string[], setArr: (a: string[]) => void, v: string) =>
    setArr(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);

  const next = () => setStep(s => Math.min(3, s + 1));
  const back = () => setStep(s => Math.max(0, s - 1));

  const finish = async () => {
    setBusy(true);
    try {
      await withRetry(() => saveFn({ data: {
        full_name: name,
        location,
        website,
        linkedin_url: linkedin,
        target_roles: roles,
        role_categories: cats,
        salary_min: salary[0] * 1000,
        preferred_companies: preferred,
      } }), { label: "Save onboarding" });
      toast.success("Onboarding complete");
      nav({ to: "/" });
    } catch {} finally { setBusy(false); }
  };

  if (loading) return <div className="flex items-center justify-center py-32 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" />Loading…</div>;

  const steps = ["Profile", "Resume context", "Targets", "Salary & companies"];

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to Apply Command</h1>
        <p className="text-sm text-muted-foreground mt-1">Let's set up your job-search engine. Manual Review mode stays on — no auto-submit.</p>
      </div>

      <div className="flex items-center gap-2 text-xs">
        {steps.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${i === step ? "border-accent bg-accent/10 text-accent" : i < step ? "border-success/30 bg-success/10 text-success" : "border-border text-muted-foreground"}`}>
              {i < step ? <Check className="h-3 w-3" /> : <span className="font-mono">{i+1}</span>}
              <span>{s}</span>
            </div>
            {i < steps.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          </div>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">{steps[step]}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {step === 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Full name" value={name} onChange={setName} />
              <Field label="Location" value={location} onChange={setLocation} />
              <Field label="Personal website" value={website} onChange={setWebsite} placeholder="https://" />
              <Field label="LinkedIn URL" value={linkedin} onChange={setLinkedin} placeholder="https://linkedin.com/in/…" />
            </div>
          )}
          {step === 1 && (
            <div className="space-y-3">
              <Label className="text-xs">Resume highlights (used by AI tailoring — pre-filled with your verified proof points)</Label>
              <Textarea value={resumeText} readOnly rows={10} className="font-mono text-xs" />
              <p className="text-xs text-muted-foreground">These proof points anchor every generated resume so the AI never invents experience.</p>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <Label className="text-xs">Role categories (drives scoring + tailoring)</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {ROLE_CATEGORIES.map(r => (
                    <Badge key={r.id} variant={cats.includes(r.id) ? "default" : "outline"} className="cursor-pointer" onClick={() => toggle(cats, setCats, r.id)}>
                      {r.label}
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs">Target roles (job titles you want)</Label>
                <Textarea
                  rows={3}
                  value={roles.join(", ")}
                  onChange={(e) => setRoles(e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
                  className="text-sm mt-2"
                />
              </div>
            </div>
          )}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <div className="flex items-center justify-between text-sm">
                  <Label>Salary floor</Label>
                  <span className="font-mono tabular-nums">${salary[0]}K</span>
                </div>
                <Slider value={salary} onValueChange={setSalary} min={40} max={200} step={5} className="mt-3" />
                <p className="text-xs text-muted-foreground mt-2">Roles below this floor are sent to Manual Review or rejected.</p>
              </div>
              <div>
                <Label className="text-xs">Preferred companies (optional — bumps priority)</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {SUGGESTED_PREFERRED.map(c => (
                    <Badge key={c} variant={preferred.includes(c) ? "default" : "outline"} className="cursor-pointer" onClick={() => toggle(preferred, setPreferred, c)}>
                      {c}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={back} disabled={step === 0 || busy}>Back</Button>
        {step < 3 ? (
          <Button onClick={next}>Continue</Button>
        ) : (
          <Button onClick={finish} disabled={busy} className="bg-accent text-accent-foreground hover:bg-accent/90">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Finish setup"}
          </Button>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: any) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}
