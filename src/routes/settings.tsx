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
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Gauge className="h-4 w-4 text-accent" /> AI Usage (today)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!usage ? <p className="text-sm text-muted-foreground">Loading…</p> : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="flex justify-between text-xs mb-1.5"><span>Resume generations</span><span className="font-mono tabular-nums">{usage.daily_resume_generations}/{usage.resume_cap}</span></div>
                  <Progress value={(usage.daily_resume_generations / usage.resume_cap) * 100} />
                  <div className="text-[11px] text-muted-foreground mt-1">{usage.resume_remaining} remaining today</div>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1.5"><span>Cover letters</span><span className="font-mono tabular-nums">{usage.daily_cover_letter_generations}/{usage.cover_cap}</span></div>
                  <Progress value={(usage.daily_cover_letter_generations / usage.cover_cap) * 100} />
                  <div className="text-[11px] text-muted-foreground mt-1">{usage.cover_remaining} remaining today</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 pt-2 border-t border-border">
                <Stat label="Generations today" value={analytics?.generations_today ?? 0} />
                <Stat label="Estimated cost" value={`$${(((analytics?.estimated_cost_cents ?? 0) / 100)).toFixed(4)}`} />
                <Stat label="Failed today" value={analytics?.failed_today ?? 0} accent={analytics?.failed_today > 0 ? "text-destructive" : ""} />
              </div>
              {analytics?.best_resumes?.length > 0 && (
                <div>
                  <div className="text-xs font-medium mb-2">Best-performing resume outputs</div>
                  <div className="space-y-1.5">
                    {analytics.best_resumes.slice(0, 3).map((r: any) => (
                      <div key={r.id} className="flex justify-between text-xs p-2 rounded bg-muted">
                        <span className="truncate">{r.label ?? r.target_role ?? "Untitled"}</span>
                        <span className="font-mono tabular-nums text-accent">{r.match_score}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {analytics?.recent_failures?.length > 0 && (
                <div>
                  <div className="text-xs font-medium mb-2 flex items-center gap-1.5"><AlertCircle className="h-3 w-3 text-destructive" /> Recent failures</div>
                  <div className="space-y-1">
                    {analytics.recent_failures.slice(0, 3).map((f: any, i: number) => (
                      <div key={i} className="text-[11px] text-muted-foreground p-2 rounded bg-destructive/5 border border-destructive/20 truncate">
                        {new Date(f.created_at).toLocaleString()} — {f.error?.slice(0, 100)}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
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
function Stat({ label, value, accent }: { label: string; value: any; accent?: string }) {
  return (
    <div className="text-center p-2 rounded bg-muted">
      <div className={`text-lg font-semibold tabular-nums ${accent ?? ""}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
    </div>
  );
}
