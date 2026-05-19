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
import { sendTestSms } from "@/lib/sms.functions";
import { runSafeAutoSubmitDryRun, getDryRunReport } from "@/lib/safe-auto-submit-dryrun.functions";
import { withRetry } from "@/lib/api-utils";
import { Gauge, AlertCircle, ShieldCheck, Loader2, MessageSquare, Send, Rocket, PlayCircle, AlertTriangle } from "lucide-react";
import { OptimizationSweepButton } from "@/components/optimization-sweep-button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/settings")({ component: Settings });

const ROLE_CATEGORY_OPTS = ["data","operations","customer_success","technical_support","product_pm","saas","other"];
const ATS_OPTS = ["greenhouse","lever","ashby","breezy","workday","taleo","sap","icims","other"];

function Settings() {
  const usageFn = useServerFn(getUsageToday);
  const analyticsFn = useServerFn(getUsageAnalytics);
  const getFn = useServerFn(getSettings);
  const saveFn = useServerFn(updateSettings);
  const testSmsFn = useServerFn(sendTestSms);
  const dryRunFn = useServerFn(runSafeAutoSubmitDryRun);
  const getDryRunFn = useServerFn(getDryRunReport);

  const [usage, setUsage] = useState<any>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [s, setS] = useState<any>(null);
  const [dryRun, setDryRun] = useState<any>(null);
  const [runningDry, setRunningDry] = useState(false);
  const [confirmRealOpen, setConfirmRealOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingSms, setTestingSms] = useState(false);

  useEffect(() => {
    Promise.all([
      usageFn().catch(() => null),
      analyticsFn().catch(() => null),
      getFn().catch(() => null),
      getDryRunFn().catch(() => null),
    ]).then(([u, a, st, dr]: any) => {
      setUsage(u); setAnalytics(a);
      setS(st?.settings ?? {});
      setDryRun(dr ?? null);
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
        phone_number: s.phone_number ?? undefined,
        sms_enabled: typeof s.sms_enabled === "boolean" ? s.sms_enabled : undefined,
        sms_daily_cap: typeof s.sms_daily_cap === "number" ? s.sms_daily_cap : undefined,
        sms_notify_batch_start: typeof s.sms_notify_batch_start === "boolean" ? s.sms_notify_batch_start : undefined,
        sms_notify_batch_complete: typeof s.sms_notify_batch_complete === "boolean" ? s.sms_notify_batch_complete : undefined,
        sms_notify_safety_block: typeof s.sms_notify_safety_block === "boolean" ? s.sms_notify_safety_block : undefined,
        sms_notify_high_probability: typeof s.sms_notify_high_probability === "boolean" ? s.sms_notify_high_probability : undefined,
        sms_notify_followups: typeof s.sms_notify_followups === "boolean" ? s.sms_notify_followups : undefined,
        safe_auto_submit_enabled: typeof s.safe_auto_submit_enabled === "boolean" ? s.safe_auto_submit_enabled : undefined,
        safe_auto_submit_daily_cap: typeof s.safe_auto_submit_daily_cap === "number" ? s.safe_auto_submit_daily_cap : undefined,
        safe_auto_submit_dry_run: typeof s.safe_auto_submit_dry_run === "boolean" ? s.safe_auto_submit_dry_run : undefined,
      } }), { label: "Save settings" });
      toast.success("Settings saved");
    } catch {} finally { setSaving(false); }
  };

  const handleTestSms = async () => {
    setTestingSms(true);
    try {
      const r: any = await testSmsFn();
      if (r.ok) {
        toast.success("Test SMS sent successfully");
      } else if (r.status === "skipped:not_configured") {
        toast.error(`SMS not configured. Missing: ${(r.missing ?? []).join(", ")}`);
      } else {
        toast.error(`SMS failed: ${r.error ?? "unknown error"}`);
      }
    } catch (e: any) {
      toast.error(`Test SMS error: ${e.message}`);
    } finally {
      setTestingSms(false);
    }
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
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Rocket className="h-4 w-4 text-accent" /> Optimization
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            One-click sweep: Smart Apply cycle, recompute source priority, backfill freshness, weekly learning report, refresh dashboard. Respects Auto Review cap (5/day), Manual Review fallback, no auto-submit, no browser automation.
          </p>
          <OptimizationSweepButton variant="default" />
        </CardContent>
      </Card>

      <Card className="border-amber-500/40">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-amber-500" /> Safe Auto-Submit
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label className="text-sm">Enable Safe Auto-Submit</Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                OFF by default. Requires a passing Dry Run first. Only auto-submits when Application Mode = Auto Review AND every safety gate passes (trust ≥95, interview ≥92, quality ≥92, salary gate passes, fresh ≤14d, ATS in {"{"}Greenhouse, Lever, Ashby, Breezy{"}"}, no login/MFA/CAPTCHA/bot, no duplicate, no same-company within 30d). Caps: 3/day, 2/ATS/day. Manual Review fallback always available.
              </p>
            </div>
            <Switch
              checked={!!s.safe_auto_submit_enabled}
              onCheckedChange={(v: boolean) => {
                if (v) {
                  if (!dryRun?.passed_at) {
                    toast.error("Run a passing Dry Run before enabling real Safe Auto-Submit.");
                    return;
                  }
                  setConfirmRealOpen(true);
                } else {
                  set("safe_auto_submit_enabled", false);
                }
              }}
            />
          </div>

          <Toggle
            label="Dry Run Auto-Submit"
            desc="Simulates the full submission process without clicking submit. Verifies URL opens, ATS supported, no login/MFA/CAPTCHA/bot, resume + cover-letter + submit fields detectable. Produces a report. Keep ON until you've reviewed at least one passing dry run."
            checked={s.safe_auto_submit_dry_run !== false}
            onChange={(v: boolean) => set("safe_auto_submit_dry_run", v)}
          />

          <div className="rounded-md border border-border p-3 space-y-2 bg-muted/30">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium flex items-center gap-2">
                <PlayCircle className="h-4 w-4 text-accent" /> Dry Run report
              </div>
              <Button
                size="sm" variant="outline" disabled={runningDry}
                onClick={async () => {
                  setRunningDry(true);
                  try {
                    const r: any = await dryRunFn();
                    setDryRun({ dry_run_enabled: s.safe_auto_submit_dry_run !== false, passed_at: r.passed ? r.generated_at : dryRun?.passed_at ?? null, report: r });
                    toast.success(r.passed ? `Dry Run passed — ${r.ready_for_submit}/${r.total_candidates} ready` : `Dry Run finished — ${r.blocked} blocked, ${r.missing_fields} missing fields, ${r.manual_review_required} manual review`);
                  } catch (e: any) { toast.error(`Dry Run failed: ${e.message}`); }
                  finally { setRunningDry(false); }
                }}>
                {runningDry ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <PlayCircle className="h-4 w-4 mr-1.5" />}
                Run Dry Run now
              </Button>
            </div>
            {dryRun?.report ? (
              <div className="text-xs space-y-1.5">
                <div className="flex gap-2 flex-wrap">
                  <Badge variant={dryRun.report.passed ? "default" : "outline"} className={dryRun.report.passed ? "bg-success/15 text-success border-success/30" : ""}>
                    {dryRun.report.passed ? "PASSED" : "NEEDS REVIEW"}
                  </Badge>
                  <Badge variant="outline">Ready: {dryRun.report.ready_for_submit}</Badge>
                  <Badge variant="outline" className="text-destructive">Blocked: {dryRun.report.blocked}</Badge>
                  <Badge variant="outline">Missing fields: {dryRun.report.missing_fields}</Badge>
                  <Badge variant="outline">Manual: {dryRun.report.manual_review_required}</Badge>
                </div>
                <p className="text-muted-foreground">
                  Last run: {new Date(dryRun.report.generated_at).toLocaleString()} ·
                  {dryRun.passed_at ? ` passing dry run on file (${new Date(dryRun.passed_at).toLocaleDateString()})` : " no passing dry run yet — real submit gated"}
                </p>
                {dryRun.report.results?.slice(0, 5).map((r: any) => (
                  <div key={r.job_id} className="flex items-center justify-between border-t border-border/50 pt-1.5">
                    <span className="truncate mr-2">{r.title} · {r.company} · {r.ats}</span>
                    <Badge variant="outline" className="text-[10px]">{r.status}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No dry run yet. Run one to verify the pipeline before enabling real Safe Auto-Submit.</p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <Label>Safe Auto-Submit daily cap</Label>
              <span className="font-mono tabular-nums">{s.safe_auto_submit_daily_cap ?? 3}</span>
            </div>
            <Slider
              value={[s.safe_auto_submit_daily_cap ?? 3]}
              onValueChange={([v]: number[]) => set("safe_auto_submit_daily_cap", v)}
              min={0} max={10} step={1}
            />
            <p className="text-[11px] text-muted-foreground">Hard ceiling on auto-submitted applications per day. Start low (3).</p>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmRealOpen} onOpenChange={setConfirmRealOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" /> Enable real Safe Auto-Submit?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will submit real applications only when all safety gates pass.
              Auto-submission stops immediately on any login wall, MFA, CAPTCHA, or bot warning.
              Caps remain in force (3/day, 2/ATS/day, 1/company/30d). You can turn this off at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep dry run only</AlertDialogCancel>
            <AlertDialogAction onClick={() => { set("safe_auto_submit_enabled", true); set("safe_auto_submit_dry_run", false); }}>
              Yes, enable real submission
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


      <Card>
        <CardHeader><CardTitle className="text-base">Profile</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Full name" value={s.full_name ?? ""} onChange={(v: string) => set("full_name", v)} />
          <Field label="Location" value={s.location ?? ""} onChange={(v: string) => set("location", v)} />
          <Field label="Website" value={s.website ?? ""} onChange={(v: string) => set("website", v)} placeholder="https://" />
          <Field label="LinkedIn URL" value={s.linkedin_url ?? ""} onChange={(v: string) => set("linkedin_url", v)} placeholder="https://linkedin.com/in/…" />
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
              onValueChange={([v]: number[]) => set("salary_min", v * 1000)}
              min={40} max={200} step={5}
            />
            <p className="text-[11px] text-muted-foreground">Roles below this floor go to Manual Review or get rejected.</p>
          </div>

          <Toggle
            label="Remote-only roles"
            desc="Reject onsite/hybrid postings during ingestion."
            checked={s.remote_only !== false}
            onChange={(v: boolean) => set("remote_only", v)}
          />

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <Label>Daily preparation limit</Label>
              <span className="font-mono tabular-nums">{s.daily_cap ?? 25}</span>
            </div>
            <Slider value={[s.daily_cap ?? 25]} onValueChange={([v]: number[]) => set("daily_cap", v)} min={5} max={50} step={1} />
            <p className="text-[11px] text-muted-foreground">Max packets prepared per day. AI generations cap separately at 25.</p>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <Label>Company trust threshold</Label>
              <span className="font-mono tabular-nums">{s.trust_threshold ?? 90}</span>
            </div>
            <Slider value={[s.trust_threshold ?? 90]} onValueChange={([v]: number[]) => set("trust_threshold", v)} min={70} max={100} step={1} />
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
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><MessageSquare className="h-4 w-4 text-accent" /> SMS notifications</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Toggle label="Enable SMS notifications" desc="Send updates via Twilio. Requires TWILIO_* secrets configured." checked={!!s.sms_enabled} onChange={(v: boolean) => set("sms_enabled", v)} />
          <Field label="Phone number (E.164, e.g. +15555550123)" value={s.phone_number ?? ""} onChange={(v: string) => set("phone_number", v)} placeholder="+15555550123" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Toggle label="Notify on batch start" desc="" checked={s.sms_notify_batch_start !== false} onChange={(v: boolean) => set("sms_notify_batch_start", v)} />
            <Toggle label="Notify on batch complete" desc="" checked={s.sms_notify_batch_complete !== false} onChange={(v: boolean) => set("sms_notify_batch_complete", v)} />
            <Toggle label="Notify on safety block" desc="" checked={s.sms_notify_safety_block !== false} onChange={(v: boolean) => set("sms_notify_safety_block", v)} />
            <Toggle label="Notify on high-probability match" desc="" checked={s.sms_notify_high_probability !== false} onChange={(v: boolean) => set("sms_notify_high_probability", v)} />
            <Toggle label="Notify on follow-ups due" desc="" checked={s.sms_notify_followups !== false} onChange={(v: boolean) => set("sms_notify_followups", v)} />
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground">Test that Twilio is configured and your phone receives a message.</p>
            <Button variant="outline" size="sm" onClick={handleTestSms} disabled={testingSms}>
              {testingSms ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Send className="h-4 w-4 mr-1.5" />}
              Send Test SMS
            </Button>
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

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}
function Field({ label, value, onChange, placeholder }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}
interface ToggleProps {
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}
function Toggle({ label, desc, checked, onChange }: ToggleProps) {
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
