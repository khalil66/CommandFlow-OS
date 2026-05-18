ALTER TABLE public.job_listings
  ADD COLUMN IF NOT EXISTS salary_posted_min integer,
  ADD COLUMN IF NOT EXISTS salary_posted_max integer,
  ADD COLUMN IF NOT EXISTS salary_evidence text[] NOT NULL DEFAULT '{}'::text[];