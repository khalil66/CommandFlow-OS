import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus, Download, Trash2, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  listJobSources, addJobSource, deleteJobSource,
  importJobsNow, listImportLogs, detectAtsFromUrl,
} from "@/lib/ingest.functions";

export const Route = createFileRoute("/sources")({ component: SourcesPage });

function SourcesPage() {
  const listFn = useServerFn(listJobSources);
  const addFn = useServerFn(addJobSource);
  const delFn = useServerFn(deleteJobSource);
  const importFn = useServerFn(importJobsNow);
  const logsFn = useServerFn(listImportLogs);
  const detectFn = useServerFn(detectAtsFromUrl);

  const [sources, setSources] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [detected, setDetected] = useState<any>(null);

  const refresh = async () => {
    const [s, l] = await Promise.all([listFn(), logsFn()]);
    setSources(s.sources); setLogs(l.logs);
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
      const r = await importFn({ data: id ? { source_id: id } : {} });
      const t = r.totals;
      toast.success(`Import done · ${t.imported} new · ${t.manual_review} manual · ${t.duplicate} dupes · ${t.rejected} rejected · ${t.skipped} skipped`);
      refresh();
    } catch (e: any) { toast.error(e.message || "Import failed"); }
    finally { setImporting(false); }
  };

  const handleDelete = async (id: string) => {
    try { await delFn({ data: { id } }); toast.success("Source removed"); refresh(); }
    catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Job Sources</h1>
          <p className="text-sm text-muted-foreground">
            Greenhouse · Lever · Ashby · Breezy. Remote-only · ${'>'}$55K · Manual Review enforced.
          </p>
        </div>
        <Button onClick={() => handleImport()} disabled={importing || sources.length === 0}>
          {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          Import Jobs Now
        </Button>
      </div>

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
            <p className="text-sm text-muted-foreground">No sources yet. Add a Greenhouse, Lever, Ashby, or Breezy careers URL above.</p>
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
