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
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
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
      { title: "Job App" },
      { name: "description", content: "Career Command is an AI-powered platform that streamlines remote job applications for professionals." },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "Job App" },
      { property: "og:description", content: "Career Command is an AI-powered platform that streamlines remote job applications for professionals." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "Job App" },
      { name: "twitter:description", content: "Career Command is an AI-powered platform that streamlines remote job applications for professionals." },
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
    path === "/reset-password" ||
    path === "/admin-recovery" ||
    path === "/case-study"
  ) {
    return (
      <QueryClientProvider client={queryClient}>
        <AuthGate><Outlet /></AuthGate>
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
                <div className="text-xs text-muted-foreground hidden sm:block">
                  khalilhickson.com · Remote-first
                </div>
              </header>
              <main className="flex-1 min-w-0">
                <Outlet />
              </main>
            </div>
          </div>
          <Toaster />
        </SidebarProvider>
      </AuthGate>
    </QueryClientProvider>
  );
}
