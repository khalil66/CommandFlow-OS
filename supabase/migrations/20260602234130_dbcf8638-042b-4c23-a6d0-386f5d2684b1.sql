
-- AI retry queue: durable record of jobs awaiting AI packet generation retry
CREATE TABLE public.ai_retry_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  job_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'packet',
  status text NOT NULL DEFAULT 'queued',  -- queued | retrying | completed | failed | quota_limited
  retry_attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_retry_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  last_retry_at timestamptz,
  retry_reason text,
  retry_status text,            -- last attempt outcome short code
  last_error text,
  history jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, job_id, kind)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_retry_queue TO authenticated;
GRANT ALL ON public.ai_retry_queue TO service_role;

ALTER TABLE public.ai_retry_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own select ai_retry_queue" ON public.ai_retry_queue FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own insert ai_retry_queue" ON public.ai_retry_queue FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update ai_retry_queue" ON public.ai_retry_queue FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own delete ai_retry_queue" ON public.ai_retry_queue FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_ai_retry_queue_due ON public.ai_retry_queue (status, next_retry_at);
CREATE INDEX idx_ai_retry_queue_user ON public.ai_retry_queue (user_id, status);

CREATE TRIGGER update_ai_retry_queue_updated_at
  BEFORE UPDATE ON public.ai_retry_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
