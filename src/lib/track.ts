import { supabase } from "@/integrations/supabase/client";

// Privacy-safe anonymous engagement tracking.
// - No PII, no IP, no fingerprinting.
// - Anonymous session ID lives in localStorage, rotates if cleared.
// - All inserts go through RLS-bounded `engagement_events` table.

const SESSION_KEY = "cfos_anon_session";
const PAGE_START_KEY = "cfos_page_start";

function getSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, "").slice(0, 32);
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return "nostore";
  }
}

function getDevice(): "mobile" | "desktop" {
  if (typeof window === "undefined") return "desktop";
  return window.matchMedia("(max-width: 767px)").matches ? "mobile" : "desktop";
}

function getReferrerHost(): string | null {
  if (typeof document === "undefined") return null;
  try {
    if (!document.referrer) return null;
    const u = new URL(document.referrer);
    if (u.host === window.location.host) return null;
    return u.host.slice(0, 128);
  } catch {
    return null;
  }
}

export type TrackPayload = {
  event: string;
  section?: string;
  label?: string;
  duration_ms?: number;
  path?: string;
};

export async function track(payload: TrackPayload) {
  try {
    const row = {
      session_id: getSessionId(),
      event_name: payload.event.slice(0, 64),
      path: (payload.path ?? (typeof window !== "undefined" ? window.location.pathname : null))?.slice(0, 256) ?? null,
      section: payload.section?.slice(0, 128) ?? null,
      label: payload.label?.slice(0, 128) ?? null,
      device: getDevice(),
      referrer_host: getReferrerHost(),
      duration_ms: typeof payload.duration_ms === "number" ? Math.max(0, Math.min(payload.duration_ms, 24 * 60 * 60 * 1000)) : null,
    };
    await supabase.from("engagement_events").insert(row);
  } catch {
    // never throw from tracking
  }
}

export function trackPageView(path?: string) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(PAGE_START_KEY, String(Date.now()));
  } catch {}
  void track({ event: "page_view", path });
}

export function trackTimeOnPage(path?: string) {
  if (typeof window === "undefined") return;
  try {
    const start = Number(sessionStorage.getItem(PAGE_START_KEY) || "0");
    if (!start) return;
    const duration = Date.now() - start;
    if (duration < 1500) return; // ignore bounces/quick nav
    void track({ event: "time_on_page", duration_ms: duration, path });
  } catch {}
}

export function trackCTA(label: string, section?: string) {
  void track({ event: "cta_click", label, section });
}

export function trackSectionView(section: string) {
  void track({ event: "section_view", section });
}
