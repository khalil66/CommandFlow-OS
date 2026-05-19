ALTER TABLE public.job_listings
  DROP CONSTRAINT IF EXISTS job_listings_salary_source_check;

ALTER TABLE public.job_listings
  ADD CONSTRAINT job_listings_salary_source_check
  CHECK (salary_source = ANY (ARRAY[
    -- legacy
    'posted_salary','estimated_from_title','estimated_from_market','missing',
    'company_careers_page','verified_market_estimate','salary_review_sources','title_based_estimate',
    -- new canonical short codes
    'posted','estimated','recruiter','glassdoor','levelsfyi','inferred','unknown'
  ]));