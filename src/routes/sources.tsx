import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Loader2, Plus, Download, Trash2, RefreshCw, ShieldAlert, ShieldCheck,
  Sparkles, Bug, FlaskConical, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import {
  listJobSources, addJobSource, deleteJobSource,
  importJobsNow, listImportLogs, detectAtsFromUrl,
  insertMockTestJob,
} from "@/lib/ingest.functions";
import { getSettings, updateSettings } from "@/lib/settings.functions";

export const Route = createFileRoute("/sources")({ component: SourcesPage });

const ATS_LIST: Array<{ key: string; label: string; defaultCap: number }> = [
  { key: "Greenhouse", label: "Greenhouse", defaultCap: 50 },
  { key: "Lever",      label: "Lever",      defaultCap: 50 },
  { key: "Ashby",      label: "Ashby",      defaultCap: 50 },
  { key: "Breezy",     label: "Breezy",     defaultCap: 50 },
  { key: "Workday",    label: "Workday",    defaultCap: 30 },
  { key: "other",      label: "Other",      defaultCap: 25 },
];

function SourcesPage() {
  const listFn = useServerFn(listJobSources);
  const addFn = useServerFn(addJobSource);
  const delFn = useServerFn(deleteJobSource);
  const importFn = useServerFn(importJobsNow);
  const logsFn = useServerFn(listImportLogs);
  const detectFn = useServerFn(detectAtsFromUrl);
  const mockFn = useServerFn(insertMockTestJob);
  const getSettingsFn = useServerFn(getSettings);
  const updateSettingsFn = useServerFn(updateSettings);

  const [sources, setSources] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [mockBusy, setMockBusy] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [detected, setDetected] = useState<any>(null);

  const [relaxed, setRelaxed] = useState(false);
  const [caps, setCaps] = useState<Record<string, number>>({});

  const refresh = async () => {
    const [s, l, st] = await Promise.all([listFn(), logsFn(), getSettingsFn()]);
    setSources(s.sources); setLogs(l.logs);
    const settings: any = (st as any).settings ?? {};
    setRelaxed(!!settings.relaxed_mode);
    const merged: Record<string, number> = {};
    ATS_LIST.forEach((a) => { merged[a.key] = a.defaultCap; });
    Object.assign(merged, settings.per_ats_caps ?? {});
    setCaps(merged);
  };

  useEffect(() => { refresh().finally(() => setLoading(false)); }, []);

  useEffect(() => {
    if (!url) { setDetected(null); return; }
    const t = setTimeout(async () => {
      try { setDetected(await detectFn({ data: { url } })); } catch { setDetected(null); }
    }, 400);
    return () => clearTimeout(t);
  }, [url]);

  const handleAdd = async () => {
    if (!name || !url) return toast.error("Name and URL required");
    try {
      const r = await addFn({ data: { name, careers_url: url } });
      toast.success(r.detection.supported ? `Added · ${r.detection.platform}` : `Added but rejected: ${r.detection.reason}`);
      setName(""); setUrl(""); setDetected(null);
      refresh();
    } catch (e: any) { toast.error(e.message || "Failed to add"); }
  };

  const handleImport = async (id?: string) => {
    setImporting(true);
    try {
      const r = await importFn({ data: { ...(id ? { source_id: id } : {}), relaxed_mode: relaxed } });
      const t = r.totals;
      if (t.imported === 0 && t.manual_review === 0 && t.found > 0) {
        toast.warning(
          `0 imported · ${t.rejected} rejected · ${t.skipped} skipped. ` +
          `Open Rejection Debug below for the top reasons.`,
          { duration: 8000 }
        );
      } else {
        toast.success(`Import done · ${t.imported} new · ${t.manual_review} manual · ${t.duplicate} dupes · ${t.rejected} rejected · ${t.skipped} skipped`);
      }
      refresh();
    } catch (e: any) { toast.error(e.message || "Import failed"); }
    finally { setImporting(false); }
  };

  const handleDelete = async (id: string) => {
    try { await delFn({ data: { id } }); toast.success("Source removed"); refresh(); }
    catch (e: any) { toast.error(e.message); }
  };

  const handleMock = async () => {
    setMockBusy(true);
    try {
      const r = await mockFn();
      if (r.ok) toast.success(`Mock job inserted ✓ DB layer is healthy (id ${r.id?.slice(0, 8)}…)`);
      else toast.error(`Mock insert failed: ${r.error}`);
    } catch (e: any) { toast.error(e.message || "Mock failed"); }
    finally { setMockBusy(false); }
  };

  const toggleRelaxed = async (v: boolean) => {
    setRelaxed(v);
    try {
      await updateSettingsFn({ data: { relaxed_mode: v } });
      toast.success(v ? "Relaxed Mode on" : "Relaxed Mode off");
    } catch (e: any) { toast.error(e.message || "Failed to save"); setRelaxed(!v); }
  };

  const saveCaps = async () => {
    try {
      await updateSettingsFn({ data: { per_ats_caps: caps } });
      toast.success("ATS caps saved");
    } catch (e: any) { toast.error(e.message || "Failed to save caps"); }
  };

  // Aggregate rejection breakdown from latest import run.
  const latest = logs[0];
  const latestRejectBreakdown = useMemo(() => {
    const m: Record<string, number> = {};
    for (const l of logs.slice(0, sources.length || 1)) {
      const rb = (l?.details?.reject_breakdown ?? {}) as Record<string, number>;
      for (const [k, v] of Object.entries(rb)) m[k] = (m[k] ?? 0) + (v as number);
    }
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [logs, sources.length]);
  const latestRejectedDetails: any[] = useMemo(() => {
    const out: any[] = [];
    for (const l of logs.slice(0, sources.length || 1)) {
      for (const d of (l?.details?.rejected_details ?? [])) out.push(d);
      if (out.length >= 50) break;
    }
    return out.slice(0, 50);
  }, [logs, sources.length]);

  const latestTotals = useMemo(() => {
    const totals = { found: 0, imported: 0, manual_review: 0, duplicate: 0, rejected: 0, skipped: 0 };
    for (const l of logs.slice(0, sources.length || 1)) {
      totals.found += l.found ?? 0;
      totals.imported += l.imported ?? 0;
      totals.manual_review += l.manual_review ?? 0;
      totals.duplicate += l.duplicate ?? 0;
      totals.rejected += l.rejected ?? 0;
      totals.skipped += l.skipped ?? 0;
    }
    return totals;
  }, [logs, sources.length]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Job Sources</h1>
          <p className="text-sm text-muted-foreground">
            Greenhouse · Lever · Ashby · Breezy · Workday. Remote-friendly · Manual Review enforced.
          </p>
        </div>
        <Button onClick={() => handleImport()} disabled={importing || sources.length === 0}>
          {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          Import Jobs Now
        </Button>
      </div>

      {/* Relaxed Mode + ATS caps */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Import Filters
          </CardTitle>
          <CardDescription>
            Relaxed Mode routes uncertain matches to Manual Review instead of rejecting them.
            Per-ATS caps prevent any single platform from dominating one day's queue.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <div className="font-medium text-sm">Relaxed Mode</div>
              <p className="text-xs text-muted-foreground">
                Allow missing salary, hybrid/onsite high-match roles, and adjacent titles
                (Operations Analyst, Customer Success Ops, Program Coordinator, Implementation Specialist, Product Support).
                Uncertain matches → Manual Review instead of reject.
              </p>
            </div>
            <Switch checked={relaxed} onCheckedChange={toggleRelaxed} />
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            {ATS_LIST.map((a) => (
              <div key={a.key}>
                <Label className="text-xs">{a.label}</Label>
                <Input
                  type="number"
                  min={0}
                  max={500}
                  value={caps[a.key] ?? a.defaultCap}
                  onChange={(e) => setCaps((c) => ({ ...c, [a.key]: Number(e.target.value) }))}
                />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={handleMock} disabled={mockBusy}>
              {mockBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-2 h-4 w-4" />}
              Insert Mock Test Job
            </Button>
            <Button size="sm" onClick={saveCaps}>Save Caps</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Add a careers page</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <Label>Company name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Inc" />
            </div>
            <div>
              <Label>Careers URL</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://boards.greenhouse.io/acme" />
            </div>
          </div>
          {detected && (
            <div className={`flex items-center gap-2 text-sm ${detected.supported ? "text-emerald-600" : "text-destructive"}`}>
              {detected.supported ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
              Detected: <Badge variant={detected.supported ? "default" : "destructive"}>{detected.platform}</Badge>
              {detected.reason && <span className="text-muted-foreground">— {detected.reason}</span>}
            </div>
          )}
          <Button onClick={handleAdd} disabled={!name || !url}>
            <Plus className="mr-2 h-4 w-4" /> Add Source
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Sources ({sources.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : sources.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sources yet. Add a Greenhouse, Lever, Ashby, Breezy, or Workday careers URL above.</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Company</TableHead><TableHead>ATS</TableHead><TableHead>Status</TableHead>
                <TableHead>Last Import</TableHead><TableHead>Imported</TableHead><TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {sources.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <div className="font-medium">{s.name}</div>
                      <a href={s.careers_url} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:underline">{s.careers_url}</a>
                    </TableCell>
                    <TableCell><Badge variant="outline">{s.ats || "—"}</Badge></TableCell>
                    <TableCell>
                      <Badge variant={s.status === "active" ? "default" : "destructive"}>{s.status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {s.last_imported_at ? new Date(s.last_imported_at).toLocaleString() : "Never"}
                    </TableCell>
                    <TableCell>{s.last_import_count ?? 0}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => handleImport(s.id)} disabled={importing || s.status !== "active"}>
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(s.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Rejected Jobs Debug */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bug className="h-4 w-4 text-amber-600" /> Rejected Jobs Debug
          </CardTitle>
          <CardDescription>
            Last import totals + top rejection reasons. Use this when "Found" is high but "Imported" is low.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
            {([
              ["Found", latestTotals.found, "text-foreground"],
              ["Imported", latestTotals.imported, "text-emerald-600"],
              ["Manual", latestTotals.manual_review, "text-amber-600"],
              ["Duplicates", latestTotals.duplicate, "text-muted-foreground"],
              ["Rejected", latestTotals.rejected, "text-destructive"],
              ["Skipped", latestTotals.skipped, "text-muted-foreground"],
            ] as const).map(([label, val, cls]) => (
              <div key={label} className="rounded-md border p-3 text-center">
                <div className="text-[10px] uppercase text-muted-foreground tracking-wide">{label}</div>
                <div className={`text-lg font-semibold ${cls}`}>{val}</div>
              </div>
            ))}
          </div>

          {latest?.message && latestTotals.imported === 0 && latestTotals.found > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300/40 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>{latest.message}</div>
            </div>
          )}

          {latestRejectBreakdown.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rejection data yet. Run an import to populate.</p>
          ) : (
            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Top rejection reasons
              </div>
              <div className="flex flex-wrap gap-2">
                {latestRejectBreakdown.slice(0, 8).map(([reason, count]) => (
                  <Badge key={reason} variant="outline" className="font-mono text-xs">
                    {reason} · {count}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {latestRejectedDetails.length > 0 && (
            <div className="rounded-md border">
              <div className="border-b px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Recent rejected jobs ({latestRejectedDetails.length})
              </div>
              <div className="max-h-72 overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>ATS</TableHead>
                      <TableHead>Filter</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {latestRejectedDetails.map((d, i) => (
                      <TableRow key={i}>
                        <TableCell className="max-w-[200px] truncate">
                          <a href={d.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{d.title}</a>
                        </TableCell>
                        <TableCell className="text-xs">{d.company}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{d.ats}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{d.filter}</TableCell>
                        <TableCell className="font-mono text-xs">{d.reason}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Import Logs</CardTitle></CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No import runs yet.</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>When</TableHead><TableHead>ATS</TableHead><TableHead>Found</TableHead>
                <TableHead>Imported</TableHead><TableHead>Manual</TableHead><TableHead>Dupes</TableHead>
                <TableHead>Rejected</TableHead><TableHead>Skipped</TableHead><TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {logs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs">{new Date(l.created_at).toLocaleString()}</TableCell>
                    <TableCell><Badge variant="outline">{l.ats}</Badge></TableCell>
                    <TableCell>{l.found}</TableCell>
                    <TableCell className="text-emerald-600">{l.imported}</TableCell>
                    <TableCell className="text-amber-600">{l.manual_review}</TableCell>
                    <TableCell>{l.duplicate}</TableCell>
                    <TableCell className="text-destructive">{l.rejected}</TableCell>
                    <TableCell>{l.skipped}</TableCell>
                    <TableCell>
                      {l.success ? <Badge>OK</Badge> : <Badge variant="destructive" title={l.message}>Failed</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
