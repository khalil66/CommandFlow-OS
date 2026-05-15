
CREATE TABLE IF NOT EXISTS public.admin_bootstrap (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  enabled boolean NOT NULL DEFAULT true,
  target_user_id uuid NOT NULL,
  target_email text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_bootstrap ENABLE ROW LEVEL SECURITY;
-- No policies => no client access. Only service_role (which bypasses RLS) can read/write.

INSERT INTO public.admin_bootstrap (id, enabled, target_user_id, target_email)
VALUES (true, true, '00bb776c-6de6-40c2-8a06-34e4755ff403', 'khalil.hickson@outlook.com')
ON CONFLICT (id) DO UPDATE SET enabled = true, updated_at = now();
