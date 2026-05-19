import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowDown, ArrowUp, Minus, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Humanizes technical status/reason keys into executive-friendly labels.
 */
const LABEL_MAP: Record<string, string> = {
  routing_unresolved: "Needs Review",
  skipped_cap: "Daily Cap Reached",
  safety_blocked: "Safety Blocked",
  packet_generation_failed: "Packet Needs Attention",
  manual_review: "Manual Review",
  auto_reviewed: "Auto Reviewed",
  fresh_imported: "Freshly Imported",
  pass_rate: "Pass Rate",
  ghosted: "Ghosted",
  recruiter_screen: "Recruiter Screen",
};

export function humanizeReason(key: string): string {
  if (!key) return key;
  if (LABEL_MAP[key]) return LABEL_MAP[key];
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Replace any known technical token inside a free-text string with its human label. */
export function humanizeText(text: string): string {
  let out = text;
  for (const [k, v] of Object.entries(LABEL_MAP)) {
    out = out.replace(new RegExp(`\\b${k}\\b`, "g"), v);
  }
  return out;
}

/** Shared recharts tooltip styling. */
export const chartTooltipStyle = {
  background: "var(--color-card)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  fontSize: 12,
  boxShadow: "0 8px 24px -12px rgb(0 0 0 / 0.18)",
  padding: "8px 12px",
};

export const chartAxisProps = {
  stroke: "var(--color-muted-foreground)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
};

/** Tooltip formatter that humanizes label and appends optional suffix. */
export const humanizedTooltipFormatter = (suffix = "") =>
  ((value: any, name: any) => [
    typeof value === "number" ? `${value.toLocaleString()}${suffix}` : value,
    humanizeReason(String(name)),
  ]) as any;

/** Polished card wrapper for any chart/visualization. */
export function ChartCard({
  title,
  description,
  trend,
  action,
  className,
  children,
  icon,
}: {
  title: string;
  description?: string;
  trend?: { value: number; label?: string };
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <Card
      className={cn(
        "card-2xl border-border/60 shadow-sm hover-lift overflow-hidden",
        className,
      )}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-3">
        <div className="min-w-0">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            {icon}
            <span className="truncate">{title}</span>
          </CardTitle>
          {description && (
            <CardDescription className="text-xs mt-1">{description}</CardDescription>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {trend !== undefined && <TrendBadge value={trend.value} label={trend.label} />}
          {action}
        </div>
      </CardHeader>
      <CardContent className="pt-2">{children}</CardContent>
    </Card>
  );
}

/** Up/down/neutral trend pill — formatted percentage. */
export function TrendBadge({ value, label }: { value: number; label?: string }) {
  const dir = value > 0.5 ? "up" : value < -0.5 ? "down" : "flat";
  const Icon = dir === "up" ? ArrowUp : dir === "down" ? ArrowDown : Minus;
  const tone =
    dir === "up"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
      : dir === "down"
        ? "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30"
        : "bg-muted text-muted-foreground border-border";
  const sign = value > 0 ? "+" : "";
  return (
    <Badge
      variant="outline"
      className={cn("gap-1 font-medium tabular-nums text-[11px]", tone)}
      title={label ?? "Week over week"}
    >
      <Icon className="h-3 w-3" />
      {sign}
      {Math.abs(value).toFixed(1)}%
    </Badge>
  );
}

/** Polished empty state for charts. */
export function EmptyChart({
  title = "No data yet",
  hint = "Run today's batch or seed sample data to populate this chart.",
  action,
}: {
  title?: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-4 rounded-xl border border-dashed bg-muted/30">
      <div className="h-10 w-10 rounded-full bg-muted grid place-items-center mb-3">
        <BarChart3 className="h-5 w-5 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-xs">{hint}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** Animated horizontal bar with formatted value on the right. */
export function AnimatedBar({
  label,
  value,
  max,
  valueLabel,
  tone = "primary",
}: {
  label: string;
  value: number;
  max: number;
  valueLabel?: string;
  tone?: "primary" | "accent" | "emerald";
}) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  const fill =
    tone === "emerald"
      ? "bg-gradient-to-r from-emerald-500 to-sky-500"
      : tone === "accent"
        ? "bg-accent"
        : "bg-primary";
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="w-40 truncate text-foreground/90">{label}</div>
      <div className="flex-1 h-2.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-[width] duration-1000 ease-out", fill)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="w-20 text-right text-xs tabular-nums text-muted-foreground">
        {valueLabel ?? value}
      </div>
    </div>
  );
}
