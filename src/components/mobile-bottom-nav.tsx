import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard, ListChecks, BarChart3, Sparkles, Trophy,
} from "lucide-react";

const TABS = [
  { to: "/" as const, label: "Home", icon: LayoutDashboard },
  { to: "/smart-apply" as const, label: "Apply", icon: Sparkles },
  { to: "/review" as const, label: "Review", icon: ListChecks },
  { to: "/outcomes" as const, label: "Outcomes", icon: BarChart3 },
  { to: "/executive" as const, label: "Exec", icon: Trophy },
];

/**
 * Native-feeling bottom navigation for the authenticated dashboard on phones.
 * Hidden on md+ where the sidebar is visible.
 */
export function MobileBottomNav() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  return (
    <nav
      aria-label="Primary"
      className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-border bg-card/90 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="grid grid-cols-5">
        {TABS.map((t) => {
          const active = path === t.to || (t.to !== "/" && path.startsWith(t.to));
          const Icon = t.icon;
          return (
            <li key={t.to}>
              <Link
                to={t.to}
                aria-label={t.label}
                aria-current={active ? "page" : undefined}
                className={
                  "flex flex-col items-center justify-center gap-0.5 py-2.5 min-h-12 transition-colors " +
                  (active
                    ? "text-emerald-500"
                    : "text-muted-foreground hover:text-foreground active:scale-95")
                }
              >
                <Icon className="h-5 w-5" />
                <span className="text-[10px] font-medium tracking-wide">{t.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
