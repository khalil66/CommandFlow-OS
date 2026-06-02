
-- Restrict engagement_events SELECT to admin bootstrap user only
DROP POLICY IF EXISTS "authenticated can read engagement events" ON public.engagement_events;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_bootstrap
    WHERE enabled = true AND target_user_id = _user_id
  )
$$;

CREATE POLICY "admins can read engagement events"
ON public.engagement_events
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));
