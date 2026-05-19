import { useEffect } from "react";
import { trackPageView, trackTimeOnPage, trackCTA, trackSectionView } from "@/lib/track";

/** Mount once per public route. Records page_view, time_on_page,
 *  CTA clicks for any element with [data-track-cta], and section_view
 *  for any element with [data-track-section] when it enters the viewport. */
export function PageTracker({ path }: { path?: string }) {
  useEffect(() => {
    trackPageView(path);
    const onHide = () => trackTimeOnPage(path);
    window.addEventListener("pagehide", onHide);

    // CTA click delegation
    const onClick = (e: MouseEvent) => {
      const t = (e.target as HTMLElement | null)?.closest?.("[data-track-cta]") as HTMLElement | null;
      if (!t) return;
      const label = t.getAttribute("data-track-cta") || t.innerText?.slice(0, 80) || "cta";
      const section = t.getAttribute("data-track-section") || t.closest("[data-track-section]")?.getAttribute("data-track-section") || undefined;
      trackCTA(label, section ?? undefined);
    };
    document.addEventListener("click", onClick, { capture: true });

    // Section view via IntersectionObserver
    const seen = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          const name = (en.target as HTMLElement).getAttribute("data-track-section");
          if (!name || seen.has(name)) continue;
          seen.add(name);
          trackSectionView(name);
        }
      },
      { threshold: 0.4 },
    );
    document.querySelectorAll<HTMLElement>("[data-track-section]").forEach((el) => io.observe(el));

    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("click", onClick, { capture: true } as any);
      io.disconnect();
      trackTimeOnPage(path);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  return null;
}

