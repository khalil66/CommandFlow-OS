
-- Enums
DO $$ BEGIN
  CREATE TYPE public.verification_status AS ENUM ('verified','manual_review','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.company_category AS ENUM ('saas','data','cs_ops','product_pm','remote_first','mba_friendly','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.application_priority AS ENUM ('high','good','manual','skip');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- companies
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS trust_score int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS verification_status public.verification_status DEFAULT 'manual_review',
  ADD COLUMN IF NOT EXISTS is_remote_first boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS hiring_activity int DEFAULT 50,
  ADD COLUMN IF NOT EXISTS mba_friendly boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS category public.company_category DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS funding_stage text,
  ADD COLUMN IF NOT EXISTS careers_url text,
  ADD COLUMN IF NOT EXISTS linkedin_url text,
  ADD COLUMN IF NOT EXISTS red_flags text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_applied_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_companies_user_last_applied ON public.companies(user_id, last_applied_at);
CREATE INDEX IF NOT EXISTS idx_companies_user_category ON public.companies(user_id, category);

-- job_listings
ALTER TABLE public.job_listings
  ADD COLUMN IF NOT EXISTS category public.company_category DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS interview_probability int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS role_category text,
  ADD COLUMN IF NOT EXISTS ready_to_apply boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS salary_estimated boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS posted_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS dedupe_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_listings_user_dedupe
  ON public.job_listings(user_id, dedupe_hash) WHERE dedupe_hash IS NOT NULL;

-- applications
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS priority public.application_priority DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS follow_up_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS portfolio_project text;

-- daily_batches
CREATE TABLE IF NOT EXISTS public.daily_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  batch_date date NOT NULL,
  day_of_week text NOT NULL,
  category public.company_category NOT NULL,
  companies_reviewed int DEFAULT 0,
  jobs_found int DEFAULT 0,
  jobs_rejected int DEFAULT 0,
  applications_prepared int DEFAULT 0,
  applications_approved int DEFAULT 0,
  applications_submitted int DEFAULT 0,
  interview_responses int DEFAULT 0,
  status text DEFAULT 'complete',
  summary jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.daily_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own select daily_batches" ON public.daily_batches FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own insert daily_batches" ON public.daily_batches FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update daily_batches" ON public.daily_batches FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own delete daily_batches" ON public.daily_batches FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_daily_batches_user_date ON public.daily_batches(user_id, batch_date DESC);

-- verification_checks
CREATE TABLE IF NOT EXISTS public.verification_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  company_id uuid,
  has_official_site boolean DEFAULT false,
  has_careers_page boolean DEFAULT false,
  has_linkedin boolean DEFAULT false,
  ats_domain_match boolean DEFAULT false,
  business_footprint_score int DEFAULT 0,
  news_signals_count int DEFAULT 0,
  scam_flags text[] DEFAULT '{}',
  personal_email_domain boolean DEFAULT false,
  payment_request boolean DEFAULT false,
  score int DEFAULT 0,
  decision text DEFAULT 'manual_review',
  raw jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.verification_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own select verification_checks" ON public.verification_checks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own insert verification_checks" ON public.verification_checks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update verification_checks" ON public.verification_checks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own delete verification_checks" ON public.verification_checks FOR DELETE USING (auth.uid() = user_id);
