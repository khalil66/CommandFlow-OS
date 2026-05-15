import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Briefcase } from "lucide-react";

export const Route = createFileRoute("/auth")({ component: AuthPage });

type DebugState = {
  action: string;
  email: string;
  redirectTo?: string;
  data?: any;
  error?: { name?: string; message?: string; status?: any } | null;
} | null;

function AuthPage() {
  const nav = useNavigate();
  const location = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [debug, setDebug] = useState<DebugState>(null);
  const isDev = import.meta.env.DEV;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) nav({ to: "/" });
    });
  }, [nav]);

  const captureErr = (e: any) =>
    e ? { name: e.name, message: e.message, status: e.status } : null;

  const signIn = async () => {
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    setDebug({ action: "signInWithPassword", email, data, error: captureErr(error) });
    if (error) return toast.error(error.message);
    toast.success("Signed in");
    nav({ to: "/" });
  };

  const signUp = async () => {
    setLoading(true);
    const redirectTo = `${window.location.origin}/`;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: redirectTo },
    });
    setLoading(false);
    setDebug({ action: "signUp", email, redirectTo, data, error: captureErr(error) });
    if (error) return toast.error(error.message);
    if (data.session) {
      toast.success("Account created. Signed in.");
      nav({ to: "/" });
    } else {
      toast.success("Account created. Check your email if confirmation is required.");
    }
  };

  const sendReset = async () => {
    if (!email) return toast.error("Enter your email address.");
    setLoading(true);
    const redirectTo = `${window.location.origin}/reset-password`;
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    setLoading(false);
    setDebug({ action: "resetPasswordForEmail", email, redirectTo, data, error: captureErr(error) });
    if (error) return toast.error(error.message);
    toast.success("Reset link sent. Check spam/promotions.");
    setMode("signin");
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
              <p className="text-xs text-muted-foreground">
                {mode === "signup" ? "Create your account" : mode === "forgot" ? "Reset your password" : "Sign in to access your job pipeline"}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {(location as any)?.message && (
            <div className="rounded-md bg-primary/10 px-3 py-2 text-sm text-primary">
              {(location as any).message}
            </div>
          )}

          <div>
            <Label className="text-xs">Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>

          {mode !== "forgot" && (
            <div>
              <Label className="text-xs">Password</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          )}

          {mode === "signin" && (
            <Button onClick={signIn} disabled={loading} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          )}
          {mode === "signup" && (
            <Button onClick={signUp} disabled={loading} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
              {loading ? "Creating…" : "Create account"}
            </Button>
          )}
          {mode === "forgot" && (
            <Button onClick={sendReset} disabled={loading} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">
              {loading ? "Sending…" : "Send reset link"}
            </Button>
          )}

          <div className="flex justify-between pt-1 text-xs text-muted-foreground">
            {mode !== "signin" ? (
              <button type="button" onClick={() => setMode("signin")} className="hover:text-foreground underline underline-offset-2">
                Back to sign in
              </button>
            ) : <span />}
            {mode === "signin" && (
              <>
                <button type="button" onClick={() => setMode("forgot")} className="hover:text-foreground underline underline-offset-2">
                  Forgot password?
                </button>
                <button type="button" onClick={() => setMode("signup")} className="hover:text-foreground underline underline-offset-2">
                  Create account
                </button>
              </>
            )}
          </div>

          {isDev && (
            <div className="mt-3 rounded-md border border-border bg-muted/40 p-2 text-[10px] font-mono space-y-1 break-all">
              <div className="font-semibold text-foreground text-xs">Auth Debug (dev only)</div>
              <div><span className="text-muted-foreground">SUPABASE_URL:</span> {supabaseUrl}</div>
              <div><span className="text-muted-foreground">mode:</span> {mode}</div>
              {debug ? (
                <>
                  <div><span className="text-muted-foreground">action:</span> {debug.action}</div>
                  <div><span className="text-muted-foreground">email:</span> {debug.email}</div>
                  {debug.redirectTo && <div><span className="text-muted-foreground">redirectTo:</span> {debug.redirectTo}</div>}
                  {debug.error ? (
                    <div className="text-destructive">
                      error: {debug.error.name} · status {String(debug.error.status ?? "?")} · {debug.error.message}
                    </div>
                  ) : (
                    <div className="text-primary">no error returned</div>
                  )}
                  <div className="text-muted-foreground">data: {JSON.stringify(debug.data)?.slice(0, 200)}</div>
                </>
              ) : (
                <div className="text-muted-foreground">No request sent yet.</div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
