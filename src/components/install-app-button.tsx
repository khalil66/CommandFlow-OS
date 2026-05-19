import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Smartphone } from "lucide-react";

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * Install App CTA — uses the W3C beforeinstallprompt event on Android/desktop Chromium.
 * On iOS (no native prompt) we surface a short Add-to-Home-Screen hint.
 */
export function InstallAppButton({
  className = "",
  variant = "outline",
  size = "sm",
  label = "Install App",
}: {
  className?: string;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "sm" | "default" | "lg";
  label?: string;
}) {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BIPEvent);
    };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    // Already running standalone?
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      // iOS Safari
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) setInstalled(true);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !("MSStream" in window);

  const handleClick = async () => {
    if (deferred) {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") setDeferred(null);
    } else if (isIos) {
      setShowIosHint(true);
      setTimeout(() => setShowIosHint(false), 6000);
    }
  };

  // Hide the button entirely on platforms where install is unavailable
  if (!deferred && !isIos) return null;

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        onClick={handleClick}
        aria-label={label}
      >
        <Download className="h-4 w-4 mr-1.5" /> {label}
      </Button>
      {showIosHint && (
        <div
          role="status"
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[90] max-w-[90vw] rounded-xl bg-card/95 backdrop-blur-xl border border-border shadow-2xl px-4 py-3 text-sm animate-fade-in flex items-start gap-2"
        >
          <Smartphone className="h-4 w-4 mt-0.5 text-emerald-500 shrink-0" />
          <div>
            <div className="font-medium">Add to Home Screen</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Tap <span className="font-semibold">Share</span> in Safari, then
              <span className="font-semibold"> Add to Home Screen</span>.
            </div>
          </div>
        </div>
      )}
    </>
  );
}
