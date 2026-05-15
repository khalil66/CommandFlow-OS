
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS phone_number text,
  ADD COLUMN IF NOT EXISTS sms_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sms_daily_cap integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS sms_notify_batch_start boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sms_notify_batch_complete boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sms_notify_manual_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sms_notify_auto_mode boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sms_notify_safety_block boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sms_notify_high_probability boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sms_notify_followups boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.notification_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  channel text NOT NULL DEFAULT 'sms',
  kind text NOT NULL,
  to_number text,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'sent',
  provider_sid text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own select notification_logs" ON public.notification_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own insert notification_logs" ON public.notification_logs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update notification_logs" ON public.notification_logs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own delete notification_logs" ON public.notification_logs FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS notification_logs_user_created_idx ON public.notification_logs (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.interview_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  company_id uuid,
  company_name text NOT NULL,
  job_id uuid,
  overview text,
  product_summary text,
  industry text,
  company_size text,
  headquarters text,
  remote_policy text,
  funding_stage text,
  recent_news text,
  leadership text,
  interview_themes text[] NOT NULL DEFAULT '{}',
  recruiter_questions text[] NOT NULL DEFAULT '{}',
  role_questions text[] NOT NULL DEFAULT '{}',
  star_outlines text[] NOT NULL DEFAULT '{}',
  questions_to_ask text[] NOT NULL DEFAULT '{}',
  talking_points text[] NOT NULL DEFAULT '{}',
  why_fit text,
  why_company text,
  why_role text,
  tell_me_about_yourself text,
  keywords text[] NOT NULL DEFAULT '{}',
  mission_values text,
  red_flags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.interview_briefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own select interview_briefs" ON public.interview_briefs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own insert interview_briefs" ON public.interview_briefs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update interview_briefs" ON public.interview_briefs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own delete interview_briefs" ON public.interview_briefs FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS interview_briefs_user_company_idx ON public.interview_briefs (user_id, company_id);

CREATE TRIGGER update_interview_briefs_updated_at
  BEFORE UPDATE ON public.interview_briefs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS ranking_label text,
  ADD COLUMN IF NOT EXISTS ranking_score integer NOT NULL DEFAULT 0;
