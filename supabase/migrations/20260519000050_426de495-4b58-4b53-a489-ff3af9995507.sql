
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS safe_auto_submit_dry_run boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS safe_auto_submit_dry_run_passed_at timestamptz,
  ADD COLUMN IF NOT EXISTS safe_auto_submit_dry_run_report jsonb;
