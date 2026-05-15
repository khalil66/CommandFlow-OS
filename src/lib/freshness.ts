// Job freshness bucketing — used at ingest, in scoring, and in UI badges.

export type FreshnessBucket = "0-3" | "4-7" | "8-14" | "stale";

export function ageDays(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

export function freshnessBucket(iso?: string | null): FreshnessBucket {
  const age = ageDays(iso);
  if (age == null) return "stale";
  if (age <= 3) return "0-3";
  if (age <= 7) return "4-7";
  if (age <= 14) return "8-14";
  return "stale";
}

export function freshnessPriorityBoost(b: FreshnessBucket): number {
  switch (b) {
    case "0-3": return 15;
    case "4-7": return 8;
    case "8-14": return 0;
    case "stale": return -100;
  }
}

export const FRESHNESS_LABEL: Record<FreshnessBucket, string> = {
  "0-3": "0–3 days",
  "4-7": "4–7 days",
  "8-14": "8–14 days",
  "stale": "14+ days",
};
