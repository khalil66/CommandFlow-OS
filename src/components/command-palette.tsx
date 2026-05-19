import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty,
  CommandGroup, CommandItem, CommandSeparator, CommandShortcut,
} from "@/components/ui/command";
import {
  LayoutDashboard, PlayCircle, FileText, BarChart3, Activity, ShieldCheck,
  ListChecks, Trophy, Layers, Workflow, Sparkles, Building2, Briefcase,
  ArrowRight, BellRing, Pause, Rocket, BookOpen, Globe,
} from "lucide-react";
import { startGuidedTour } from "@/components/guided-tour";

type ActionItem = {
  id: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords?: string;
  run: (ctx: { navigate: ReturnType<typeof useNavigate>; close: () => void }) => void;
};

const NAV: ActionItem[] = [
  { id: "nav-sandbox", label: "Open Sandbox", hint: "Public live demo", icon: PlayCircle, keywords: "public demo simulation", run: ({ navigate }) => navigate({ to: "/sandbox" }) },
  { id: "nav-demo", label: "Open Demo", hint: "Recruiter walkthrough", icon: Briefcase, keywords: "recruiter walkthrough mock", run: ({ navigate }) => navigate({ to: "/demo" }) },
  { id: "nav-case", label: "Open Case Study", hint: "Architecture & decisions", icon: BookOpen, keywords: "case study writeup architecture", run: ({ navigate }) => navigate({ to: "/case-study" }) },
  { id: "nav-portfolio", label: "Open Portfolio", hint: "Project overview", icon: Globe, keywords: "portfolio overview index", run: ({ navigate }) => navigate({ to: "/portfolio" }) },
  { id: "nav-executive", label: "Open Executive Dashboard", hint: "KPIs · trends · activity", icon: Trophy, keywords: "executive kpi analytics command center", run: ({ navigate }) => navigate({ to: "/executive" }) },
  { id: "nav-monitoring", label: "Open Monitoring", hint: "System health · logs", icon: Activity, keywords: "monitoring health uptime logs", run: ({ navigate }) => navigate({ to: "/monitoring" }) },
  { id: "nav-smart-apply", label: "Open Smart Apply", hint: "Auto-review & queue", icon: Sparkles, keywords: "smart apply automation", run: ({ navigate }) => navigate({ to: "/smart-apply" }) },
  { id: "nav-review", label: "Open Manual Review", hint: "Packets awaiting approval", icon: ListChecks, keywords: "manual review queue packets", run: ({ navigate }) => navigate({ to: "/review" }) },
  { id: "nav-outcomes", label: "Open Outcomes", hint: "Recruiter replies · interviews", icon: BarChart3, keywords: "outcomes learning conversion", run: ({ navigate }) => navigate({ to: "/outcomes" }) },
  { id: "nav-variants", label: "Open Resume Variants", hint: "A/B resume tracking", icon: Layers, keywords: "resume variants ab test", run: ({ navigate }) => navigate({ to: "/resume-variants" }) },
  { id: "nav-analytics", label: "Open Analytics", hint: "Funnel · ATS · categories", icon: BarChart3, keywords: "analytics charts funnel", run: ({ navigate }) => navigate({ to: "/analytics" }) },
  { id: "nav-engagement", label: "Open Recruiter Engagement", hint: "Visits · CTAs · tour completion", icon: Activity, keywords: "engagement recruiter visits cta tour analytics privacy", run: ({ navigate }) => navigate({ to: "/engagement" }) },
];

const QUICK: ActionItem[] = [
  { id: "q-smart-apply", label: "Run Smart Apply", hint: "Open Smart Apply runner", icon: Rocket, keywords: "run smart apply trigger", run: ({ navigate }) => navigate({ to: "/smart-apply" }) },
  { id: "q-dry-run", label: "Run Dry Run", hint: "Safe Auto-Submit preview", icon: ShieldCheck, keywords: "dry run safe auto submit preview", run: ({ navigate }) => navigate({ to: "/safe-auto-submit" }) },
  { id: "q-pause", label: "Pause Automation", hint: "Safe Auto-Submit controls", icon: Pause, keywords: "pause stop automation kill switch", run: ({ navigate }) => navigate({ to: "/safe-auto-submit" }) },
  { id: "q-followups", label: "Open Follow-Ups", hint: "Recruiter nudges queue", icon: BellRing, keywords: "follow ups recruiter nudges", run: ({ navigate }) => navigate({ to: "/follow-ups" }) },
  { id: "q-architecture", label: "Open Architecture", hint: "System diagram", icon: Workflow, keywords: "architecture diagram system", run: ({ navigate }) => navigate({ to: "/sandbox", hash: "architecture" }) },
  { id: "q-companies", label: "Open Companies", hint: "Verified company intel", icon: Building2, keywords: "companies trust intelligence", run: ({ navigate }) => navigate({ to: "/companies" }) },
  { id: "q-tour", label: "Start Guided Tour", hint: "On current page", icon: PlayCircle, keywords: "guided tour walkthrough", run: ({ close }) => { close(); startGuidedTour(); } },
];

/**
 * Global Cmd/Ctrl+K command palette. Mount once at the root.
 * Premium spotlight blur, fuzzy search (via cmdk), grouped categories.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const close = () => setOpen(false);
  const renderGroup = (heading: string, items: ActionItem[]) => (
    <CommandGroup heading={heading}>
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <CommandItem
            key={it.id}
            value={`${it.label} ${it.hint ?? ""} ${it.keywords ?? ""}`}
            onSelect={() => { it.run({ navigate, close }); setOpen(false); }}
            className="gap-3"
            aria-label={it.label}
          >
            <Icon className="h-4 w-4 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{it.label}</div>
              {it.hint && <div className="text-xs text-muted-foreground truncate">{it.hint}</div>}
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/70" />
          </CommandItem>
        );
      })}
    </CommandGroup>
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search actions, pages, shortcuts…" aria-label="Search commands" />
      <CommandList className="max-h-[60vh]">
        <CommandEmpty>No commands match.</CommandEmpty>
        {renderGroup("Navigate", NAV)}
        <CommandSeparator />
        {renderGroup("Quick actions", QUICK)}
        <CommandSeparator />
        <div className="px-3 py-2 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>↑ ↓ to navigate · ↵ to open · esc to close</span>
          <span className="hidden sm:inline">
            <CommandShortcut>⌘K</CommandShortcut>
          </span>
        </div>
      </CommandList>
    </CommandDialog>
  );
}
