import { pageMetadata } from "@/lib/page-metadata";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { getVariantStats, seedResumeVariants, suggestVariantForJob, pickABVariant } from "@/lib/resume-variants.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Sparkles, TrendingUp, Trophy, Calendar, Layers } from "lucide-react";
import { EmptyChart } from "@/components/chart-card";

export const Route = createFileRoute("/resume-variants")({
  head: () => pageMetadata("Resume Variant Optimizer", "Resume Variant Optimizer for CommandFlow OS recruiting operations, with private account access and manual application approval."),
  component: ResumeVariantsPage,
});

function ResumeVariantsPage() {
  const stats = useServerFn(getVariantStats);
  const seed = useServerFn(seedResumeVariants);
  const suggest = useServerFn(suggestVariantForJob);
  const ab = useServerFn(pickABVariant);

  const q = useQuery({ queryKey: ["variant-stats"], queryFn: () => stats() });
  const seedMut = useMutation({
    mutationFn: () => seed(),
    onSuccess: (r) => {
      toast.success(`Seeded ${r.inserted}/${r.total_variants} variants`);
      q.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [roleCat, setRoleCat] = useState("");
  const [title, setTitle] = useState("");
  const suggestMut = useMutation({
    mutationFn: () => suggest({ data: { role_category: roleCat || null, title: title || null } }),
  });
  const abMut = useMutation({
    mutationFn: () => ab({ data: { role_category: roleCat || null, title: title || null } }),
  });

  const variants = q.data?.variants ?? [];
  const withApps = variants.filter((v) => v.applications > 0);

  const bestResponse = [...withApps].sort((a, b) => b.response_rate - a.response_rate)[0];
  const bestInterview = [...withApps].sort((a, b) => b.interview_rate - a.interview_rate)[0];
  const bestConversion = [...withApps].sort((a, b) => b.interview_conversion - a.interview_conversion)[0];
  const recommended = bestInterview ?? bestResponse ?? variants[0];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">Resume Variant Optimizer</h1>
          <p className="text-muted-foreground">Track each variant's performance and route jobs to the highest-converting resume.</p>
        </div>
        <Button onClick={() => seedMut.mutate()} disabled={seedMut.isPending}>
          {seedMut.isPending ? "Seeding…" : "Seed canonical variants"}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard icon={<Trophy className="h-4 w-4" />} title="Best Resume Variant" value={bestInterview?.label ?? "—"}
          sub={bestInterview ? `${bestInterview.interview_rate}% interview rate` : "No data yet"} />
        <StatCard icon={<TrendingUp className="h-4 w-4" />} title="Highest Response Variant" value={bestResponse?.label ?? "—"}
          sub={bestResponse ? `${bestResponse.response_rate}% reply rate` : "No data yet"} />
        <StatCard icon={<Sparkles className="h-4 w-4" />} title="Best Interview Conversion" value={bestConversion?.label ?? "—"}
          sub={bestConversion ? `${bestConversion.interview_conversion}% reply→interview` : "No data yet"} />
        <StatCard icon={<Calendar className="h-4 w-4" />} title="Recommended This Week" value={recommended?.label ?? "—"}
          sub={recommended ? `${recommended.applications} apps tracked` : "Seed variants to start"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Variant performance</CardTitle>
          <CardDescription>Apps sent, recruiter replies, interviews, rejections, ghosting, and offers per variant.</CardDescription>
        </CardHeader>
        <CardContent>
          {variants.length === 0 ? (
            <EmptyChart
              title="Resume variants haven't been seeded yet"
              hint="Seed the canonical variants (CSM, RevOps, PM, AI/Automation, Data) to start tracking which resume wins per role."
              why="Variant tracking is what lets the platform say 'use the RevOps resume for Salesforce-ATS jobs' instead of guessing."
              sample="bars"
              icon={Layers}
              ctas={[
                { label: "Start Demo", to: "/demo" },
                { label: "Explore Sandbox", to: "/sandbox", variant: "outline" },
              ]}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Variant</TableHead>
                  <TableHead className="text-right">Apps</TableHead>
                  <TableHead className="text-right">Replies</TableHead>
                  <TableHead className="text-right">Interviews</TableHead>
                  <TableHead className="text-right">Rejected</TableHead>
                  <TableHead className="text-right">Ghosted</TableHead>
                  <TableHead className="text-right">Offers</TableHead>
                  <TableHead className="text-right">Reply %</TableHead>
                  <TableHead className="text-right">Interview %</TableHead>
                  <TableHead className="text-right">Reply→Interview %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {variants.map((v) => (
                  <TableRow key={v.variant_key}>
                    <TableCell className="font-medium">{v.label}</TableCell>
                    <TableCell className="text-right">{v.applications}</TableCell>
                    <TableCell className="text-right">{v.recruiter_replies}</TableCell>
                    <TableCell className="text-right">{v.interviews}</TableCell>
                    <TableCell className="text-right">{v.rejections}</TableCell>
                    <TableCell className="text-right">{v.ghosted}</TableCell>
                    <TableCell className="text-right">{v.offers}</TableCell>
                    <TableCell className="text-right">{v.response_rate}%</TableCell>
                    <TableCell className="text-right">{v.interview_rate}%</TableCell>
                    <TableCell className="text-right">{v.interview_conversion}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Variant selector + A/B test</CardTitle>
          <CardDescription>Enter a role category or title to see which variant the optimizer would pick.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Input placeholder="Role category (e.g. customer_success)" value={roleCat} onChange={(e) => setRoleCat(e.target.value)} />
            <Input placeholder="Job title (e.g. Senior CSM)" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button onClick={() => suggestMut.mutate()} disabled={suggestMut.isPending}>Suggest variant</Button>
            <Button variant="outline" onClick={() => abMut.mutate()} disabled={abMut.isPending}>Pick A/B variant</Button>
          </div>
          {suggestMut.data && (
            <div className="rounded-md border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Badge>Recommended: {suggestMut.data.label}</Badge>
                {suggestMut.data.outcome_override && <Badge variant="secondary">Outcome override</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">{suggestMut.data.reason}</p>
            </div>
          )}
          {abMut.data && (
            <div className="rounded-md border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Badge>A/B pick: {abMut.data.label}</Badge>
                <Badge variant="secondary">{abMut.data.mode === "winner_locked" ? "Winner locked" : "Rotating"}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Comparing <strong>{abMut.data.baseline}</strong> vs <strong>{abMut.data.alternative}</strong>.{" "}
                {abMut.data.mode === "winner_locked"
                  ? "Sample size reached; locking on highest interview rate."
                  : "Rotating between candidates until each has 8+ apps."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon, title, value, sub }: { icon: React.ReactNode; title: string; value: string; sub: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2 text-muted-foreground">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground mt-1">{sub}</p>
      </CardContent>
    </Card>
  );
}
