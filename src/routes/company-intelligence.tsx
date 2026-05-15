import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, Building2, AlertTriangle, TrendingUp, Users2, Globe2, MapPin, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { listCompaniesForIntel, enrichCompany } from "@/lib/intelligence.functions";

export const Route = createFileRoute("/company-intelligence")({ component: CompanyIntelligencePage });

function CompanyIntelligencePage() {
  const listFn = useServerFn(listCompaniesForIntel);
  const enrichFn = useServerFn(enrichCompany);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [enriching, setEnriching] = useState<string | null>(null);
  const [selected, setSelected] = useState<any | null>(null);

  const refresh = () => {
    setLoading(true);
    listFn().then((r: any) => setRows(r.companies)).finally(() => setLoading(false));
  };
  useEffect(() => { refresh(); }, []);

  const enrich = async (id: string, name: string) => {
    setEnriching(id);
    try {
      const r = await enrichFn({ data: { company_id: id } });
      toast.success(`Enriched ${name}`);
      setSelected({ ...r.company, intelligence: r.intelligence });
      refresh();
    } catch (e: any) { toast.error(e.message); }
    finally { setEnriching(null); }
  };

  return (
    <div className="p-6 space-y-6 max-w-[1500px] mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Building2 className="h-5 w-5" /> Company Intelligence
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Enriched profiles · interview themes · role competitiveness · risks.</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-32 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…</div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-sm text-muted-foreground">No companies yet. Seed sample data from the Queue.</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-1 space-y-2 max-h-[calc(100vh-200px)] overflow-y-auto pr-2">
            {rows.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelected(c)}
                className={`w-full text-left p-3 rounded-md border transition-colors ${selected?.id === c.id ? "border-accent bg-accent/5" : "border-border hover:bg-muted/40"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{c.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{c.domain ?? c.category}</div>
                  </div>
                  {c.has_intelligence ? (
                    <Badge variant="outline" className="border-success/40 text-success shrink-0"><Sparkles className="h-3 w-3 mr-1" />Enriched</Badge>
                  ) : (
                    <Badge variant="outline" className="shrink-0">New</Badge>
                  )}
                </div>
              </button>
            ))}
          </div>

          <div className="lg:col-span-2">
            {!selected ? (
              <Card><CardContent className="py-24 text-center text-sm text-muted-foreground">Select a company to view intelligence.</CardContent></Card>
            ) : (
              <CompanyDetail company={selected} enriching={enriching === selected.id} onEnrich={() => enrich(selected.id, selected.name)} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CompanyDetail({ company, enriching, onEnrich }: any) {
  const intel = company.intelligence;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">{company.name}</CardTitle>
            <p className="text-xs text-muted-foreground">{company.domain ?? company.category}</p>
          </div>
          <Button onClick={onEnrich} disabled={enriching} size="sm">
            {enriching ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
            {intel ? "Refresh intelligence" : "Enrich with AI"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {!intel ? (
          <p className="text-sm text-muted-foreground">No intelligence yet. Click <span className="font-medium">Enrich with AI</span> to generate an enriched profile.</p>
        ) : (
          <>
            {intel.overview && <p className="text-sm leading-relaxed">{intel.overview}</p>}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Fact icon={Globe2} label="Industry" value={intel.industry} />
              <Fact icon={Users2} label="Size" value={intel.company_size} />
              <Fact icon={MapPin} label="HQ" value={intel.headquarters} />
              <Fact icon={TrendingUp} label="Funding" value={intel.funding_stage} />
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">Remote: {intel.remote_culture ?? "unknown"}</Badge>
              <Badge variant="outline" className={competitivenessClass(intel.role_competitiveness)}>
                Competitiveness: {intel.role_competitiveness ?? "unknown"}
              </Badge>
            </div>

            <Section title="Hiring signals" items={intel.hiring_signals} accent="text-success" />
            <Section title="Growth signals" items={intel.growth_signals} accent="text-accent" />
            <Section title="Likely interview themes" items={intel.interview_themes} />
            <Section title="Company-specific keywords" items={intel.keywords} pill />
            <Section title="Questions to ask the interviewer" items={intel.questions_to_ask} />

            {intel.red_flags?.length > 0 && (
              <div className="border border-destructive/30 bg-destructive/5 rounded-md p-3">
                <div className="text-xs font-medium flex items-center gap-2 mb-2"><ShieldAlert className="h-3.5 w-3.5 text-destructive" /> Risks / red flags</div>
                <ul className="space-y-1 text-xs text-destructive">
                  {intel.red_flags.map((r: string, i: number) => <li key={i}>• {r}</li>)}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Fact({ icon: Icon, label, value }: any) {
  return (
    <div className="p-3 rounded-md border border-border">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground"><Icon className="h-3 w-3" /> {label}</div>
      <div className="mt-1 text-sm font-medium">{value ?? "—"}</div>
    </div>
  );
}

function Section({ title, items, accent, pill }: { title: string; items?: string[]; accent?: string; pill?: boolean }) {
  if (!items?.length) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{title}</div>
      {pill ? (
        <div className="flex flex-wrap gap-1">{items.map((s, i) => <Badge key={i} variant="secondary">{s}</Badge>)}</div>
      ) : (
        <ul className="space-y-1.5 text-sm">{items.map((s, i) => <li key={i} className={`flex gap-2 ${accent ?? ""}`}><span className="text-muted-foreground">•</span>{s}</li>)}</ul>
      )}
    </div>
  );
}

function competitivenessClass(level?: string) {
  switch (level) {
    case "low": return "border-success/40 text-success";
    case "medium": return "border-warning/40 text-warning-foreground";
    case "high": return "border-destructive/40 text-destructive";
    case "very high": return "bg-destructive/10 border-destructive/50 text-destructive";
    default: return "";
  }
}
