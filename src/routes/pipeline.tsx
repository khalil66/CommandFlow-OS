import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Loader2, Save, KanbanSquare } from "lucide-react";
import { toast } from "sonner";
import {
  DndContext, DragEndEvent, DragOverlay, PointerSensor, useDraggable, useDroppable,
  useSensor, useSensors,
} from "@dnd-kit/core";
import { getPipeline, updatePipelineFields, PIPELINE_STAGES, PipelineStage } from "@/lib/pipeline.functions";
import { updateApplicationStatus } from "@/lib/applications.functions";

export const Route = createFileRoute("/pipeline")({ component: PipelinePage });

type App = any;

function StageColumn({ stage, label, items, onCardClick }: {
  stage: PipelineStage; label: string; items: App[]; onCardClick: (a: App) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return (
    <div ref={setNodeRef} className={`flex flex-col rounded-md border ${isOver ? "border-accent bg-accent/5" : "border-border bg-card/40"} min-w-[260px] w-[260px]`}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="text-xs font-semibold uppercase tracking-wider">{label}</div>
        <Badge variant="outline" className="text-[10px]">{items.length}</Badge>
      </div>
      <div className="p-2 space-y-2 overflow-y-auto max-h-[70vh]">
        {items.map((a) => <DraggableCard key={a.id} app={a} onClick={() => onCardClick(a)} />)}
        {items.length === 0 && <div className="text-[11px] text-muted-foreground text-center py-6">Drop here</div>}
      </div>
    </div>
  );
}

function DraggableCard({ app, onClick }: { app: App; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: app.id });
  const style: React.CSSProperties = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)`, opacity: isDragging ? 0.4 : 1 }
    : { opacity: isDragging ? 0.4 : 1 };
  const j = app.job_listings ?? {};
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className="rounded-md border border-border bg-card p-2.5 cursor-grab active:cursor-grabbing hover:border-accent/50 transition"
    >
      <div className="text-sm font-medium truncate">{j.title ?? "—"}</div>
      <div className="text-xs text-muted-foreground truncate">{j.company_name}</div>
      <div className="flex flex-wrap gap-1 mt-2">
        {j.ats && <Badge variant="outline" className="text-[10px]">{j.ats}</Badge>}
        {typeof j.interview_probability === "number" && <Badge variant="outline" className="text-[10px]">P{j.interview_probability}</Badge>}
        {app.next_action_at && <Badge variant="outline" className="text-[10px] border-warning/40 text-warning-foreground">⏰ {new Date(app.next_action_at).toLocaleDateString()}</Badge>}
      </div>
    </div>
  );
}

function PipelinePage() {
  const fetchFn = useServerFn(getPipeline);
  const updateStatusFn = useServerFn(updateApplicationStatus);
  const updateFieldsFn = useServerFn(updatePipelineFields);

  const [apps, setApps] = useState<App[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<App | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const refresh = async () => {
    try {
      const r: any = await fetchFn();
      setApps(r.applications);
    } catch (e: any) { toast.error(e.message); }
  };

  useEffect(() => { refresh().finally(() => setLoading(false)); }, []);

  const grouped = useMemo(() => {
    const map: Record<string, App[]> = {};
    for (const s of PIPELINE_STAGES) map[s.key] = [];
    for (const a of apps) {
      const k = (PIPELINE_STAGES.some((s) => s.key === a.status) ? a.status : "imported") as string;
      (map[k] ??= []).push(a);
    }
    return map;
  }, [apps]);

  const handleDragEnd = async (e: DragEndEvent) => {
    setDraggingId(null);
    const id = String(e.active.id);
    const target = e.over?.id ? String(e.over.id) : null;
    if (!target) return;
    const app = apps.find((a) => a.id === id);
    if (!app || app.status === target) return;
    // Optimistic
    setApps((prev) => prev.map((a) => a.id === id ? { ...a, status: target } : a));
    try {
      await updateStatusFn({ data: { application_id: id, status: target as any } });
      toast.success(`Moved to ${PIPELINE_STAGES.find((s) => s.key === target)?.label}`);
      refresh();
    } catch (err: any) {
      toast.error(err.message);
      refresh();
    }
  };

  return (
    <div className="p-6 space-y-4 max-w-[1900px] mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <KanbanSquare className="h-5 w-5 text-accent" /> Interview CRM Pipeline
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Drag cards between stages. Timestamps and reminders are written automatically.
          No auto-submit · Manual Review override always available.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-32 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading pipeline…
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={(e) => setDraggingId(String(e.active.id))}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setDraggingId(null)}
        >
          <div className="flex gap-3 overflow-x-auto pb-3">
            {PIPELINE_STAGES.map((s) => (
              <StageColumn
                key={s.key}
                stage={s.key}
                label={s.label}
                items={grouped[s.key] ?? []}
                onCardClick={setActive}
              />
            ))}
          </div>
          <DragOverlay>
            {draggingId ? (
              <div className="rounded-md border border-accent bg-card p-2.5 w-[240px] shadow-lg">
                <div className="text-sm font-medium truncate">
                  {apps.find((a) => a.id === draggingId)?.job_listings?.title}
                </div>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <DetailSheet
        app={active}
        onClose={() => setActive(null)}
        onSave={async (patch) => {
          if (!active) return;
          try {
            await updateFieldsFn({ data: { application_id: active.id, ...patch } });
            toast.success("Saved");
            setActive(null);
            refresh();
          } catch (e: any) { toast.error(e.message); }
        }}
      />
    </div>
  );
}

function DetailSheet({ app, onClose, onSave }: {
  app: App | null; onClose: () => void; onSave: (patch: any) => void;
}) {
  const [recruiterNotes, setRecruiterNotes] = useState("");
  const [interviewNotes, setInterviewNotes] = useState("");
  const [salary, setSalary] = useState("");
  const [naAt, setNaAt] = useState("");
  const [naLabel, setNaLabel] = useState("");

  useEffect(() => {
    if (!app) return;
    setRecruiterNotes(app.recruiter_notes ?? "");
    setInterviewNotes(app.interview_notes ?? "");
    setSalary(app.salary_expectation ?? "");
    setNaAt(app.next_action_at ? new Date(app.next_action_at).toISOString().slice(0, 16) : "");
    setNaLabel(app.next_action_label ?? "");
  }, [app?.id]);

  if (!app) return null;
  const j = app.job_listings ?? {};
  const stamps: { label: string; value: string | null }[] = [
    { label: "Reviewed", value: app.reviewed_at },
    { label: "Approved", value: app.approved_at },
    { label: "Submitted", value: app.submitted_at ?? app.submitted_manual_at },
    { label: "Recruiter screen", value: app.recruiter_screen_at },
    { label: "Tech interview", value: app.technical_interview_at },
    { label: "Final interview", value: app.final_interview_at },
    { label: "Offer", value: app.offer_at },
    { label: "Rejected", value: app.rejected_at },
  ];

  return (
    <Sheet open={!!app} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{j.title ?? "Application"}</SheetTitle>
          <div className="text-xs text-muted-foreground">{j.company_name} · {j.ats}</div>
        </SheetHeader>

        <div className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Stage timeline</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-xs">
              {stamps.filter((s) => s.value).map((s) => (
                <div key={s.label} className="flex justify-between">
                  <span className="text-muted-foreground">{s.label}</span>
                  <span className="tabular-nums">{new Date(s.value!).toLocaleString()}</span>
                </div>
              ))}
              {stamps.every((s) => !s.value) && <div className="text-muted-foreground">No stage events recorded yet.</div>}
            </CardContent>
          </Card>

          <div className="space-y-1.5">
            <Label className="text-xs">Recruiter notes</Label>
            <Textarea rows={4} value={recruiterNotes} onChange={(e) => setRecruiterNotes(e.target.value)} placeholder="Recruiter name, contact, conversation snippets…" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Interview notes</Label>
            <Textarea rows={5} value={interviewNotes} onChange={(e) => setInterviewNotes(e.target.value)} placeholder="Topics covered, questions asked, your answers…" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Salary expectation</Label>
            <Input value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="e.g. $90k–$110k base" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Next action</Label>
              <Input value={naLabel} onChange={(e) => setNaLabel(e.target.value)} placeholder="Send follow-up email" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Reminder</Label>
              <Input type="datetime-local" value={naAt} onChange={(e) => setNaAt(e.target.value)} />
            </div>
          </div>

          <Button
            className="w-full"
            onClick={() => onSave({
              recruiter_notes: recruiterNotes || null,
              interview_notes: interviewNotes || null,
              salary_expectation: salary || null,
              next_action_at: naAt ? new Date(naAt).toISOString() : null,
              next_action_label: naLabel || null,
            })}
          >
            <Save className="h-4 w-4 mr-1.5" /> Save changes
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
