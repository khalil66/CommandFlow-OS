import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";
import { freshnessBucket, FRESHNESS_LABEL, type FreshnessBucket } from "@/lib/freshness";

const STYLES: Record<FreshnessBucket, string> = {
  "0-3": "bg-success/15 text-success border-success/30",
  "4-7": "bg-accent/15 text-accent border-accent/30",
  "8-14": "bg-warning/15 text-warning-foreground border-warning/30",
  "stale": "bg-destructive/15 text-destructive border-destructive/30",
};

export function FreshnessBadge({
  posted_at, bucket, className = "",
}: { posted_at?: string | null; bucket?: FreshnessBucket; className?: string }) {
  const b = bucket ?? freshnessBucket(posted_at);
  return (
    <Badge variant="outline" className={`text-[10px] gap-1 ${STYLES[b]} ${className}`}>
      <Clock className="h-3 w-3" /> {FRESHNESS_LABEL[b]}
    </Badge>
  );
}
