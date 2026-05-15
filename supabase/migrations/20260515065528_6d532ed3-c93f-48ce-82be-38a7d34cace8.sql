
ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'submitted_manually';
ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'follow_up_due';
ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'interview_requested';
ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'ghosted';
ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'archived';

ALTER TYPE automation_action ADD VALUE IF NOT EXISTS 'follow_up';

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS application_url text,
  ADD COLUMN IF NOT EXISTS submission_notes text;

CREATE TABLE IF NOT EXISTS public.follow_up_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  application_id uuid NOT NULL,
  job_id uuid,
  kind text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS follow_up_messages_app_idx ON public.follow_up_messages(application_id);

ALTER TABLE public.follow_up_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own select follow_up_messages" ON public.follow_up_messages FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own insert follow_up_messages" ON public.follow_up_messages FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update follow_up_messages" ON public.follow_up_messages FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own delete follow_up_messages" ON public.follow_up_messages FOR DELETE USING (auth.uid() = user_id);
