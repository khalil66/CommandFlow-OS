ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS safe_auto_submit_confirmed_at timestamptz;