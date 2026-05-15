ALTER TABLE public.job_listings
  ADD COLUMN IF NOT EXISTS salary_source text NOT NULL DEFAULT 'missing',
  ADD COLUMN IF NOT EXISTS salary_confidence text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS salary_estimated_min integer,
  ADD COLUMN IF NOT EXISTS salary_estimated_max integer,
  ADD COLUMN IF NOT EXISTS salary_gate_status text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS salary_gate_reason text;

ALTER TABLE public.job_listings
  DROP CONSTRAINT IF EXISTS job_listings_salary_source_check,
  ADD CONSTRAINT job_listings_salary_source_check
  CHECK (salary_source IN ('posted_salary','estimated_from_title','estimated_from_market','missing'));

ALTER TABLE public.job_listings
  DROP CONSTRAINT IF EXISTS job_listings_salary_confidence_check,
  ADD CONSTRAINT job_listings_salary_confidence_check
  CHECK (salary_confidence IN ('high','medium','low','unknown'));

ALTER TABLE public.job_listings
  DROP CONSTRAINT IF EXISTS job_listings_salary_gate_status_check,
  ADD CONSTRAINT job_listings_salary_gate_status_check
  CHECK (salary_gate_status IN ('pass','manual','reject'));

CREATE INDEX IF NOT EXISTS idx_job_listings_salary_gate_status
  ON public.job_listings(user_id, salary_gate_status);