import { cn } from "@/lib/utils";

export function ScoreBar({ value, label }: { value: number; label?: string }) {
  const color =
    value >= 85 ? "bg-success" : value >= 70 ? "bg-accent" : value >= 50 ? "bg-warning" : "bg-destructive";
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs font-mono tabular-nums text-muted-foreground w-8 text-right">{value}</span>
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    "Ready to Apply": "bg-success/15 text-success border-success/30",
    "Needs Review": "bg-warning/15 text-warning-foreground border-warning/30",
    "Manual Review": "bg-info/15 text-info border-info/30",
    "Rejected": "bg-destructive/15 text-destructive border-destructive/30",
    "Applied": "bg-muted text-foreground border-border",
    "Interview": "bg-accent/15 text-accent-foreground border-accent/30",
    "Offer": "bg-success text-success-foreground border-transparent",
    "Easy": "bg-success/15 text-success border-success/30",
    "Medium": "bg-warning/15 text-warning-foreground border-warning/30",
    "Hard": "bg-destructive/15 text-destructive border-destructive/30",
    // DB statuses
    queued: "bg-muted text-foreground border-border",
    manual_review: "bg-info/15 text-info border-info/30",
    approved: "bg-success/15 text-success border-success/30",
    submitted: "bg-accent/15 text-accent-foreground border-accent/30",
    interview: "bg-accent/15 text-accent-foreground border-accent/30",
    rejected: "bg-destructive/15 text-destructive border-destructive/30",
    offer: "bg-success text-success-foreground border-transparent",
    withdrawn: "bg-muted text-muted-foreground border-border",
  };
  const label = status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return (
    <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap", map[status] || "bg-muted text-foreground border-border")}>
      {label}
    </span>
  );
}
