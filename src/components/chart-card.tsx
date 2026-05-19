import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowDown, ArrowUp, Minus, BarChart3, Sparkles, Lightbulb, type LucideIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

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
export type EmptyCTA = { label: string; to: string; icon?: LucideIcon; variant?: "default" | "outline" | "ghost" };

/** Premium storytelling empty state. Backward compatible with title/hint/action. */
export function EmptyChart({
  title = "No data yet",
  hint = "Run today's batch or seed sample data to populate this chart.",
  why,
  sample = "bars",
  ctas,
  icon: Icon = BarChart3,
  action,
  compact = false,
}: {
  title?: string;
  hint?: string;
  why?: string;
  sample?: "bars" | "line" | "funnel" | "none" | ReactNode;
  ctas?: EmptyCTA[];
  icon?: LucideIcon;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-dashed bg-gradient-to-br from-muted/40 via-background to-muted/20",
        "flex flex-col items-center justify-center text-center px-4",
        compact ? "py-8" : "py-10",
      )}
    >
      {/* shimmer */}
      <div className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_2.4s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-foreground/[0.04] to-transparent" />

      {/* illustration */}
      {sample !== "none" && (
        <div className="w-full max-w-[220px] mb-4 opacity-80">
          {typeof sample === "string" ? <SampleViz kind={sample as "bars" | "line" | "funnel"} /> : sample}
        </div>
      )}

      <div className="relative h-10 w-10 rounded-full bg-primary/10 grid place-items-center mb-3 ring-1 ring-primary/20">
        <Icon className="h-5 w-5 text-primary" />
        <span className="absolute inset-0 rounded-full ring-2 ring-primary/30 animate-ping opacity-40" />
      </div>

      <p className="text-sm font-semibold">{title}</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-sm leading-relaxed">{hint}</p>

      {why && (
        <div className="mt-3 inline-flex items-start gap-2 rounded-md border border-border bg-card/60 px-3 py-2 text-left max-w-sm">
          <Lightbulb className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
          <span className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">Why this matters: </span>{why}
          </span>
        </div>
      )}

      {(ctas?.length || action) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {ctas?.map((c, i) => {
            const CtaIcon = c.icon ?? Sparkles;
            return (
              <Button key={i} asChild size="sm" variant={c.variant ?? (i === 0 ? "default" : "outline")}>
                <Link to={c.to}><CtaIcon className="h-3.5 w-3.5 mr-1.5" />{c.label}</Link>
              </Button>
            );
          })}
          {action}
        </div>
      )}
    </div>
  );
}

/** Minimal animated sample visualization for empty states. */
function SampleViz({ kind }: { kind: "bars" | "line" | "funnel" }) {
  if (kind === "line") {
    return (
      <svg viewBox="0 0 200 60" className="w-full h-auto text-primary/60">
        <defs>
          <linearGradient id="ec-line" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M0,45 L30,38 L60,42 L90,28 L120,32 L150,18 L180,22 L200,10 L200,60 L0,60 Z" fill="url(#ec-line)" />
        <path d="M0,45 L30,38 L60,42 L90,28 L120,32 L150,18 L180,22 L200,10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "funnel") {
    return (
      <div className="space-y-1.5">
        {[100, 72, 48, 28, 14].map((w, i) => (
          <div key={i} className="mx-auto h-2.5 rounded-full bg-primary/30" style={{ width: `${w}%`, opacity: 0.4 + i * 0.1 }} />
        ))}
      </div>
    );
  }
  // bars (default)
  return (
    <div className="flex items-end justify-center gap-1.5 h-14">
      {[40, 65, 35, 80, 55, 70, 45].map((h, i) => (
        <div
          key={i}
          className="w-3 rounded-t bg-primary/40"
          style={{ height: `${h}%`, animation: `pulse 2.2s ease-in-out ${i * 0.15}s infinite` }}
        />
      ))}
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
