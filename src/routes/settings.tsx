import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getUsageAnalytics, getUsageToday } from "@/lib/usage.functions";
import { getSettings, updateSettings } from "@/lib/settings.functions";
import { withRetry } from "@/lib/api-utils";
import { Gauge, AlertCircle, ShieldCheck, Loader2 } from "lucide-react";

export const Route = createFileRoute("/settings")({ component: Settings });

const ROLE_CATEGORY_OPTS = ["data","operations","customer_success","technical_support","product_pm","saas","other"];
const ATS_OPTS = ["greenhouse","lever","ashby","breezy","workday","taleo","sap","icims","other"];

function Settings() {
  const usageFn = useServerFn(getUsageToday);
  const analyticsFn = useServerFn(getUsageAnalytics);
  const getFn = useServerFn(getSettings);
  const saveFn = useServerFn(updateSettings);

  const [usage, setUsage] = useState<any>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [s, setS] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      usageFn().catch(() => null),
      analyticsFn().catch(() => null),
      getFn().catch(() => null),
    ]).then(([u, a, st]: any) => {
      setUsage(u); setAnalytics(a);
      setS(st?.settings ?? {});
      setLoading(false);
    });
  }, []);

  const set = (k: string, v: any) => setS((prev: any) => ({ ...prev, [k]: v }));
  const toggleArr = (key: string, v: string) => {
    const arr: string[] = s?.[key] ?? [];
    set(key, arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  };

  const save = async () => {
    setSaving(true);
    try {
      await withRetry(() => saveFn({ data: {
        full_name: s.full_name ?? undefined,
        location: s.location ?? undefined,
        website: s.website ?? undefined,
        linkedin_url: s.linkedin_url ?? undefined,
        target_roles: s.target_roles ?? undefined,
        role_categories: s.role_categories ?? undefined,
        excluded_companies: s.excluded_companies ?? undefined,
        excluded_ats: s.excluded_ats ?? undefined,
        salary_min: typeof s.salary_min === "number" ? s.salary_min : undefined,
        remote_only: typeof s.remote_only === "boolean" ? s.remote_only : undefined,
        daily_cap: typeof s.daily_cap === "number" ? s.daily_cap : undefined,
        trust_threshold: typeof s.trust_threshold === "number" ? s.trust_threshold : undefined,
        manual_review_only: true,
      } }), { label: "Save settings" });
      toast.success("Settings saved");
    } catch {} finally { setSaving(false); }
  };

  if (loading || !s) {
    return <div className="flex items-center justify-center py-32 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" />Loading…</div>;
  }

  return (
    <div className="p-6 space-y-6 max-w-[900px] mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Profile, application preferences, AI usage, and integrations.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Profile</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Full name" value={s.full_name ?? ""} onChange={(v) => set("full_name", v)} />
          <Field label="Location" value={s.location ?? ""} onChange={(v) => set("location", v)} />
          <Field label="Website" value={s.website ?? ""} onChange={(v) => set("website", v)} placeholder="https://" />
          <Field label="LinkedIn URL" value={s.linkedin_url ?? ""} onChange={(v) => set("linkedin_url", v)} placeholder="https://linkedin.com/in/…" />
          <div className="md:col-span-2 space-y-1.5">
            <Label className="text-xs">Target roles (comma-separated)</Label>
            <Textarea
              rows={3}
              value={(s.target_roles ?? []).join(", ")}
              onChange={(e) => set("target_roles", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))}
              placeholder="Data Analyst, Operations Specialist, Customer Success Manager…"
            />
            <p className="text-[11px] text-muted-foreground">Used for tailoring + scoring. Aim for 5–10 specific titles.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Application preferences</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <Label>Salary minimum</Label>
              <span className="font-mono tabular-nums">${((s.salary_min ?? 55000) / 1000).toFixed(0)}K</span>
            </div>
            <Slider
              value={[Math.round((s.salary_min ?? 55000) / 1000)]}
              onValueChange={([v]) => set("salary_min", v * 1000)}
              min={40} max={200} step={5}
            />
            <p className="text-[11px] text-muted-foreground">Roles below this floor go to Manual Review or get rejected.</p>
          </div>

          <Toggle
            label="Remote-only roles"
            desc="Reject onsite/hybrid postings during ingestion."
            checked={s.remote_only !== false}
            onChange={(v) => set("remote_only", v)}
          />

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <Label>Daily preparation limit</Label>
              <span className="font-mono tabular-nums">{s.daily_cap ?? 25}</span>
            </div>
            <Slider value={[s.daily_cap ?? 25]} onValueChange={([v]) => set("daily_cap", v)} min={5} max={50} step={1} />
            <p className="text-[11px] text-muted-foreground">Max packets prepared per day. AI generations cap separately at 25.</p>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <Label>Company trust threshold</Label>
              <span className="font-mono tabular-nums">{s.trust_threshold ?? 90}</span>
            </div>
            <Slider value={[s.trust_threshold ?? 90]} onValueChange={([v]) => set("trust_threshold", v)} min={70} max={100} step={1} />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Role categories</Label>
            <div className="flex flex-wrap gap-2">
              {ROLE_CATEGORY_OPTS.map((c) => (
                <Badge
                  key={c}
                  variant={(s.role_categories ?? []).includes(c) ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => toggleArr("role_categories", c)}
                >
                  {c.replace(/_/g, " ")}
                </Badge>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Excluded ATS platforms</Label>
            <div className="flex flex-wrap gap-2">
              {ATS_OPTS.map((c) => (
                <Badge
                  key={c}
                  variant={(s.excluded_ats ?? []).includes(c) ? "destructive" : "outline"}
                  className="cursor-pointer"
                  onClick={() => toggleArr("excluded_ats", c)}
                >
                  {c}
                </Badge>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">Workday/Taleo/SAP are already auto-rejected — exclude others as needed.</p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Excluded companies (comma-separated)</Label>
            <Textarea
              rows={2}
              value={(s.excluded_companies ?? []).join(", ")}
              onChange={(e) => set("excluded_companies", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))}
              placeholder="CompanyA, CompanyB"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-success" />Safety</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Manual Review mode</div>
              <p className="text-xs text-muted-foreground">Locked on. Every application requires explicit approval.</p>
            </div>
            <Badge className="bg-success/15 text-success border-success/30">Always on</Badge>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium">Browser automation</div>
              <p className="text-xs text-muted-foreground">Disabled. No headless browsers, no auto-submit.</p>
            </div>
            <Badge variant="outline">Disabled</Badge>
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

      <div className="flex justify-end sticky bottom-4">
        <Button className="bg-accent text-accent-foreground hover:bg-accent/90 shadow-lg" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save changes"}
        </Button>
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
function Stat({ label, value, accent }: { label: string; value: any; accent?: string }) {
  return (
    <div className="text-center p-2 rounded bg-muted">
      <div className={`text-lg font-semibold tabular-nums ${accent ?? ""}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
    </div>
  );
}
