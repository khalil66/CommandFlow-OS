
-- job_sources ranking metrics
ALTER TABLE public.job_sources
  ADD COLUMN IF NOT EXISTS response_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS interview_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rejection_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS safety_block_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS high_prob_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quality_score_avg numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS priority_score numeric NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS last_quality_recalc_at timestamptz;

-- resume_versions A/B variants
ALTER TABLE public.resume_versions
  ADD COLUMN IF NOT EXISTS variant_key text NOT NULL DEFAULT 'generic',
  ADD COLUMN IF NOT EXISTS is_template boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_resume_versions_variant ON public.resume_versions(user_id, variant_key);

-- applications outcome tracking + QC
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS resume_variant_key text,
  ADD COLUMN IF NOT EXISTS response_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS interview_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS ghosted_at timestamptz,
  ADD COLUMN IF NOT EXISTS offer_at timestamptz,
  ADD COLUMN IF NOT EXISTS qc_passed boolean,
  ADD COLUMN IF NOT EXISTS qc_failures text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS freshness_bucket text;

-- job_listings freshness bucket
ALTER TABLE public.job_listings
  ADD COLUMN IF NOT EXISTS freshness_bucket text;

CREATE INDEX IF NOT EXISTS idx_job_listings_freshness ON public.job_listings(user_id, freshness_bucket);

-- follow_up_tasks
CREATE TABLE IF NOT EXISTS public.follow_up_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  application_id uuid NOT NULL,
  job_id uuid,
  kind text NOT NULL,
  due_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  completed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.follow_up_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own select follow_up_tasks" ON public.follow_up_tasks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own insert follow_up_tasks" ON public.follow_up_tasks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update follow_up_tasks" ON public.follow_up_tasks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own delete follow_up_tasks" ON public.follow_up_tasks FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_follow_up_tasks_due ON public.follow_up_tasks(user_id, status, due_at);

-- interview_prep
CREATE TABLE IF NOT EXISTS public.interview_prep (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  application_id uuid NOT NULL,
  job_id uuid,
  brief jsonb NOT NULL DEFAULT '{}'::jsonb,
  pitch_60s text,
  star_answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  recruiter_questions text[] NOT NULL DEFAULT '{}',
  technical_questions text[] NOT NULL DEFAULT '{}',
  questions_to_ask text[] NOT NULL DEFAULT '{}',
  salary_talking_points text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.interview_prep ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own select interview_prep" ON public.interview_prep FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own insert interview_prep" ON public.interview_prep FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update interview_prep" ON public.interview_prep FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own delete interview_prep" ON public.interview_prep FOR DELETE USING (auth.uid() = user_id);

-- weekly_learning_reports
CREATE TABLE IF NOT EXISTS public.weekly_learning_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  week_start date NOT NULL,
  week_end date NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommendations text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.weekly_learning_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own select weekly_learning_reports" ON public.weekly_learning_reports FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own insert weekly_learning_reports" ON public.weekly_learning_reports FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update weekly_learning_reports" ON public.weekly_learning_reports FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own delete weekly_learning_reports" ON public.weekly_learning_reports FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_weekly_reports_user_week ON public.weekly_learning_reports(user_id, week_start DESC);
