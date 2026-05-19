import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, X, PlayCircle, Sparkles } from "lucide-react";

export type TourStep = {
  /** DOM id of the element to spotlight */
  id: string;
  /** Section label (e.g. "ATS Ingestion") */
  title: string;
  /** Recruiter-focused 1–2 sentence explanation */
  body: string;
};

const EVENT = "commandflowos:start-tour";

/** Programmatically open the tour from anywhere (no prop drilling). */
export function startGuidedTour(scope?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { scope } }));
}

/** Premium CTA button — drop anywhere on a page that mounts <GuidedTour />. */
export function StartTourButton({
  label = "Start guided tour",
  scope,
  className = "",
  variant = "default",
  size = "sm",
}: {
  label?: string;
  scope?: string;
  className?: string;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "sm" | "default" | "lg";
}) {
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={() => startGuidedTour(scope)}
    >
      <PlayCircle className="h-4 w-4 mr-1.5" /> {label}
    </Button>
  );
}

type Rect = { top: number; left: number; width: number; height: number };

/**
 * Premium guided product tour.
 * - Dim overlay with spotlight cutout on the active section
 * - Floating tooltip with recruiter-focused copy
 * - Keyboard nav (←/→/Esc), progress dots, mobile bottom-sheet layout
 * - Auto-scroll between steps with smooth transitions
 * - Trigger from anywhere via `startGuidedTour()` or <StartTourButton />
 */
export function GuidedTour({
  steps,
  scope,
  eyebrow = "Guided product tour",
}: {
  steps: TourStep[];
  scope?: string;
  eyebrow?: string;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [mounted, setMounted] = useState(false);
  const rafRef = useRef<number | null>(null);

  useEffect(() => setMounted(true), []);

  // Listen for external triggers
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { scope?: string } | undefined;
      if (scope && detail?.scope && detail.scope !== scope) return;
      setStep(0);
      setOpen(true);
      void import("@/lib/track").then((m) => m.track({ event: "tour_start", section: scope })).catch(() => {});
    };
    window.addEventListener(EVENT, handler as EventListener);
    return () => window.removeEventListener(EVENT, handler as EventListener);
  }, [scope]);

  const close = useCallback(() => {
    setOpen(false);
    void import("@/lib/track").then((m) => m.track({ event: "tour_exit", section: scope, label: String(step) })).catch(() => {});
  }, [scope, step]);
  const next = useCallback(
    () => setStep((s) => {
      const ns = Math.min(steps.length - 1, s + 1);
      if (ns === steps.length - 1 && s !== ns) {
        void import("@/lib/track").then((m) => m.track({ event: "tour_complete", section: scope })).catch(() => {});
      }
      return ns;
    }),
    [steps.length, scope],
  );
  const prev = useCallback(() => setStep((s) => Math.max(0, s - 1)), []);

  // Track target rect every frame while open (handles scroll/resize/layout)
  useEffect(() => {
    if (!open) return;
    const target = document.getElementById(steps[step]?.id);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    const tick = () => {
      const el = document.getElementById(steps[step]?.id);
      if (el) {
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      } else {
        setRect(null);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [open, step, steps]);

  // Keyboard nav
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (step === steps.length - 1) close(); else next();
      }
      else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, step, steps.length, next, prev, close]);

  if (!mounted || !open) return null;

  const s = steps[step];
  const isLast = step === steps.length - 1;
  const pad = 12; // spotlight padding
  const spot: Rect | null = rect
    ? {
        top: rect.top - pad,
        left: rect.left - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }
    : null;

  // Compute tooltip placement: prefer below the spotlight, else above, else center.
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const isMobile = vw < 640;
  const tooltipW = Math.min(420, vw - 24);
  let tipTop = vh / 2 - 120;
  let tipLeft = vw / 2 - tooltipW / 2;
  if (spot && !isMobile) {
    const belowSpace = vh - (spot.top + spot.height);
    if (belowSpace > 220) {
      tipTop = spot.top + spot.height + 12;
    } else if (spot.top > 220) {
      tipTop = spot.top - 220;
    } else {
      tipTop = Math.max(16, vh - 240);
    }
    tipLeft = Math.min(
      Math.max(16, spot.left + spot.width / 2 - tooltipW / 2),
      vw - tooltipW - 16,
    );
  }

  const overlay = (
    <div className="fixed inset-0 z-[80] pointer-events-none" aria-live="polite">
      {/* Spotlight via SVG mask — smooth, GPU-accelerated, no 4-rect math */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-auto"
        onClick={close}
        aria-hidden
      >
        <defs>
          <mask id="cfos-tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {spot && (
              <rect
                x={spot.left}
                y={spot.top}
                width={spot.width}
                height={spot.height}
                rx={16}
                ry={16}
                fill="black"
                style={{ transition: "all 450ms cubic-bezier(0.22, 1, 0.36, 1)" }}
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(8, 12, 24, 0.72)"
          mask="url(#cfos-tour-mask)"
        />
      </svg>

      {/* Animated ring around the spotlight */}
      {spot && (
        <div
          className="absolute rounded-2xl ring-2 ring-emerald-400/80 shadow-[0_0_0_6px_rgba(16,185,129,0.18)] pointer-events-none"
          style={{
            top: spot.top,
            left: spot.left,
            width: spot.width,
            height: spot.height,
            transition: "all 450ms cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />
      )}

      {/* Tooltip card */}
      <div
        className={
          isMobile
            ? "absolute left-0 right-0 bottom-0 pointer-events-auto"
            : "absolute pointer-events-auto"
        }
        style={
          isMobile
            ? undefined
            : {
                top: tipTop,
                left: tipLeft,
                width: tooltipW,
                transition: "top 450ms cubic-bezier(0.22, 1, 0.36, 1), left 450ms cubic-bezier(0.22, 1, 0.36, 1)",
              }
        }
      >
        <div
          className={
            "bg-card/95 backdrop-blur-xl border border-emerald-400/30 shadow-2xl p-5 space-y-4 animate-fade-in " +
            (isMobile ? "rounded-t-2xl" : "rounded-2xl")
          }
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] font-semibold text-emerald-500">
                <Sparkles className="h-3 w-3" /> {eyebrow} · {step + 1} of {steps.length}
              </div>
              <div className="mt-2 text-lg font-semibold tracking-tight">{s.title}</div>
              <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{s.body}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={close} aria-label="Exit tour">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex items-center gap-1.5">
            {steps.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                aria-label={`Go to step ${i + 1}`}
                className={
                  "h-1.5 flex-1 rounded-full transition-all duration-300 " +
                  (i < step
                    ? "bg-emerald-500"
                    : i === step
                      ? "bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.6)]"
                      : "bg-muted hover:bg-muted-foreground/30")
                }
              />
            ))}
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={close}>Skip tour</Button>
              <kbd className="hidden sm:inline-flex text-[10px] text-muted-foreground border rounded px-1.5 py-0.5">Esc</kbd>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={step === 0}
                onClick={prev}
              >
                <ChevronLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              {isLast ? (
                <Button size="sm" onClick={close} className="cta-gradient">Finish</Button>
              ) : (
                <Button size="sm" onClick={next} className="cta-gradient">
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
