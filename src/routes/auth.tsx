import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

import { toast } from "sonner";
import { Briefcase } from "lucide-react";

export const Route = createFileRoute("/auth")({ component: AuthPage });

function AuthPage() {
  const nav = useNavigate();
  const location = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [resetSending, setResetSending] = useState(false);
  const [debugInfo, setDebugInfo] = useState<{ email: string; redirectTo: string; error?: any; data?: any } | null>(null);
  const isDev = import.meta.env.DEV;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) nav({ to: "/" });
    });
  }, [nav]);

  const signIn = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Signed in");
    nav({ to: "/" });
  };

  const sendReset = async () => {
    if (!email) return toast.error("Enter your email address.");
    setResetSending(true);
    const redirectTo = `${window.location.origin}/reset-password`;
    const response = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    const { data, error } = response;
    setResetSending(false);

    // Always log full response for debugging
    console.log("[resetPasswordForEmail]", { email, redirectTo, data, error });
    setDebugInfo({ email, redirectTo, error, data });

    if (error) {
      const msg = (error.message || "").toLowerCase();
      const status = (error as any).status;
      let friendly = error.message;
      if (status === 429 || msg.includes("rate limit")) {
        friendly = "Reset email rate limit reached. Try again later.";
      } else if (msg.includes("redirect") && (msg.includes("not allowed") || msg.includes("invalid"))) {
        friendly = "Redirect URL is not allowed in Auth settings.";
      } else if (msg.includes("smtp") || msg.includes("email") && msg.includes("send")) {
        friendly = "Email delivery error. Try again later.";
      } else if (msg.includes("not found") || msg.includes("user")) {
        friendly = "Email address not found or not registered.";
      }
      // In production, avoid user enumeration: show generic success regardless
      if (!isDev) {
        toast.success("If that email exists, a reset link has been sent. Check spam/promotions.");
        setShowForgot(false);
      } else {
        toast.error(friendly);
      }
      return;
    }

    toast.success("Reset link sent. Check spam/promotions — it may take a few minutes.");
    setShowForgot(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent text-accent-foreground">
              <Briefcase className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Apply Command</CardTitle>
              <p className="text-xs text-muted-foreground">Sign in to access your job pipeline</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {(location as any)?.message && (
            <div className="rounded-md bg-primary/10 px-3 py-2 text-sm text-primary">
              {(location as any).message}
            </div>
          )}
          {showForgot ? (
            <>
              <div>
                <Label className="text-xs">Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <Button onClick={sendReset} disabled={resetSending} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
                {resetSending ? "Sending…" : "Send reset link"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Check spam/promotions. Reset links may take a few minutes to arrive.
              </p>
              {isDev && debugInfo && (
                <div className="rounded-md border border-border bg-muted/40 p-2 text-[10px] font-mono space-y-1 break-all">
                  <div><span className="text-muted-foreground">email:</span> {debugInfo.email}</div>
                  <div><span className="text-muted-foreground">redirectTo:</span> {debugInfo.redirectTo}</div>
                  {debugInfo.error ? (
                    <div className="text-destructive">
                      error: {debugInfo.error.name} · status {(debugInfo.error as any).status ?? "?"} · {debugInfo.error.message}
                    </div>
                  ) : (
                    <div className="text-primary">no error returned</div>
                  )}
                </div>
              )}
              <button
                type="button"
                onClick={() => setShowForgot(false)}
                className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
              >
                Back to sign in
              </button>
            </>
          ) : (
            <>
              <div><Label className="text-xs">Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
              <div><Label className="text-xs">Password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
              <Button onClick={signIn} disabled={loading} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">Sign in</Button>
              <div className="flex justify-center pt-1">
                <button
                  type="button"
                  onClick={() => setShowForgot(true)}
                  className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                >
                  Forgot password?
                </button>
              </div>
              <p className="text-xs text-muted-foreground text-center pt-2">
                Single-admin workspace. Public sign-up is disabled.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
