import { useEffect } from "react";
import { trackPageView, trackTimeOnPage } from "@/lib/track";

/** Mount once per public route to record a page_view + time_on_page on unmount. */
export function PageTracker({ path }: { path?: string }) {
  useEffect(() => {
    trackPageView(path);
    const onHide = () => trackTimeOnPage(path);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      trackTimeOnPage(path);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  return null;
}
