ALTER TABLE public.user_settings ALTER COLUMN auto_review_daily_cap SET DEFAULT 5;
UPDATE public.user_settings
SET application_mode = 'auto_review',
    auto_review_daily_cap = 5,
    packet_daily_cap = 25,
    per_ats_daily_cap = 5,
    manual_review_only = false,
    salary_min = GREATEST(salary_min, 55000),
    friday_prepare_only = true,
    automation_paused = false;