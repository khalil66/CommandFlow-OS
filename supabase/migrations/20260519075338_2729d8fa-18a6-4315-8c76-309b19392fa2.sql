
CREATE TABLE public.engagement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  event_name text NOT NULL,
  path text,
  section text,
  label text,
  device text,
  referrer_host text,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_engagement_events_created_at ON public.engagement_events (created_at DESC);
CREATE INDEX idx_engagement_events_name ON public.engagement_events (event_name);
CREATE INDEX idx_engagement_events_session ON public.engagement_events (session_id);

ALTER TABLE public.engagement_events ENABLE ROW LEVEL SECURITY;

-- Anyone (including anon) can insert engagement events (privacy-safe, no PII)
CREATE POLICY "anyone can insert engagement events"
ON public.engagement_events
FOR INSERT
TO anon, authenticated
WITH CHECK (
  length(event_name) <= 64
  AND length(coalesce(path,'')) <= 256
  AND length(coalesce(section,'')) <= 128
  AND length(coalesce(label,'')) <= 128
  AND length(session_id) BETWEEN 8 AND 64
);

-- Only authenticated users (the operator) can read events
CREATE POLICY "authenticated can read engagement events"
ON public.engagement_events
FOR SELECT
TO authenticated
USING (true);
