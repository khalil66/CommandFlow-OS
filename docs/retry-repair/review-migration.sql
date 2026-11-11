-- REVIEW ONLY. Do not apply to the shared production backend before approval.
CREATE TABLE public.retry_controls (
  user_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  paused boolean NOT NULL DEFAULT false,
  pause_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.retry_controls TO authenticated;
GRANT ALL ON public.retry_controls TO service_role;
ALTER TABLE public.retry_controls ENABLE ROW LEVEL SECURITY;
CREATE POLICY retry_controls_owner_read ON public.retry_controls FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.retry_usage_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  job_id uuid,
  usage_day date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  status text NOT NULL DEFAULT 'reserved',
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
GRANT SELECT ON public.retry_usage_reservations TO authenticated;
GRANT ALL ON public.retry_usage_reservations TO service_role;
ALTER TABLE public.retry_usage_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY retry_usage_owner_read ON public.retry_usage_reservations FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX retry_usage_day ON public.retry_usage_reservations(user_id, usage_day);

CREATE TABLE public.retry_packet_leases (
  user_id uuid NOT NULL,
  job_id uuid NOT NULL,
  token uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(user_id, job_id)
);
GRANT SELECT ON public.retry_packet_leases TO authenticated;
GRANT ALL ON public.retry_packet_leases TO service_role;
ALTER TABLE public.retry_packet_leases ENABLE ROW LEVEL SECURITY;
CREATE POLICY retry_packet_owner_read ON public.retry_packet_leases FOR SELECT TO authenticated USING (auth.uid() = user_id);

ALTER TABLE public.ai_retry_queue ADD COLUMN lease_token uuid;
ALTER TABLE public.ai_retry_queue ADD COLUMN lease_expires_at timestamptz;
ALTER TABLE public.ai_retry_queue ADD COLUMN started_at timestamptz;
ALTER TABLE public.ai_retry_queue ADD COLUMN duration_ms bigint;
ALTER TABLE public.ai_retry_queue ADD COLUMN estimated_cost_cents numeric NOT NULL DEFAULT 0;

-- Shared authorization inside every SECURITY DEFINER RPC, including service-role calls.
CREATE FUNCTION public.retry_assert_user(p_user uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_user IS NULL OR (auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM p_user) THEN
    RAISE EXCEPTION 'Unauthorized retry owner' USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.retry_assert_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retry_assert_user(uuid) TO authenticated, service_role;

CREATE FUNCTION public.retry_reserve_usage(p_user uuid, p_job uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_day date := (now() AT TIME ZONE 'UTC')::date;
  v_since timestamptz := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_resumes integer; v_covers integer; v_reserved integer; v_id uuid;
BEGIN
  PERFORM public.retry_assert_user(p_user);
  IF p_job IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.job_listings WHERE id = p_job AND user_id = p_user) THEN
    RAISE EXCEPTION 'Job not found';
  END IF;
  -- Serialize reservations across all Worker instances and interactive requests.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text || ':usage:' || v_day::text, 0));
  SELECT count(*) INTO v_resumes FROM public.openai_usage WHERE user_id=p_user AND kind='resume' AND success AND created_at>=v_since;
  SELECT count(*) INTO v_covers FROM public.openai_usage WHERE user_id=p_user AND kind='cover_letter' AND success AND created_at>=v_since;
  -- Completed successes are already in usage logs. Failures/unknowns consume reservations conservatively.
  SELECT count(*) INTO v_reserved FROM public.retry_usage_reservations WHERE user_id=p_user AND usage_day=v_day AND status <> 'succeeded';
  IF v_resumes + v_reserved >= 25 OR v_covers + v_reserved >= 25 THEN
    RAISE EXCEPTION 'DAILY_LIMIT: 25 resumes and 25 cover letters per user per UTC day';
  END IF;
  INSERT INTO public.retry_usage_reservations(user_id, job_id, usage_day) VALUES(p_user,p_job,v_day) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.retry_reserve_usage(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retry_reserve_usage(uuid,uuid) TO authenticated,service_role;

CREATE FUNCTION public.retry_finish_usage(p_user uuid, p_reservation uuid, p_result jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.retry_usage_reservations; v_success boolean := coalesce((p_result->>'success')::boolean,false);
BEGIN
  PERFORM public.retry_assert_user(p_user);
  SELECT * INTO r FROM public.retry_usage_reservations WHERE id=p_reservation AND user_id=p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation not found'; END IF;
  IF r.status <> 'reserved' THEN RETURN true; END IF;
  INSERT INTO public.openai_usage(user_id,job_id,kind,model,success,error,prompt_tokens,completion_tokens,estimated_cost_cents,resume_version_id,match_score)
    VALUES(p_user,r.job_id,'resume',p_result->>'model',v_success,left(p_result->>'error',200),coalesce((p_result->>'prompt_tokens')::integer,0),coalesce((p_result->>'completion_tokens')::integer,0),coalesce((p_result->>'estimated_cost_cents')::numeric,0)/2,(p_result->>'resume_id')::uuid,(p_result->>'match_score')::integer);
  INSERT INTO public.openai_usage(user_id,job_id,kind,model,success,error,prompt_tokens,completion_tokens,estimated_cost_cents,cover_letter_id,match_score)
    VALUES(p_user,r.job_id,'cover_letter',p_result->>'model',v_success,left(p_result->>'error',200),0,0,coalesce((p_result->>'estimated_cost_cents')::numeric,0)/2,(p_result->>'cover_id')::uuid,(p_result->>'match_score')::integer);
  UPDATE public.retry_usage_reservations SET status=CASE WHEN v_success THEN 'succeeded' ELSE 'failed' END, result=p_result, completed_at=now() WHERE id=r.id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.retry_finish_usage(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retry_finish_usage(uuid,uuid,jsonb) TO authenticated,service_role;

CREATE FUNCTION public.retry_packet_lock(p_user uuid,p_job uuid,p_token uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_count integer;
BEGIN
  PERFORM public.retry_assert_user(p_user);
  IF NOT EXISTS(SELECT 1 FROM public.job_listings WHERE id=p_job AND user_id=p_user) THEN RAISE EXCEPTION 'Job not found'; END IF;
  -- Expired locks are not stolen: a provider may still be running. Recovery requires review.
  INSERT INTO public.retry_packet_leases(user_id,job_id,token,expires_at) VALUES(p_user,p_job,p_token,now()+interval '15 minutes') ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END $$;
REVOKE ALL ON FUNCTION public.retry_packet_lock(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retry_packet_lock(uuid,uuid,uuid) TO authenticated,service_role;

CREATE FUNCTION public.retry_packet_unlock(p_user uuid,p_job uuid,p_token uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public.retry_assert_user(p_user);
  DELETE FROM public.retry_packet_leases WHERE user_id=p_user AND job_id=p_job AND token=p_token;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.retry_packet_unlock(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retry_packet_unlock(uuid,uuid,uuid) TO authenticated,service_role;

CREATE FUNCTION public.retry_claim(p_user uuid DEFAULT NULL,p_id uuid DEFAULT NULL,p_limit integer DEFAULT 3,p_lease_seconds integer DEFAULT 900) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_rows jsonb;
BEGIN
  IF auth.role() <> 'service_role' OR p_user IS NOT NULL THEN PERFORM public.retry_assert_user(p_user); END IF;
  IF p_limit < 1 OR p_limit > 3 OR p_lease_seconds <> 900 THEN RAISE EXCEPTION 'Invalid claim bounds'; END IF;
  WITH candidates AS (
    SELECT q.id FROM public.ai_retry_queue q JOIN public.retry_controls c ON c.user_id=q.user_id
    WHERE (p_user IS NULL OR q.user_id=p_user) AND (p_id IS NULL OR q.id=p_id)
      AND c.enabled AND NOT c.paused AND q.kind='packet'
      AND q.status IN ('queued','quota_limited') AND q.next_retry_at<=now()
      AND q.retry_attempts<q.max_attempts AND q.lease_token IS NULL
      AND NOT EXISTS(SELECT 1 FROM public.retry_packet_leases l WHERE l.user_id=q.user_id AND l.job_id=q.job_id)
    ORDER BY q.next_retry_at,q.id FOR UPDATE OF q SKIP LOCKED LIMIT p_limit
  ), claimed AS (
    UPDATE public.ai_retry_queue q SET status='retrying',lease_token=gen_random_uuid(),
      lease_expires_at=now()+make_interval(secs=>p_lease_seconds), started_at=now(),last_retry_at=now(),
      retry_attempts=q.retry_attempts+1,retry_status='in_progress',
      history=q.history || jsonb_build_array(jsonb_build_object('ts',now(),'event','claimed','attempt',q.retry_attempts+1))
    FROM candidates c WHERE q.id=c.id RETURNING q.*
  ) SELECT coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) INTO v_rows FROM claimed;
  RETURN v_rows;
END $$;
REVOKE ALL ON FUNCTION public.retry_claim(uuid,uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retry_claim(uuid,uuid,integer,integer) TO authenticated,service_role;

CREATE FUNCTION public.retry_finish(p_user uuid,p_id uuid,p_token uuid,p_result jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.ai_retry_queue; v_success boolean:=coalesce((p_result->>'success')::boolean,false); v_status text;
BEGIN
  PERFORM public.retry_assert_user(p_user);
  SELECT * INTO r FROM public.ai_retry_queue WHERE id=p_id AND user_id=p_user FOR UPDATE;
  IF NOT FOUND OR r.status<>'retrying' OR r.lease_token IS DISTINCT FROM p_token OR r.lease_expires_at<=now() THEN RETURN false; END IF;
  IF v_success AND NOT EXISTS (
    SELECT 1 FROM public.applications a
    JOIN public.resume_versions rv ON rv.id=a.resume_version_id AND rv.user_id=a.user_id AND rv.job_id=a.job_id
    JOIN public.cover_letters cl ON cl.id=a.cover_letter_id AND cl.user_id=a.user_id AND cl.job_id=a.job_id
    JOIN public.interview_prep ip ON ip.application_id=a.id AND ip.user_id=a.user_id AND ip.job_id=a.job_id
    WHERE a.user_id=p_user AND a.job_id=r.job_id AND a.status='manual_review'
      AND length(coalesce(rv.summary,''))>0 AND cardinality(rv.bullets)>0 AND length(coalesce(cl.body,''))>0 AND ip.brief<>'{}'::jsonb
  ) THEN RAISE EXCEPTION 'Packet artifacts missing'; END IF;
  v_status := CASE WHEN v_success THEN 'completed' WHEN r.retry_attempts>=r.max_attempts THEN 'failed' ELSE p_result->>'status' END;
  IF v_status NOT IN ('completed','failed','queued','quota_limited','paused') THEN RAISE EXCEPTION 'Invalid result status'; END IF;
  UPDATE public.ai_retry_queue SET status=v_status,retry_status=p_result->>'code',last_error=left(p_result->>'message',400),
    next_retry_at=CASE WHEN v_success THEN next_retry_at ELSE coalesce((p_result->>'next_retry_at')::timestamptz,next_retry_at) END,
    duration_ms=greatest(0,(extract(epoch FROM now()-started_at)*1000)::bigint),
    estimated_cost_cents=coalesce((SELECT sum(estimated_cost_cents) FROM public.openai_usage WHERE user_id=p_user AND job_id=r.job_id AND created_at>=r.started_at),0),
    lease_token=NULL,lease_expires_at=NULL,
    history=history || jsonb_build_array(p_result || jsonb_build_object('ts',now(),'attempt',r.retry_attempts)) WHERE id=p_id;
  IF coalesce((p_result->>'pause')::boolean,false) THEN
    UPDATE public.retry_controls SET paused=true,pause_reason=p_result->>'code',updated_at=now() WHERE user_id=p_user;
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.retry_finish(uuid,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retry_finish(uuid,uuid,uuid,jsonb) TO authenticated,service_role;

CREATE FUNCTION public.retry_recover_leases(p_user uuid DEFAULT NULL) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_count integer;
BEGIN
  IF auth.role()<>'service_role' OR p_user IS NOT NULL THEN PERFORM public.retry_assert_user(p_user); END IF;
  -- Never replay an abandoned/unknown inference automatically. Preserve packet locks for inspection.
  WITH abandoned AS (
    UPDATE public.ai_retry_queue SET status='paused',retry_status='abandoned_lease',last_error='Unknown provider outcome: review required',
      lease_token=NULL,lease_expires_at=NULL,
      history=history || jsonb_build_array(jsonb_build_object('ts',now(),'event','abandoned_lease'))
    WHERE (p_user IS NULL OR user_id=p_user) AND status='retrying' AND lease_expires_at<=now() RETURNING user_id
  ) UPDATE public.retry_controls SET paused=true,pause_reason='abandoned_lease',updated_at=now()
    WHERE user_id IN(SELECT user_id FROM abandoned);
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.retry_recover_leases(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retry_recover_leases(uuid) TO authenticated,service_role;

CREATE FUNCTION public.retry_resume(p_user uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public.retry_assert_user(p_user);
  IF EXISTS(SELECT 1 FROM public.retry_packet_leases WHERE user_id=p_user) THEN RAISE EXCEPTION 'Inspect outstanding packet leases before resuming'; END IF;
  UPDATE public.retry_controls SET paused=false,pause_reason=NULL,updated_at=now() WHERE user_id=p_user AND enabled;
  UPDATE public.ai_retry_queue SET status='queued',next_retry_at=now() WHERE user_id=p_user AND status IN('paused','quota_limited') AND retry_attempts<max_attempts;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.retry_resume(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retry_resume(uuid) TO authenticated,service_role;
