ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'safety_blocked';
ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'skipped_cap';