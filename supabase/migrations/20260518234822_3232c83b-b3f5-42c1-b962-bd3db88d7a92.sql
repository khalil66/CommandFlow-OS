
-- Safe Auto-Submit settings
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS safe_auto_submit_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS safe_auto_submit_daily_cap integer NOT NULL DEFAULT 3;

-- Audit fields on applications
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS auto_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_submit_result text,
  ADD COLUMN IF NOT EXISTS confirmation_text text;

-- Extend enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'submitted_automatically'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'application_status')) THEN
    ALTER TYPE application_status ADD VALUE 'submitted_automatically';
  END IF;
END $$;
