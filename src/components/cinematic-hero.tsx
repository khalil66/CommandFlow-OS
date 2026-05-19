import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlayCircle, FileText, Workflow, Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";

export type CinematicHeroProps = {
  eyebrow?: string;
  headline?: string;
  subheadline?: string;
  showDefaultCtas?: boolean;
  children?: React.ReactNode;
};

/**
 * Public-facing cinematic hero with animated navy→emerald gradient,
 * subtle grid + radial glow, and glassmorphism content card.
 */
export function CinematicHero({
  eyebrow = "AI Career Operations · Public Preview",
  headline = "AI-Powered Career Operating System",
  subheadline = "CommandFlowOS combines verified job intelligence, resume optimization, recruiter CRM workflows, outcome learning, and safe automation into one career operations platform.",
  showDefaultCtas = true,
  children,
}: CinematicHeroProps) {
  return (
    <section className="relative isolate overflow-hidden cinematic-bg grid-glow text-white">
      <div className="relative max-w-6xl mx-auto px-6 pt-24 pb-28 md:pt-32 md:pb-36 animate-fade-in">
        <Badge className="bg-white/10 text-white border-white/20 backdrop-blur">
          <Sparkles className="h-3 w-3 mr-1.5" /> {eyebrow}
        </Badge>

        <h1 className="mt-6 text-4xl md:text-6xl font-semibold tracking-tight leading-[1.05] max-w-4xl">
          {headline.split(/(Operating System|Intelligence Platform|Command Center|Demo)/).map((part, i) =>
            /Operating System|Intelligence Platform|Command Center|Demo/.test(part) ? (
              <span
                key={i}
                className="bg-gradient-to-r from-emerald-300 via-teal-200 to-sky-300 bg-clip-text text-transparent"
              >
                {part}
              </span>
            ) : (
              <span key={i}>{part}</span>
            ),
          )}
        </h1>

        <p className="mt-6 max-w-2xl text-base md:text-lg text-white/75 leading-relaxed">
          {subheadline}
        </p>

        {showDefaultCtas && (
          <div className="mt-9 flex flex-wrap gap-3">
            <Button asChild size="lg" className="cta-gradient">
              <Link to="/sandbox">
                <PlayCircle className="h-4 w-4 mr-2" /> Launch Public Sandbox
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-white/25 bg-white/5 text-white hover:bg-white/10 hover:text-white"
            >
              <Link to="/case-study">
                <FileText className="h-4 w-4 mr-2" /> Read Case Study
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="ghost"
              className="text-white hover:bg-white/10 hover:text-white"
            >
              <a href="#architecture">
                <Workflow className="h-4 w-4 mr-2" /> View Architecture
              </a>
            </Button>
          </div>
        )}

        {children && <div className="mt-12">{children}</div>}
      </div>
    </section>
  );
}

/** Glassmorphism KPI tile for use inside CinematicHero or below it. */
export function GlassStat({
  value,
  label,
  sub,
}: {
  value: React.ReactNode;
  label: string;
  sub?: string;
}) {
  return (
    <div className="glass-card card-2xl p-5 hover-lift">
      <div className="text-3xl font-semibold tracking-tight tabular-nums text-white">{value}</div>
      <div className="mt-1 text-xs uppercase tracking-[0.18em] text-white/60">{label}</div>
      {sub && <div className="mt-2 text-sm text-white/70">{sub}</div>}
    </div>
  );
}

/** Wrap any block to fade/translate in on scroll. */
export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setTimeout(() => el.classList.add("is-visible"), delay);
            io.unobserve(el);
          }
        });
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [delay]);
  return (
    <div ref={ref} className={`reveal-up ${className}`}>
      {children}
    </div>
  );
}
