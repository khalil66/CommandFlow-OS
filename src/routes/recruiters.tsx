import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2, Users, TrendingUp, Clock, Award } from "lucide-react";
import { toast } from "sonner";
import { listRecruiters, upsertRecruiter, deleteRecruiter, getRecruiterStats } from "@/lib/recruiters.functions";

export const Route = createFileRoute("/recruiters")({ component: RecruitersPage });

function StatCard({ icon: Icon, label, value, sub, accent }: any) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</div>
            {sub && <div className="mt-1 text-[11px] text-muted-foreground truncate">{sub}</div>}
          </div>
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${accent}`}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RecruitersPage() {
  const listFn = useServerFn(listRecruiters);
  const upsertFn = useServerFn(upsertRecruiter);
  const deleteFn = useServerFn(deleteRecruiter);
  const statsFn = useServerFn(getRecruiterStats);

  const [list, setList] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", title: "", email: "", company_name: "", notes: "" });

  const refresh = async () => {
    const [l, s]: any = await Promise.all([listFn().catch(() => ({ recruiters: [] })), statsFn().catch(() => null)]);
    setList(l.recruiters); setStats(s);
  };

  useEffect(() => { refresh().finally(() => setLoading(false)); }, []);

  const add = async () => {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    try {
      await upsertFn({ data: {
        name: form.name,
        title: form.title || null,
        email: form.email || null,
        company_name: form.company_name || null,
        notes: form.notes || null,
      } as any });
      setForm({ name: "", title: "", email: "", company_name: "", notes: "" });
      toast.success("Recruiter added");
      refresh();
    } catch (e: any) { toast.error(e.message); }
  };

  const remove = async (id: string) => {
    try { await deleteFn({ data: { id } }); toast.success("Removed"); refresh(); }
    catch (e: any) { toast.error(e.message); }
  };

  if (loading) return <div className="flex items-center justify-center py-32 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…</div>;

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Users className="h-5 w-5 text-accent" /> Recruiter Intelligence
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Track recruiter response rates, time-to-response, and best-performing titles.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Users} label="Recruiters" value={stats?.total_recruiters ?? 0} sub="tracked" accent="bg-info/15 text-info" />
        <StatCard icon={TrendingUp} label="Response Rate" value={`${stats?.response_rate ?? 0}%`} sub={`${stats?.total_responses ?? 0} of ${stats?.total_contacted ?? 0}`} accent="bg-success/15 text-success" />
        <StatCard icon={Award} label="Best Title" value={stats?.best_title?.title ?? "—"} sub={stats?.best_title ? `${stats.best_title.rate}% response` : "Need more data"} accent="bg-accent/15 text-accent-foreground" />
        <StatCard icon={Clock} label="Active Today" value={list.filter((r: any) => r.last_contact_at && new Date(r.last_contact_at).toDateString() === new Date().toDateString()).length} sub="contacted today" accent="bg-chart-2/15 text-chart-2" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Plus className="h-4 w-4" /> Add recruiter contact</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label className="text-xs">Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Jane Doe" /></div>
          <div className="space-y-1.5"><Label className="text-xs">Title</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Senior Technical Recruiter" /></div>
          <div className="space-y-1.5"><Label className="text-xs">Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="jane@company.com" /></div>
          <div className="space-y-1.5"><Label className="text-xs">Company</Label><Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} placeholder="Acme Corp" /></div>
          <div className="md:col-span-2 space-y-1.5"><Label className="text-xs">Notes</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <div className="md:col-span-2"><Button onClick={add}><Plus className="h-4 w-4 mr-1.5" /> Add recruiter</Button></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Recruiter directory</CardTitle></CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No recruiter contacts yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {list.map((r: any) => {
                const rate = r.contact_count ? Math.round((r.response_count / r.contact_count) * 100) : 0;
                return (
                  <div key={r.id} className="py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{r.name}</span>
                        {r.title && <Badge variant="outline" className="text-[10px]">{r.title}</Badge>}
                        {r.company_name && <span className="text-xs text-muted-foreground">@ {r.company_name}</span>}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-3">
                        {r.email && <span>{r.email}</span>}
                        <span>Response: {rate}% ({r.response_count}/{r.contact_count})</span>
                        {r.avg_response_hours > 0 && <span>Avg {Math.round(r.avg_response_hours)}h</span>}
                        {r.last_contact_at && <span>Last contact: {new Date(r.last_contact_at).toLocaleDateString()}</span>}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
