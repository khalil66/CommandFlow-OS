
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS salary_min integer NOT NULL DEFAULT 55000,
  ADD COLUMN IF NOT EXISTS remote_only boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS role_categories text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS excluded_companies text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS excluded_ats text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS linkedin_url text,
  ADD COLUMN IF NOT EXISTS onboarded_at timestamptz;
