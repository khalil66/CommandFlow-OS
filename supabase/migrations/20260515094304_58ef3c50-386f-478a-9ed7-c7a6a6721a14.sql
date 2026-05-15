
-- Extend application_status enum
ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'imported';
ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'reviewed';
ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'approved';
ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'submitted_manual';
ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'recruiter_screen';
ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'technical_interview';
ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'final_interview';
ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'archived';

-- Recruiter contacts
CREATE TABLE IF NOT EXISTS public.recruiter_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  title text,
  email text,
  company_id uuid,
  company_name text,
  response_count integer NOT NULL DEFAULT 0,
  contact_count integer NOT NULL DEFAULT 0,
  avg_response_hours numeric NOT NULL DEFAULT 0,
  last_contact_at timestamptz,
  last_response_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.recruiter_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own select recruiter_contacts" ON public.recruiter_contacts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own insert recruiter_contacts" ON public.recruiter_contacts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update recruiter_contacts" ON public.recruiter_contacts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own delete recruiter_contacts" ON public.recruiter_contacts FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_recruiter_contacts_updated_at
  BEFORE UPDATE ON public.recruiter_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Extend applications
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS recruiter_notes text,
  ADD COLUMN IF NOT EXISTS interview_notes text,
  ADD COLUMN IF NOT EXISTS salary_expectation text,
  ADD COLUMN IF NOT EXISTS next_action_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_action_label text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_manual_at timestamptz,
  ADD COLUMN IF NOT EXISTS recruiter_screen_at timestamptz,
  ADD COLUMN IF NOT EXISTS technical_interview_at timestamptz,
  ADD COLUMN IF NOT EXISTS final_interview_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS recruiter_contact_id uuid;

CREATE INDEX IF NOT EXISTS idx_applications_status ON public.applications(user_id, status);
CREATE INDEX IF NOT EXISTS idx_recruiter_contacts_user ON public.recruiter_contacts(user_id);
