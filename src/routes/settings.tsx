import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getUsageAnalytics, getUsageToday } from "@/lib/usage.functions";
import { Gauge, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/settings")({ component: Settings });

function Settings() {
  const [autoApply, setAutoApply] = useState(false);
  const [trustThreshold, setTrust] = useState([90]);
  const [dailyCap, setCap] = useState([25]);
  const [usage, setUsage] = useState<any>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const usageFn = useServerFn(getUsageToday);
  const analyticsFn = useServerFn(getUsageAnalytics);

  useEffect(() => {
    usageFn().then(setUsage).catch(() => {});
    analyticsFn().then(setAnalytics).catch(() => {});
  }, []);

  return (
    <div className="p-6 space-y-6 max-w-[900px] mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Profile, automation, and integrations.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Profile</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <Field label="Full name" defaultValue="Khalil Hickson" />
          <Field label="Location" defaultValue="Jacksonville, FL" />
          <Field label="Website" defaultValue="khalilhickson.com" />
          <Field label="Email" defaultValue="khalil@khalilhickson.com" />
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs">Target roles</Label>
            <Textarea rows={3} defaultValue="Data Analyst, Technical Operations Specialist, Customer Success Manager, Project Manager, Operations Analyst, Technical Support Engineer, SaaS Support Specialist" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Automation</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <Toggle label="Auto-apply when trust score ≥ threshold" desc="Otherwise applications wait for your approval" checked={autoApply} onChange={setAutoApply} />
          <div className="space-y-2">
            <div className="flex justify-between text-sm"><Label>Trust score threshold</Label><span className="font-mono">{trustThreshold[0]}</span></div>
            <Slider value={trustThreshold} onValueChange={setTrust} min={70} max={100} step={1} />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm"><Label>Daily application cap</Label><span className="font-mono">{dailyCap[0]}</span></div>
            <Slider value={dailyCap} onValueChange={setCap} min={5} max={50} step={1} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Integrations</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Integration name="Supabase" desc="Application database & auth" status="Not connected" />
          <Integration name="OpenAI API" desc="Resume tailoring, JD matching, scoring" status="Not connected" />
          <Integration name="Browserbase / Playwright" desc="Headless browser automation for ATS submission" status="Not connected" />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button className="bg-accent text-accent-foreground hover:bg-accent/90" onClick={() => toast.success("Settings saved")}>Save changes</Button>
      </div>
    </div>
  );
}

function Field({ label, defaultValue }: { label: string; defaultValue: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input defaultValue={defaultValue} />
    </div>
  );
}
function Toggle({ label, desc, checked, onChange }: any) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <Label className="text-sm">{label}</Label>
        <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
function Integration({ name, desc, status }: any) {
  return (
    <div className="flex items-center justify-between p-3 rounded-md border border-border">
      <div>
        <div className="font-medium text-sm">{name}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">{status}</span>
        <Button size="sm" variant="outline">Connect</Button>
      </div>
    </div>
  );
}
