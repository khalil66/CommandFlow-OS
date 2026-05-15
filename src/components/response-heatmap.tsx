import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CalendarHeart } from "lucide-react";
import { getResponseHeatmap } from "@/lib/pipeline.functions";

const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

export function ResponseHeatmap() {
  const fn = useServerFn(getResponseHeatmap);
  const [grid, setGrid] = useState<number[][] | null>(null);
  useEffect(() => { fn().then((r: any) => setGrid(r.grid)).catch(() => setGrid(Array.from({ length: 7 }, () => Array(24).fill(0)))); }, []);
  if (!grid) return <Card><CardContent className="p-6 flex items-center justify-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading heatmap…</CardContent></Card>;
  const max = Math.max(1, ...grid.flat());
  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><CalendarHeart className="h-4 w-4 text-accent" /> Recruiter response heatmap</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="text-[10px] tabular-nums">
            <thead>
              <tr>
                <th></th>
                {Array.from({ length: 24 }, (_, h) => (
                  <th key={h} className="px-1 py-0.5 text-muted-foreground font-normal">{h % 3 === 0 ? h : ""}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map((row, di) => (
                <tr key={di}>
                  <td className="pr-2 text-muted-foreground">{DAYS[di]}</td>
                  {row.map((v, hi) => {
                    const intensity = v / max;
                    const bg = v === 0 ? "var(--color-muted)" : `color-mix(in oklab, var(--color-accent) ${Math.round(intensity * 100)}%, var(--color-card))`;
                    return <td key={hi} title={`${DAYS[di]} ${hi}:00 — ${v} responses`} style={{ background: bg }} className="w-4 h-4 border border-border/40" />;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">Hours when recruiters most often respond (local time).</p>
      </CardContent>
    </Card>
  );
}
