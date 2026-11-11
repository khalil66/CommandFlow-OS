import { pageMetadata } from "@/lib/page-metadata";
import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle } from "lucide-react";

export const Route = createFileRoute("/ats")({
  head: () => pageMetadata("ATS Compatibility", "ATS Compatibility for CommandFlow OS recruiting operations, with private account access and manual application approval."), component: ATSPage });

const supported = [
  { name: "Greenhouse", note: "Boards.greenhouse.io · Fully automatable" },
  { name: "Lever", note: "Jobs.lever.co · Fully automatable" },
  { name: "Ashby", note: "Jobs.ashbyhq.com · Fully automatable" },
  { name: "Breezy HR", note: "*.breezy.hr · Fully automatable" },
];
const blocked = [
  { name: "Workday", note: "Anti-bot, MFA, account creation" },
  { name: "Taleo", note: "Legacy flows, frequent CAPTCHAs" },
  { name: "SAP SuccessFactors", note: "Login walls, complex multi-page forms" },
  { name: "iCIMS", note: "Fingerprinting, account-required" },
];

function ATSPage() {
  return (
    <div className="p-6 space-y-6 max-w-[1100px] mx-auto">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">ATS Filter</h1>
        <p className="text-sm text-muted-foreground mt-1">Only frictionless, automation-friendly platforms reach the apply queue.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-success">
              <CheckCircle2 className="h-5 w-5" /> Supported
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {supported.map(s => (
              <div key={s.name} className="p-3 rounded-md border border-success/30 bg-success/5">
                <div className="font-medium text-sm">{s.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{s.note}</div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-destructive">
              <XCircle className="h-5 w-5" /> Auto-rejected
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {blocked.map(s => (
              <div key={s.name} className="p-3 rounded-md border border-destructive/30 bg-destructive/5">
                <div className="font-medium text-sm">{s.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{s.note}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Application difficulty rules</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div className="p-3 rounded-md bg-success/10 border border-success/20">
            <div className="font-medium text-success">Easy</div>
            <div className="text-xs text-muted-foreground mt-1">Single-page form, no login, ≤ 6 fields</div>
          </div>
          <div className="p-3 rounded-md bg-warning/10 border border-warning/20">
            <div className="font-medium text-warning-foreground">Medium</div>
            <div className="text-xs text-muted-foreground mt-1">Multi-step form, optional questionnaire</div>
          </div>
          <div className="p-3 rounded-md bg-destructive/10 border border-destructive/20">
            <div className="font-medium text-destructive">Hard</div>
            <div className="text-xs text-muted-foreground mt-1">Long-form essays, video, take-home assessment</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
