import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-lg text-center">
        <div className="text-[88px] font-bold leading-none bg-gradient-to-br from-primary to-accent bg-clip-text text-transparent">
          404
        </div>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          This page doesn't exist
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">
          The page you're looking for has moved or was never published. Explore the platform from one of the entry points below.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-2">
          <Link
            to="/portfolio"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Back to Portfolio
          </Link>
          <Link
            to="/sandbox"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            View Sandbox
          </Link>
          <Link
            to="/case-study"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Read Case Study
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  const nav = useNavigate();
  const msg = (error?.message ?? "").toLowerCase();
  const isUnauthorized = msg.includes("unauthorized") || msg.includes("no authorization header");

  useEffect(() => {
    if (isUnauthorized && typeof window !== "undefined" && !window.location.pathname.startsWith("/auth")) {
      nav({ to: "/auth", replace: true });
    }
  }, [isUnauthorized, nav]);

  if (isUnauthorized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Please sign in</h1>
          <p className="mt-2 text-sm text-muted-foreground">Your session has expired. Sign in to continue.</p>
          <div className="mt-6">
            <Link to="/auth" className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
              Go to sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "CommandFlowOS — AI-Powered Career Operating System" },
      {
        name: "description",
        content:
          "CommandFlowOS combines verified job intelligence, resume optimization, recruiter CRM workflows, outcome learning, and safe automation into one career operations platform.",
      },
      {
        name: "keywords",
        content:
          "AI recruiting, applicant tracking, resume intelligence, recruiter CRM, ATS analytics, job search automation, interview probability, career operations",
      },
      { name: "author", content: "Khalil Hickson" },
      { name: "theme-color", content: "#0f172a" },
      { property: "og:site_name", content: "CommandFlowOS" },
      { property: "og:title", content: "CommandFlowOS — AI-Powered Career Operating System" },
      {
        property: "og:description",
        content:
          "Verified ATS intelligence, resume optimization, recruiter CRM, and outcome learning in one operator-grade platform.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "CommandFlowOS — AI-Powered Career Operating System" },
      {
        name: "twitter:description",
        content:
          "Verified ATS intelligence, resume optimization, recruiter CRM, and outcome learning in one operator-grade platform.",
      },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/a974744a-c3b2-41cd-bf36-073f5ffd6459/id-preview-a5c326a0--e3d15bed-bdda-4965-9151-a59c323e34ae.lovable.app-1778830218046.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/a974744a-c3b2-41cd-bf36-073f5ffd6459/id-preview-a5c326a0--e3d15bed-bdda-4965-9151-a59c323e34ae.lovable.app-1778830218046.png" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function AuthGate({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const path = useRouterState({ select: (r) => r.location.pathname });
  const [ready, setReady] = useState(false);
  const isPublic =
    path === "/auth" ||
    path === "/demo" ||
    path === "/sandbox" ||
    path === "/portfolio" ||
    path === "/reset-password" ||
    path === "/admin-recovery" ||
    path === "/case-study";
  useEffect(() => {
    let active = true;
    if (!isPublic) setReady(false);

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (!data.session?.access_token) {
        setReady(isPublic);
        if (!isPublic) nav({ to: "/auth", replace: true });
        return;
      }
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!active) return;
      if (!session?.access_token) {
        setReady(isPublic);
        if (!isPublic) nav({ to: "/auth", replace: true });
        return;
      }
      setReady(true);
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, [path, nav, isPublic]);
  if (isPublic) return <>{children}</>;
  if (!ready) return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  return <>{children}</>;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const path = useRouterState({ select: (r) => r.location.pathname });

  if (
    path === "/auth" ||
    path === "/demo" ||
    path === "/sandbox" ||
    path === "/portfolio" ||
    path === "/reset-password" ||
    path === "/admin-recovery" ||
    path === "/case-study"
  ) {
    return (
      <QueryClientProvider client={queryClient}>
        <AuthGate><Outlet /></AuthGate>
        <CommandPalette />
        <Toaster />
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate>
        <SidebarProvider>
          <div className="min-h-screen flex w-full bg-background">
            <AppSidebar />
            <div className="flex-1 flex flex-col min-w-0">
              <header className="h-14 flex items-center gap-3 border-b border-border bg-card px-4 sticky top-0 z-10">
                <SidebarTrigger />
                <div className="flex-1" />
                <button
                  onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
                  className="hidden md:inline-flex items-center gap-2 text-xs text-muted-foreground border border-border rounded-md px-2.5 py-1.5 hover:bg-accent hover:text-accent-foreground transition-colors"
                  aria-label="Open command palette"
                >
                  <span>Search…</span>
                  <kbd className="text-[10px] border rounded px-1 py-0.5">⌘K</kbd>
                </button>
                <div className="text-xs text-muted-foreground hidden sm:block">
                  khalilhickson.com · Remote-first
                </div>
              </header>
              <main className="flex-1 min-w-0">
                <Outlet />
              </main>
            </div>
          </div>
          <CommandPalette />
          <Toaster />
        </SidebarProvider>
      </AuthGate>
    </QueryClientProvider>
  );
}
