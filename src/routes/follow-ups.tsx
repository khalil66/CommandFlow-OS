import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Loader2, BellRing, CheckCircle2, Clock, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { listFollowUps, completeFollowUp, setFollowUp } from "@/lib/engine.functions";
import { withRetry } from "@/lib/api-utils";

export const Route = createFileRoute("/follow-ups")({ component: FollowUps });

function FollowUps() {
  const listFn = useServerFn(listFollowUps);
  const completeFn = useServerFn(completeFollowUp);
  const snoozeFn = useServerFn(setFollowUp);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("today");

  const refresh = async () => {
    try {
      const r: any = await withRetry(() => listFn(), { label: "Follow-ups", silent: true });
      setItems(r.applications);
    } catch (e: any) { toast.error(e.message); }
  };
  useEffect(() => { refresh().finally(() => setLoading(false)); }, []);

  const buckets = useMemo(() => {
    const now = Date.now();
    const startToday = new Date(); startToday.setHours(0,0,0,0);
    const endToday = new Date(); endToday.setHours(23,59,59,999);
    const completed = items.filter((a: any) => ["submitted","interview","offer","rejected","withdrawn"].includes(a.status));
    const active = items.filter((a: any) => !completed.includes(a));
    return {
      today: active.filter((a: any) => {
        const d = new Date(a.follow_up_due_at).getTime();
        return d >= startToday.getTime() && d <= endToday.getTime();
      }),
      overdue: active.filter((a: any) => new Date(a.follow_up_due_at).getTime() < startToday.getTime()),
      upcoming: active.filter((a: any) => new Date(a.follow_up_due_at).getTime() > endToday.getTime()),
      completed,
    };
  }, [items]);

  const handleComplete = async (id: string) => {
    try { await completeFn({ data: { application_id: id } }); toast.success("Marked complete"); refresh(); }
    catch (e: any) { toast.error(e.message); }
  };
  const handleSnooze = async (id: string, days: number) => {
    try { await snoozeFn({ data: { application_id: id, days } }); toast.success(`Snoozed ${days} days`); refresh(); }
    catch (e: any) { toast.error(e.message); }
  };

  const renderList = (rows: any[]) => {
    if (rows.length === 0) return <div className="py-12 text-center text-sm text-muted-foreground">Nothing here.</div>;
    return (
      <div className="divide-y divide-border">
        {rows.map((a: any) => {
          const due = new Date(a.follow_up_due_at);
          const isOverdue = due.getTime() < Date.now();
          return (
            <div key={a.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{a.job_listings?.title ?? "Application"}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {a.job_listings?.company_name} · {a.job_listings?.ats}
                  {a.job_listings?.source_url && (
                    <a href={a.job_listings.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 ml-2 text-accent hover:underline">
                      view <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={isOverdue ? "destructive" : "outline"} className="text-[10px]">
                  <Clock className="h-3 w-3 mr-1" />
                  {due.toLocaleDateString()}
                </Badge>
                <Badge variant="outline" className="text-[10px] capitalize">{a.status?.replace(/_/g," ")}</Badge>
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="outline" onClick={() => handleSnooze(a.id, 3)}>+3d</Button>
                <Button size="sm" variant="outline" onClick={() => handleSnooze(a.id, 7)}>+7d</Button>
                <Button size="sm" className="bg-success/15 text-success hover:bg-success/25" onClick={() => handleComplete(a.id)}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Done
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6 max-w-[1200px] mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <BellRing className="h-5 w-5 text-warning-foreground" /> Follow-Up Reminders
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Stay on top of every application. Snooze if you need more time.</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…</div>
      ) : (
        <Card>
          <CardHeader><CardTitle className="text-base">Due tracker</CardTitle></CardHeader>
          <CardContent>
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="grid grid-cols-4 w-full max-w-xl">
                <TabsTrigger value="today">Today ({buckets.today.length})</TabsTrigger>
                <TabsTrigger value="overdue">Overdue ({buckets.overdue.length})</TabsTrigger>
                <TabsTrigger value="upcoming">Upcoming ({buckets.upcoming.length})</TabsTrigger>
                <TabsTrigger value="completed">Completed ({buckets.completed.length})</TabsTrigger>
              </TabsList>
              <TabsContent value="today" className="mt-4">{renderList(buckets.today)}</TabsContent>
              <TabsContent value="overdue" className="mt-4">{renderList(buckets.overdue)}</TabsContent>
              <TabsContent value="upcoming" className="mt-4">{renderList(buckets.upcoming)}</TabsContent>
              <TabsContent value="completed" className="mt-4">{renderList(buckets.completed)}</TabsContent>
            </Tabs>
            <div className="mt-4 text-xs text-muted-foreground text-right">
              <Link to="/tracker" className="hover:underline">View all applications →</Link>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
