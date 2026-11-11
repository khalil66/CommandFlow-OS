import { pageMetadata } from "@/lib/page-metadata";
import { useNavigate, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Briefcase } from "lucide-react";

export const Route = createFileRoute("/reset-password")({
  head: () => pageMetadata("Reset Password", "Reset Password for secure CommandFlow OS account access."), component: ResetPasswordPage });

function ResetPasswordPage() {
  const nav = useNavigate();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(true);
  const [isRecovery, setIsRecovery] = useState(false);

  useEffect(() => {
    let active = true;

    supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (session) {
        setIsRecovery(true);
        setValidating(false);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) {
        setIsRecovery(true);
      }
      setValidating(false);
    });

    return () => { active = false; };
  }, []);

  const handleReset = async () => {
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }
    if (newPassword.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Password updated.");
    nav({ to: "/auth", replace: true, state: { message: "Password updated. Please sign in." } as any });
  };

  if (validating) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Verifying reset link…
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isRecovery) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent text-accent-foreground">
                <Briefcase className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>Reset Link Expired</CardTitle>
                <p className="text-xs text-muted-foreground">Request a new password reset.</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This reset link is missing or expired. Please go back to the sign-in page to request a new one.
            </p>
            <Button
              onClick={() => nav({ to: "/auth", replace: true })}
              className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
            >
              Go to sign in
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-accent text-accent-foreground">
              <Briefcase className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Reset Password</CardTitle>
              <p className="text-xs text-muted-foreground">Enter your new password below.</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs">New password</Label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Confirm new password</Label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          {newPassword && confirmPassword && newPassword !== confirmPassword && (
            <p className="text-xs text-destructive">Passwords do not match.</p>
          )}
          <Button
            onClick={handleReset}
            disabled={loading || !newPassword || !confirmPassword || newPassword !== confirmPassword}
            className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
          >
            {loading ? "Updating…" : "Update password"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
