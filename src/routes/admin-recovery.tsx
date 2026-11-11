import { pageMetadata } from "@/lib/page-metadata";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ShieldAlert } from "lucide-react";
import {
  bootstrapAdminPassword,
  getAdminRecoveryStatus,
} from "@/lib/admin-recovery.functions";

export const Route = createFileRoute("/admin-recovery")({
  head: () => pageMetadata("Temporary Admin Recovery", "Temporary Admin Recovery for secure CommandFlow OS account access."), component: AdminRecoveryPage });

function AdminRecoveryPage() {
  const nav = useNavigate();
  const checkStatus = useServerFn(getAdminRecoveryStatus);
  const submitReset = useServerFn(bootstrapAdminPassword);

  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [recoveryToken, setRecoveryToken] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    checkStatus({})
      .then((r) => setEnabled(r.enabled))
      .catch((e) => setLastError(e?.message ?? "status failed"))
      .finally(() => setLoading(false));
  }, [checkStatus]);

  const submit = async () => {
    if (pw !== confirm) return toast.error("Passwords do not match.");
    if (pw.length < 8) return toast.error("Password must be at least 8 characters.");
    if (recoveryToken.length < 16) return toast.error("Recovery token required.");
    setSubmitting(true);
    setLastError(null);
    try {
      await submitReset({ data: { recoveryToken, newPassword: pw } });
      toast.success("Password updated. Recovery mode is now disabled.");
      nav({ to: "/auth", replace: true });
    } catch (e: any) {
      const msg = e?.message ?? "Recovery failed.";
      setLastError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-destructive/15 text-destructive">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Admin Recovery</CardTitle>
              <p className="text-xs text-muted-foreground">Token-gated password reset</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Requires the server-side recovery token. Disabled automatically after use.
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground">Checking status…</p>
          ) : !enabled ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Admin recovery is currently disabled. If you need access, the system owner must
                re-enable it server-side.
              </p>
              <Button
                onClick={() => nav({ to: "/auth", replace: true })}
                className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
              >
                Back to sign in
              </Button>
            </div>
          ) : (
            <>
              <div>
                <Label className="text-xs">Recovery token</Label>
                <Input
                  type="password"
                  value={recoveryToken}
                  onChange={(e) => setRecoveryToken(e.target.value)}
                  placeholder="Server-side ADMIN_RECOVERY_TOKEN"
                />
              </div>
              <div>
                <Label className="text-xs">New password</Label>
                <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Confirm new password</Label>
                <Input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
              {pw && confirm && pw !== confirm && (
                <p className="text-xs text-destructive">Passwords do not match.</p>
              )}
              <Button
                onClick={submit}
                disabled={
                  submitting || !pw || !confirm || pw !== confirm || recoveryToken.length < 16
                }
                className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
              >
                {submitting ? "Updating…" : "Set new password"}
              </Button>
              <p className="text-[11px] text-muted-foreground">
                On success, recovery mode is automatically disabled. Re-enabling requires server access.
              </p>
              {lastError && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
                  {lastError}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
