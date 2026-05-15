
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS application_mode text NOT NULL DEFAULT 'manual_review',
  ADD COLUMN IF NOT EXISTS automation_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS friday_prepare_only boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_review_daily_cap integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS packet_daily_cap integer NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS per_ats_daily_cap integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS company_cooldown_days integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS schedule_hour integer NOT NULL DEFAULT 8,
  ADD COLUMN IF NOT EXISTS schedule_minute integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS active_weekdays integer[] NOT NULL DEFAULT ARRAY[1,2,3,4,5];

ALTER TABLE public.user_settings
  ADD CONSTRAINT user_settings_application_mode_chk
  CHECK (application_mode IN ('manual_review','auto_review'));

CREATE TABLE IF NOT EXISTS public.automation_safety_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  job_id uuid,
  application_id uuid,
  job_title text,
  company_name text,
  ats text,
  action text NOT NULL,
  reason text,
  gates jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.automation_safety_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own select automation_safety_logs" ON public.automation_safety_logs
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own insert automation_safety_logs" ON public.automation_safety_logs
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update automation_safety_logs" ON public.automation_safety_logs
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own delete automation_safety_logs" ON public.automation_safety_logs
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS automation_safety_logs_user_created_idx
  ON public.automation_safety_logs (user_id, created_at DESC);
