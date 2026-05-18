import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DollarSign, Sparkles, AlertCircle, ShieldCheck, ShieldX } from "lucide-react";

type Job = {
  salary_min?: number | null;
  salary_max?: number | null;
  salary_posted_min?: number | null;
  salary_posted_max?: number | null;
  salary_source?: string | null;
  salary_confidence?: string | null;
  salary_estimated_min?: number | null;
  salary_estimated_max?: number | null;
  salary_gate_status?: string | null;
  salary_gate_reason?: string | null;
  salary_evidence?: string[] | null;
};

const STATUS_STYLE: Record<string, string> = {
  pass:   "bg-success/15 text-success border-success/30",
  manual: "bg-warning/15 text-warning-foreground border-warning/30",
  reject: "bg-destructive/15 text-destructive border-destructive/30",
};

const CONF_STYLE: Record<string, string> = {
  high:    "bg-success/10 text-success border-success/30",
  medium:  "bg-info/10 text-info border-info/30",
  low:     "bg-warning/10 text-warning-foreground border-warning/30",
  unknown: "bg-muted text-muted-foreground border-border",
};

const fmt = (n?: number | null) => (n != null ? `$${n.toLocaleString()}` : "—");

export function SalaryBadge({ job }: { job: Job }) {
  const status = (job.salary_gate_status ?? "manual") as "pass" | "manual" | "reject";
  const conf = (job.salary_confidence ?? "unknown") as "high" | "medium" | "low" | "unknown";
  const source = job.salary_source ?? "missing";
  const Icon = status === "pass" ? ShieldCheck : status === "reject" ? ShieldX : AlertCircle;

  const posted = job.salary_min != null
    ? `${fmt(job.salary_min)}${job.salary_max ? `–${fmt(job.salary_max)}` : ""}`
    : null;
  const estimated = job.salary_estimated_min != null
    ? `${fmt(job.salary_estimated_min)}${job.salary_estimated_max ? `–${fmt(job.salary_estimated_max)}` : ""}`
    : null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="inline-flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={`text-[10px] ${STATUS_STYLE[status]}`}>
            <Icon className="h-3 w-3 mr-1" />
            {status === "pass" ? "Salary ✓" : status === "reject" ? "Below floor" : "Salary review"}
          </Badge>
          {posted && (
            <Badge variant="outline" className="text-[10px]">
              <DollarSign className="h-3 w-3 mr-0.5" /> Posted {posted}
            </Badge>
          )}
          {!posted && estimated && (
            <Badge variant="outline" className="text-[10px]">
              <Sparkles className="h-3 w-3 mr-0.5" /> Est. {estimated}
            </Badge>
          )}
          <Badge variant="outline" className={`text-[10px] ${CONF_STYLE[conf]}`}>{conf} confidence</Badge>
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">
        <div className="text-xs space-y-1.5">
          <div><span className="text-muted-foreground">Source:</span> {source.replace(/_/g, " ")}</div>
          <div><span className="text-muted-foreground">Gate:</span> {status}</div>
          {job.salary_gate_reason && <div className="text-muted-foreground">{job.salary_gate_reason}</div>}
          {job.salary_evidence && job.salary_evidence.length > 0 && (
            <div>
              <div className="text-muted-foreground">Evidence:</div>
              <ul className="list-disc list-inside text-[10px] mt-0.5">
                {job.salary_evidence.slice(0, 6).map((e, i) => (
                  <li key={i}>{e.replace(/_/g, " ")}</li>
                ))}
              </ul>
            </div>
          )}
          {source !== "posted_salary" && (
            <div className="text-[10px] italic text-warning-foreground">Estimated — not a posted figure.</div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
