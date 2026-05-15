
CREATE TABLE public.job_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  careers_url text NOT NULL,
  ats text,
  status text NOT NULL DEFAULT 'active',
  notes text,
  last_imported_at timestamptz,
  last_import_count integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.job_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own select job_sources" ON public.job_sources FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own insert job_sources" ON public.job_sources FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update job_sources" ON public.job_sources FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own delete job_sources" ON public.job_sources FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER update_job_sources_updated_at BEFORE UPDATE ON public.job_sources
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.import_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_id uuid,
  source_url text,
  ats text,
  found integer DEFAULT 0,
  imported integer DEFAULT 0,
  duplicate integer DEFAULT 0,
  skipped integer DEFAULT 0,
  rejected integer DEFAULT 0,
  manual_review integer DEFAULT 0,
  success boolean DEFAULT true,
  message text,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.import_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own select import_logs" ON public.import_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own insert import_logs" ON public.import_logs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own update import_logs" ON public.import_logs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own delete import_logs" ON public.import_logs FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_import_logs_user_created ON public.import_logs(user_id, created_at DESC);
CREATE INDEX idx_job_sources_user ON public.job_sources(user_id);
