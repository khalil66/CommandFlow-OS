
-- Unique index for race-proof dedupe on job_listings
CREATE UNIQUE INDEX IF NOT EXISTS job_listings_user_dedupe_unique
  ON public.job_listings (user_id, dedupe_hash)
  WHERE dedupe_hash IS NOT NULL;

-- OpenAI usage tracking
CREATE TABLE IF NOT EXISTS public.openai_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('resume','cover_letter')),
  model TEXT,
  job_id UUID,
  resume_version_id UUID,
  cover_letter_id UUID,
  match_score INTEGER,
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  estimated_cost_cents NUMERIC(10,4) DEFAULT 0,
  success BOOLEAN NOT NULL DEFAULT true,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS openai_usage_user_created
  ON public.openai_usage (user_id, created_at DESC);

ALTER TABLE public.openai_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own select openai_usage" ON public.openai_usage
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own insert openai_usage" ON public.openai_usage
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update openai_usage" ON public.openai_usage
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own delete openai_usage" ON public.openai_usage
  FOR DELETE USING (auth.uid() = user_id);
