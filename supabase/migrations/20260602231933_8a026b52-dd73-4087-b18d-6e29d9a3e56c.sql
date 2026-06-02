
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS relaxed_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS per_ats_caps jsonb NOT NULL DEFAULT
    '{"Greenhouse":50,"Lever":50,"Ashby":50,"Breezy":50,"Workday":30,"other":25}'::jsonb;

ALTER TABLE public.user_settings
  ALTER COLUMN per_ats_daily_cap SET DEFAULT 50;

UPDATE public.user_settings
  SET per_ats_daily_cap = 50
  WHERE per_ats_daily_cap <= 10;
