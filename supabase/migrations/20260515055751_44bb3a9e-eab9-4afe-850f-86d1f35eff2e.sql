
-- Shared timestamp trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ENUMS
CREATE TYPE public.application_status AS ENUM ('queued','manual_review','approved','submitted','interview','rejected','offer','withdrawn');
CREATE TYPE public.automation_action AS ENUM ('scrape','score','tailor_resume','generate_cover','submit','export_packet','legitimacy_check','ats_check');

-- COMPANIES
CREATE TABLE public.companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  domain TEXT,
  has_linkedin BOOLEAN DEFAULT false,
  domain_age_days INTEGER,
  glassdoor_rating NUMERIC(3,2),
  legitimacy_score INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- JOB LISTINGS
CREATE TABLE public.job_listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  company_name TEXT NOT NULL,
  location TEXT,
  remote BOOLEAN DEFAULT true,
  salary_min INTEGER,
  salary_max INTEGER,
  ats TEXT,
  source_url TEXT,
  description TEXT,
  resume_match INTEGER DEFAULT 0,
  legitimacy INTEGER DEFAULT 0,
  final_score INTEGER DEFAULT 0,
  blockers TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'new',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RESUME VERSIONS
CREATE TABLE public.resume_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  job_id UUID REFERENCES public.job_listings(id) ON DELETE CASCADE,
  label TEXT,
  target_role TEXT,
  summary TEXT,
  skills TEXT[] DEFAULT '{}',
  bullets TEXT[] DEFAULT '{}',
  keywords TEXT[] DEFAULT '{}',
  match_score INTEGER DEFAULT 0,
  explanation TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- COVER LETTERS
CREATE TABLE public.cover_letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  job_id UUID REFERENCES public.job_listings(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  tone TEXT DEFAULT 'professional',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- APPLICATIONS
CREATE TABLE public.applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  job_id UUID NOT NULL REFERENCES public.job_listings(id) ON DELETE CASCADE,
  resume_version_id UUID REFERENCES public.resume_versions(id) ON DELETE SET NULL,
  cover_letter_id UUID REFERENCES public.cover_letters(id) ON DELETE SET NULL,
  status public.application_status NOT NULL DEFAULT 'manual_review',
  submitted_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ATS CHECKS
CREATE TABLE public.ats_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  job_id UUID REFERENCES public.job_listings(id) ON DELETE CASCADE,
  platform TEXT,
  supported BOOLEAN DEFAULT false,
  requires_login BOOLEAN DEFAULT false,
  has_captcha BOOLEAN DEFAULT false,
  has_mfa BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- LEGITIMACY CHECKS
CREATE TABLE public.legitimacy_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  domain_age_days INTEGER,
  has_linkedin BOOLEAN,
  glassdoor_rating NUMERIC(3,2),
  score INTEGER DEFAULT 0,
  red_flags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- AUTOMATION LOGS
CREATE TABLE public.automation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  job_id UUID REFERENCES public.job_listings(id) ON DELETE SET NULL,
  application_id UUID REFERENCES public.applications(id) ON DELETE SET NULL,
  action public.automation_action NOT NULL,
  status TEXT NOT NULL DEFAULT 'success',
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- USER SETTINGS
CREATE TABLE public.user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  full_name TEXT,
  location TEXT,
  website TEXT,
  email TEXT,
  target_roles TEXT[] DEFAULT '{}',
  auto_apply BOOLEAN DEFAULT false,
  trust_threshold INTEGER DEFAULT 90,
  daily_cap INTEGER DEFAULT 25,
  manual_review_only BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS + per-user policies
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY['companies','job_listings','resume_versions','cover_letters','applications','ats_checks','legitimacy_checks','automation_logs','user_settings']) LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "own select %1$s" ON public.%1$I FOR SELECT USING (auth.uid() = user_id)', t);
    EXECUTE format('CREATE POLICY "own insert %1$s" ON public.%1$I FOR INSERT WITH CHECK (auth.uid() = user_id)', t);
    EXECUTE format('CREATE POLICY "own update %1$s" ON public.%1$I FOR UPDATE USING (auth.uid() = user_id)', t);
    EXECUTE format('CREATE POLICY "own delete %1$s" ON public.%1$I FOR DELETE USING (auth.uid() = user_id)', t);
  END LOOP;
END $$;

-- updated_at triggers
CREATE TRIGGER trg_companies_updated BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_jobs_updated BEFORE UPDATE ON public.job_listings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_resumes_updated BEFORE UPDATE ON public.resume_versions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_covers_updated BEFORE UPDATE ON public.cover_letters FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_apps_updated BEFORE UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_settings_updated BEFORE UPDATE ON public.user_settings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes
CREATE INDEX idx_jobs_user ON public.job_listings(user_id);
CREATE INDEX idx_apps_user ON public.applications(user_id);
CREATE INDEX idx_resumes_job ON public.resume_versions(job_id);
CREATE INDEX idx_covers_job ON public.cover_letters(job_id);
CREATE INDEX idx_logs_user ON public.automation_logs(user_id);

-- Auto-create user_settings on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_settings (user_id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
