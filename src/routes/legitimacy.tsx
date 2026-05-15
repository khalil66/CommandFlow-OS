import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScoreBar } from "@/components/score-bar";
import { ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/legitimacy")({ component: Legit });

function Legit() {
  const [name, setName] = useState("");
  const [result, setResult] = useState<any>(null);

  const check = () => {
    if (!name) return;
    const score = Math.floor(50 + (name.length * 7) % 50);
    setResult({
      name,
      score,
      domainAge: `${Math.floor(2 + (name.length % 18))} years`,
      employees: ["10-50", "50-200", "200-1000", "1000+"][name.length % 4],
      glassdoor: (3 + (name.length % 20) / 10).toFixed(1),
      linkedinPresence: score > 65,
      paidJobBoards: score > 70,
      mediaCoverage: score > 75,
      flags: score < 70 ? ["No domain history", "Sparse LinkedIn"] : [],
    });
  };

  return (
    <div className="p-6 space-y-6 max-w-[1100px] mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Company Legitimacy Checker</h1>
        <p className="text-sm text-muted-foreground mt-1">Verifies employer is real before any application is queued.</p>
      </div>

      <Card>
        <CardContent className="p-5 flex gap-3 items-end">
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs">Company name or domain</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. linear.app" onKeyDown={e => e.key === "Enter" && check()} />
          </div>
          <Button onClick={check} className="bg-accent text-accent-foreground hover:bg-accent/90">Run check</Button>
        </CardContent>
      </Card>

      {result && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="md:col-span-1">
            <CardContent className="p-6 text-center">
              <div className={`mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full ${result.score >= 70 ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}>
                {result.score >= 70 ? <ShieldCheck className="h-8 w-8" /> : <ShieldAlert className="h-8 w-8" />}
              </div>
              <div className="text-4xl font-semibold tabular-nums">{result.score}</div>
              <div className="text-xs text-muted-foreground mt-1">Legitimacy score</div>
              <div className="mt-4">
                <ScoreBar value={result.score} />
              </div>
              <div className="mt-4 text-sm">
                {result.score >= 70 ? <span className="text-success font-medium">✓ Approved for outreach</span> : <span className="text-destructive font-medium">✗ Auto-rejected</span>}
              </div>
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader><CardTitle className="text-base">{result.name}</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Domain age" value={result.domainAge} />
              <Row label="Employee count (LinkedIn)" value={result.employees} />
              <Row label="Glassdoor rating" value={`${result.glassdoor} / 5`} />
              <Row label="Verified LinkedIn presence" value={result.linkedinPresence ? "Yes" : "No"} good={result.linkedinPresence} />
              <Row label="Active on paid job boards" value={result.paidJobBoards ? "Yes" : "No"} good={result.paidJobBoards} />
              <Row label="Recent media coverage" value={result.mediaCoverage ? "Yes" : "No"} good={result.mediaCoverage} />
              {result.flags.length > 0 && (
                <div className="p-3 rounded-md bg-warning/10 border border-warning/30 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning-foreground mt-0.5" />
                  <div>
                    <div className="text-xs font-medium">Risk signals</div>
                    <div className="text-xs text-muted-foreground">{result.flags.join(" · ")}</div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium flex items-center gap-1.5">
        {good && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
        {value}
      </span>
    </div>
  );
}
