-- ============================================================================
-- CommandFlow OS — Company Discovery Intelligence Layer
-- Phase 3.1: Scout → Source relational link. Additive schema ONLY.
--
-- Authorized scope, exactly: one nullable column, one index. Nothing else
-- in this migration.
--   - public.job_sources.company_id uuid NULL REFERENCES public.companies(id)
--     ON DELETE SET NULL
--   - index on public.job_sources(company_id)
--
-- Explicitly NOT done here (per the Phase 3.1 authorization):
--   - NOT NULL is deliberately NOT applied. Every job_sources row created
--     before this migration has no company linkage today (the table has no
--     such column at all until this migration runs) — company_id must stay
--     nullable so those rows keep working exactly as they do now, via
--     ingest.functions.ts's existing name-based company lookup. A future
--     phase may choose to require it once every row is confidently linked;
--     that is not this migration's decision to make.
--   - NO backfill by company name in this migration. Guessing a link from
--     job_sources.name -> companies.name blindly, inside a schema-change
--     migration, risks mis-linking two different companies that happen to
--     share a display name (e.g. different legal entities, different
--     regions) with no reviewable diff. Backfilling — if ever done — belongs
--     in its own separate, reviewed script that can report exactly which
--     rows it linked and on what confidence, not inside this migration.
--
-- Why ON DELETE SET NULL, not ON DELETE CASCADE:
--   A job_sources row is independently useful ingestion CONFIGURATION
--   (careers_url, ats, status, last_imported_at/last_import_count, and the
--   import_logs history keyed off its id) — it is not merely a child record
--   of a companies row. If a companies row is later deleted (a dedup pass,
--   a manual cleanup, a future merge operation), CASCADE would silently
--   delete the job_sources row too, permanently losing that ingestion
--   configuration and orphaning its import_logs as an unintended side
--   effect of an action that was only ever "about" the companies table.
--   SET NULL instead preserves the job_sources row untouched and simply
--   drops the now-invalid link — which is exactly the same state every
--   pre-Phase-3.1 job_sources row is already in today, a state
--   ingest.functions.ts already handles correctly via its existing
--   name-based fallback lookup. No new failure mode is introduced either
--   way; SET NULL is simply the non-destructive choice.
--
-- Rollback: see the companion file
--   supabase/rollback_scripts/ROLLBACK_20260816140000_job_sources_company_id.sql
-- (kept OUTSIDE supabase/migrations/ so the Supabase CLI never auto-applies
-- it as a forward migration — run it manually only if this phase needs to
-- be reverted). Safe to run at any time after this migration, provided no
-- later phase's application code has started depending on company_id being
-- non-null anywhere (Phase 3.1's own code never assumes that).
-- ============================================================================

alter table public.job_sources
  add column if not exists company_id uuid references public.companies(id) on delete set null;

create index if not exists idx_job_sources_company_id
  on public.job_sources (company_id);

comment on column public.job_sources.company_id is
  'Phase 3.1 — nullable link to companies.id. NULL for every row created before this migration, and for any row where Company Scout could not establish an unambiguous link. ingest.functions.ts (runImportJobsPipeline) falls back to its existing name-based company lookup whenever this is null — identical behavior to every pre-Phase-3.1 row. Never backfilled blindly by name in this migration.';

-- ============================================================================
-- End of Phase 3.1 schema change. Summary:
--   1 table altered: public.job_sources (+1 nullable column: company_id)
--   1 new index:     idx_job_sources_company_id
--
-- Nothing above changes ingest.functions.ts's, company-discovery.functions.ts's,
-- auto-review-scoring.ts's, or scoring.ts's runtime behavior by itself — this
-- is schema only. The application-code changes that read/write company_id
-- are the rest of the Phase 3.1 work, tracked separately in the same
-- session's diff.
-- ============================================================================
