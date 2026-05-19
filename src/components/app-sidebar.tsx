import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, Search, ShieldCheck, Filter, FileText,
  ListChecks, AlertTriangle, BarChart3, Settings, Briefcase,
  Building2, CalendarDays, Sparkles, BellRing, Download, Activity, Compass, BookOpen, Zap,
  KanbanSquare, Users, FileDiff, Brain,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter,
} from "@/components/ui/sidebar";

const nav = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Smart Apply", url: "/smart-apply", icon: Zap },
  { title: "High-Probability", url: "/high-probability", icon: Sparkles },
  { title: "Job Queue", url: "/queue", icon: Search },
  { title: "Job Sources", url: "/sources", icon: Download },
  { title: "Companies", url: "/companies", icon: Building2 },
  { title: "Daily Batches", url: "/batches", icon: CalendarDays },
  { title: "Follow-Ups", url: "/follow-ups", icon: BellRing },
  { title: "Legitimacy Checker", url: "/legitimacy", icon: ShieldCheck },
  { title: "ATS Filter", url: "/ats", icon: Filter },
  { title: "Resume Studio", url: "/resume", icon: FileText },
  { title: "Resume Diff", url: "/resume-diff", icon: FileDiff },
  { title: "Company Intelligence", url: "/company-intelligence", icon: Brain },
  { title: "Application Tracker", url: "/tracker", icon: ListChecks },
  { title: "CRM Pipeline", url: "/pipeline", icon: KanbanSquare },
  { title: "Recruiters", url: "/recruiters", icon: Users },
  { title: "Manual Review", url: "/review", icon: AlertTriangle },
  { title: "Safe Auto-Submit", url: "/safe-auto-submit", icon: ShieldCheck },
  { title: "Analytics", url: "/analytics", icon: BarChart3 },
  { title: "System Health", url: "/system", icon: Activity },
  { title: "Monitoring", url: "/monitoring", icon: Activity },
  { title: "Onboarding", url: "/onboarding", icon: Compass },
  { title: "Case Study", url: "/case-study", icon: BookOpen },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <div className="flex items-center gap-2 px-2 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent text-accent-foreground">
            <Briefcase className="h-5 w-5" />
          </div>
          <div className="flex flex-col group-data-[collapsible=icon]:hidden">
            <span className="text-sm font-semibold text-sidebar-foreground">Apply Command</span>
            <span className="text-xs text-sidebar-foreground/60">Khalil Hickson</span>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={path === item.url}>
                    <Link to={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border">
        <div className="px-3 py-2 text-xs text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden">
          Jacksonville, FL · v0.1
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
