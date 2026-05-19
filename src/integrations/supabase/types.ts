export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_bootstrap: {
        Row: {
          enabled: boolean
          id: boolean
          target_email: string
          target_user_id: string
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          id?: boolean
          target_email: string
          target_user_id: string
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          id?: boolean
          target_email?: string
          target_user_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      applications: {
        Row: {
          application_url: string | null
          approved_at: string | null
          archived_at: string | null
          auto_submit_result: string | null
          auto_submitted_at: string | null
          confirmation_text: string | null
          cover_letter_id: string | null
          created_at: string
          final_interview_at: string | null
          follow_up_due_at: string | null
          freshness_bucket: string | null
          ghosted_at: string | null
          id: string
          interview_notes: string | null
          interview_requested_at: string | null
          job_id: string
          next_action_at: string | null
          next_action_label: string | null
          notes: string | null
          offer_at: string | null
          portfolio_project: string | null
          priority: Database["public"]["Enums"]["application_priority"] | null
          qc_failures: string[]
          qc_passed: boolean | null
          recruiter_contact_id: string | null
          recruiter_notes: string | null
          recruiter_screen_at: string | null
          rejected_at: string | null
          response_received_at: string | null
          resume_variant_key: string | null
          resume_version_id: string | null
          reviewed_at: string | null
          salary_expectation: string | null
          status: Database["public"]["Enums"]["application_status"]
          submission_notes: string | null
          submitted_at: string | null
          submitted_manual_at: string | null
          technical_interview_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          application_url?: string | null
          approved_at?: string | null
          archived_at?: string | null
          auto_submit_result?: string | null
          auto_submitted_at?: string | null
          confirmation_text?: string | null
          cover_letter_id?: string | null
          created_at?: string
          final_interview_at?: string | null
          follow_up_due_at?: string | null
          freshness_bucket?: string | null
          ghosted_at?: string | null
          id?: string
          interview_notes?: string | null
          interview_requested_at?: string | null
          job_id: string
          next_action_at?: string | null
          next_action_label?: string | null
          notes?: string | null
          offer_at?: string | null
          portfolio_project?: string | null
          priority?: Database["public"]["Enums"]["application_priority"] | null
          qc_failures?: string[]
          qc_passed?: boolean | null
          recruiter_contact_id?: string | null
          recruiter_notes?: string | null
          recruiter_screen_at?: string | null
          rejected_at?: string | null
          response_received_at?: string | null
          resume_variant_key?: string | null
          resume_version_id?: string | null
          reviewed_at?: string | null
          salary_expectation?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          submission_notes?: string | null
          submitted_at?: string | null
          submitted_manual_at?: string | null
          technical_interview_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          application_url?: string | null
          approved_at?: string | null
          archived_at?: string | null
          auto_submit_result?: string | null
          auto_submitted_at?: string | null
          confirmation_text?: string | null
          cover_letter_id?: string | null
          created_at?: string
          final_interview_at?: string | null
          follow_up_due_at?: string | null
          freshness_bucket?: string | null
          ghosted_at?: string | null
          id?: string
          interview_notes?: string | null
          interview_requested_at?: string | null
          job_id?: string
          next_action_at?: string | null
          next_action_label?: string | null
          notes?: string | null
          offer_at?: string | null
          portfolio_project?: string | null
          priority?: Database["public"]["Enums"]["application_priority"] | null
          qc_failures?: string[]
          qc_passed?: boolean | null
          recruiter_contact_id?: string | null
          recruiter_notes?: string | null
          recruiter_screen_at?: string | null
          rejected_at?: string | null
          response_received_at?: string | null
          resume_variant_key?: string | null
          resume_version_id?: string | null
          reviewed_at?: string | null
          salary_expectation?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          submission_notes?: string | null
          submitted_at?: string | null
          submitted_manual_at?: string | null
          technical_interview_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_cover_letter_id_fkey"
            columns: ["cover_letter_id"]
            isOneToOne: false
            referencedRelation: "cover_letters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "applications_resume_version_id_fkey"
            columns: ["resume_version_id"]
            isOneToOne: false
            referencedRelation: "resume_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      ats_checks: {
        Row: {
          created_at: string
          has_captcha: boolean | null
          has_mfa: boolean | null
          id: string
          job_id: string | null
          notes: string | null
          platform: string | null
          requires_login: boolean | null
          supported: boolean | null
          user_id: string
        }
        Insert: {
          created_at?: string
          has_captcha?: boolean | null
          has_mfa?: boolean | null
          id?: string
          job_id?: string | null
          notes?: string | null
          platform?: string | null
          requires_login?: boolean | null
          supported?: boolean | null
          user_id: string
        }
        Update: {
          created_at?: string
          has_captcha?: boolean | null
          has_mfa?: boolean | null
          id?: string
          job_id?: string | null
          notes?: string | null
          platform?: string | null
          requires_login?: boolean | null
          supported?: boolean | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ats_checks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_logs: {
        Row: {
          action: Database["public"]["Enums"]["automation_action"]
          application_id: string | null
          created_at: string
          details: Json | null
          id: string
          job_id: string | null
          status: string
          user_id: string
        }
        Insert: {
          action: Database["public"]["Enums"]["automation_action"]
          application_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          job_id?: string | null
          status?: string
          user_id: string
        }
        Update: {
          action?: Database["public"]["Enums"]["automation_action"]
          application_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          job_id?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_logs_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_logs_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_safety_logs: {
        Row: {
          action: string
          application_id: string | null
          ats: string | null
          company_name: string | null
          created_at: string
          gates: Json
          id: string
          job_id: string | null
          job_title: string | null
          reason: string | null
          user_id: string
        }
        Insert: {
          action: string
          application_id?: string | null
          ats?: string | null
          company_name?: string | null
          created_at?: string
          gates?: Json
          id?: string
          job_id?: string | null
          job_title?: string | null
          reason?: string | null
          user_id: string
        }
        Update: {
          action?: string
          application_id?: string | null
          ats?: string | null
          company_name?: string | null
          created_at?: string
          gates?: Json
          id?: string
          job_id?: string | null
          job_title?: string | null
          reason?: string | null
          user_id?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          careers_url: string | null
          category: Database["public"]["Enums"]["company_category"] | null
          created_at: string
          domain: string | null
          domain_age_days: number | null
          funding_stage: string | null
          glassdoor_rating: number | null
          has_linkedin: boolean | null
          hiring_activity: number | null
          id: string
          is_remote_first: boolean | null
          last_applied_at: string | null
          legitimacy_score: number | null
          linkedin_url: string | null
          mba_friendly: boolean | null
          name: string
          notes: string | null
          ranking_label: string | null
          ranking_score: number
          red_flags: string[] | null
          trust_score: number | null
          updated_at: string
          user_id: string
          verification_status:
            | Database["public"]["Enums"]["verification_status"]
            | null
        }
        Insert: {
          careers_url?: string | null
          category?: Database["public"]["Enums"]["company_category"] | null
          created_at?: string
          domain?: string | null
          domain_age_days?: number | null
          funding_stage?: string | null
          glassdoor_rating?: number | null
          has_linkedin?: boolean | null
          hiring_activity?: number | null
          id?: string
          is_remote_first?: boolean | null
          last_applied_at?: string | null
          legitimacy_score?: number | null
          linkedin_url?: string | null
          mba_friendly?: boolean | null
          name: string
          notes?: string | null
          ranking_label?: string | null
          ranking_score?: number
          red_flags?: string[] | null
          trust_score?: number | null
          updated_at?: string
          user_id: string
          verification_status?:
            | Database["public"]["Enums"]["verification_status"]
            | null
        }
        Update: {
          careers_url?: string | null
          category?: Database["public"]["Enums"]["company_category"] | null
          created_at?: string
          domain?: string | null
          domain_age_days?: number | null
          funding_stage?: string | null
          glassdoor_rating?: number | null
          has_linkedin?: boolean | null
          hiring_activity?: number | null
          id?: string
          is_remote_first?: boolean | null
          last_applied_at?: string | null
          legitimacy_score?: number | null
          linkedin_url?: string | null
          mba_friendly?: boolean | null
          name?: string
          notes?: string | null
          ranking_label?: string | null
          ranking_score?: number
          red_flags?: string[] | null
          trust_score?: number | null
          updated_at?: string
          user_id?: string
          verification_status?:
            | Database["public"]["Enums"]["verification_status"]
            | null
        }
        Relationships: []
      }
      cover_letters: {
        Row: {
          body: string
          created_at: string
          id: string
          job_id: string | null
          tone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          job_id?: string | null
          tone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          job_id?: string | null
          tone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cover_letters_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_batches: {
        Row: {
          applications_approved: number | null
          applications_prepared: number | null
          applications_submitted: number | null
          batch_date: string
          category: Database["public"]["Enums"]["company_category"]
          companies_reviewed: number | null
          created_at: string | null
          day_of_week: string
          id: string
          interview_responses: number | null
          jobs_found: number | null
          jobs_rejected: number | null
          status: string | null
          summary: Json | null
          user_id: string
        }
        Insert: {
          applications_approved?: number | null
          applications_prepared?: number | null
          applications_submitted?: number | null
          batch_date: string
          category: Database["public"]["Enums"]["company_category"]
          companies_reviewed?: number | null
          created_at?: string | null
          day_of_week: string
          id?: string
          interview_responses?: number | null
          jobs_found?: number | null
          jobs_rejected?: number | null
          status?: string | null
          summary?: Json | null
          user_id: string
        }
        Update: {
          applications_approved?: number | null
          applications_prepared?: number | null
          applications_submitted?: number | null
          batch_date?: string
          category?: Database["public"]["Enums"]["company_category"]
          companies_reviewed?: number | null
          created_at?: string | null
          day_of_week?: string
          id?: string
          interview_responses?: number | null
          jobs_found?: number | null
          jobs_rejected?: number | null
          status?: string | null
          summary?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      follow_up_messages: {
        Row: {
          application_id: string
          body: string
          created_at: string
          id: string
          job_id: string | null
          kind: string
          user_id: string
        }
        Insert: {
          application_id: string
          body: string
          created_at?: string
          id?: string
          job_id?: string | null
          kind: string
          user_id: string
        }
        Update: {
          application_id?: string
          body?: string
          created_at?: string
          id?: string
          job_id?: string | null
          kind?: string
          user_id?: string
        }
        Relationships: []
      }
      follow_up_tasks: {
        Row: {
          application_id: string
          completed_at: string | null
          created_at: string
          due_at: string
          id: string
          job_id: string | null
          kind: string
          notes: string | null
          status: string
          user_id: string
        }
        Insert: {
          application_id: string
          completed_at?: string | null
          created_at?: string
          due_at: string
          id?: string
          job_id?: string | null
          kind: string
          notes?: string | null
          status?: string
          user_id: string
        }
        Update: {
          application_id?: string
          completed_at?: string | null
          created_at?: string
          due_at?: string
          id?: string
          job_id?: string | null
          kind?: string
          notes?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      import_logs: {
        Row: {
          ats: string | null
          created_at: string
          details: Json | null
          duplicate: number | null
          found: number | null
          id: string
          imported: number | null
          manual_review: number | null
          message: string | null
          rejected: number | null
          skipped: number | null
          source_id: string | null
          source_url: string | null
          success: boolean | null
          user_id: string
        }
        Insert: {
          ats?: string | null
          created_at?: string
          details?: Json | null
          duplicate?: number | null
          found?: number | null
          id?: string
          imported?: number | null
          manual_review?: number | null
          message?: string | null
          rejected?: number | null
          skipped?: number | null
          source_id?: string | null
          source_url?: string | null
          success?: boolean | null
          user_id: string
        }
        Update: {
          ats?: string | null
          created_at?: string
          details?: Json | null
          duplicate?: number | null
          found?: number | null
          id?: string
          imported?: number | null
          manual_review?: number | null
          message?: string | null
          rejected?: number | null
          skipped?: number | null
          source_id?: string | null
          source_url?: string | null
          success?: boolean | null
          user_id?: string
        }
        Relationships: []
      }
      interview_briefs: {
        Row: {
          company_id: string | null
          company_name: string
          company_size: string | null
          created_at: string
          funding_stage: string | null
          headquarters: string | null
          id: string
          industry: string | null
          interview_themes: string[]
          job_id: string | null
          keywords: string[]
          leadership: string | null
          mission_values: string | null
          overview: string | null
          product_summary: string | null
          questions_to_ask: string[]
          recent_news: string | null
          recruiter_questions: string[]
          red_flags: string[]
          remote_policy: string | null
          role_questions: string[]
          star_outlines: string[]
          talking_points: string[]
          tell_me_about_yourself: string | null
          updated_at: string
          user_id: string
          why_company: string | null
          why_fit: string | null
          why_role: string | null
        }
        Insert: {
          company_id?: string | null
          company_name: string
          company_size?: string | null
          created_at?: string
          funding_stage?: string | null
          headquarters?: string | null
          id?: string
          industry?: string | null
          interview_themes?: string[]
          job_id?: string | null
          keywords?: string[]
          leadership?: string | null
          mission_values?: string | null
          overview?: string | null
          product_summary?: string | null
          questions_to_ask?: string[]
          recent_news?: string | null
          recruiter_questions?: string[]
          red_flags?: string[]
          remote_policy?: string | null
          role_questions?: string[]
          star_outlines?: string[]
          talking_points?: string[]
          tell_me_about_yourself?: string | null
          updated_at?: string
          user_id: string
          why_company?: string | null
          why_fit?: string | null
          why_role?: string | null
        }
        Update: {
          company_id?: string | null
          company_name?: string
          company_size?: string | null
          created_at?: string
          funding_stage?: string | null
          headquarters?: string | null
          id?: string
          industry?: string | null
          interview_themes?: string[]
          job_id?: string | null
          keywords?: string[]
          leadership?: string | null
          mission_values?: string | null
          overview?: string | null
          product_summary?: string | null
          questions_to_ask?: string[]
          recent_news?: string | null
          recruiter_questions?: string[]
          red_flags?: string[]
          remote_policy?: string | null
          role_questions?: string[]
          star_outlines?: string[]
          talking_points?: string[]
          tell_me_about_yourself?: string | null
          updated_at?: string
          user_id?: string
          why_company?: string | null
          why_fit?: string | null
          why_role?: string | null
        }
        Relationships: []
      }
      interview_prep: {
        Row: {
          application_id: string
          brief: Json
          created_at: string
          generated_at: string
          id: string
          job_id: string | null
          pitch_60s: string | null
          questions_to_ask: string[]
          recruiter_questions: string[]
          salary_talking_points: string | null
          star_answers: Json
          technical_questions: string[]
          user_id: string
        }
        Insert: {
          application_id: string
          brief?: Json
          created_at?: string
          generated_at?: string
          id?: string
          job_id?: string | null
          pitch_60s?: string | null
          questions_to_ask?: string[]
          recruiter_questions?: string[]
          salary_talking_points?: string | null
          star_answers?: Json
          technical_questions?: string[]
          user_id: string
        }
        Update: {
          application_id?: string
          brief?: Json
          created_at?: string
          generated_at?: string
          id?: string
          job_id?: string | null
          pitch_60s?: string | null
          questions_to_ask?: string[]
          recruiter_questions?: string[]
          salary_talking_points?: string | null
          star_answers?: Json
          technical_questions?: string[]
          user_id?: string
        }
        Relationships: []
      }
      job_listings: {
        Row: {
          ats: string | null
          blockers: string[] | null
          category: Database["public"]["Enums"]["company_category"] | null
          company_id: string | null
          company_name: string
          created_at: string
          dedupe_hash: string | null
          description: string | null
          final_score: number | null
          freshness_bucket: string | null
          id: string
          interview_probability: number | null
          legitimacy: number | null
          location: string | null
          posted_at: string | null
          ready_to_apply: boolean | null
          remote: boolean | null
          resume_match: number | null
          role_category: string | null
          salary_confidence: string
          salary_estimated: boolean | null
          salary_estimated_max: number | null
          salary_estimated_min: number | null
          salary_evidence: string[]
          salary_gate_reason: string | null
          salary_gate_status: string
          salary_max: number | null
          salary_min: number | null
          salary_posted_max: number | null
          salary_posted_min: number | null
          salary_source: string
          source_url: string | null
          status: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ats?: string | null
          blockers?: string[] | null
          category?: Database["public"]["Enums"]["company_category"] | null
          company_id?: string | null
          company_name: string
          created_at?: string
          dedupe_hash?: string | null
          description?: string | null
          final_score?: number | null
          freshness_bucket?: string | null
          id?: string
          interview_probability?: number | null
          legitimacy?: number | null
          location?: string | null
          posted_at?: string | null
          ready_to_apply?: boolean | null
          remote?: boolean | null
          resume_match?: number | null
          role_category?: string | null
          salary_confidence?: string
          salary_estimated?: boolean | null
          salary_estimated_max?: number | null
          salary_estimated_min?: number | null
          salary_evidence?: string[]
          salary_gate_reason?: string | null
          salary_gate_status?: string
          salary_max?: number | null
          salary_min?: number | null
          salary_posted_max?: number | null
          salary_posted_min?: number | null
          salary_source?: string
          source_url?: string | null
          status?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ats?: string | null
          blockers?: string[] | null
          category?: Database["public"]["Enums"]["company_category"] | null
          company_id?: string | null
          company_name?: string
          created_at?: string
          dedupe_hash?: string | null
          description?: string | null
          final_score?: number | null
          freshness_bucket?: string | null
          id?: string
          interview_probability?: number | null
          legitimacy?: number | null
          location?: string | null
          posted_at?: string | null
          ready_to_apply?: boolean | null
          remote?: boolean | null
          resume_match?: number | null
          role_category?: string | null
          salary_confidence?: string
          salary_estimated?: boolean | null
          salary_estimated_max?: number | null
          salary_estimated_min?: number | null
          salary_evidence?: string[]
          salary_gate_reason?: string | null
          salary_gate_status?: string
          salary_max?: number | null
          salary_min?: number | null
          salary_posted_max?: number | null
          salary_posted_min?: number | null
          salary_source?: string
          source_url?: string | null
          status?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_listings_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      job_sources: {
        Row: {
          ats: string | null
          careers_url: string
          created_at: string
          high_prob_count: number
          id: string
          interview_count: number
          last_import_count: number | null
          last_imported_at: string | null
          last_quality_recalc_at: string | null
          name: string
          notes: string | null
          priority_score: number
          quality_score_avg: number
          rejection_count: number
          response_count: number
          safety_block_count: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ats?: string | null
          careers_url: string
          created_at?: string
          high_prob_count?: number
          id?: string
          interview_count?: number
          last_import_count?: number | null
          last_imported_at?: string | null
          last_quality_recalc_at?: string | null
          name: string
          notes?: string | null
          priority_score?: number
          quality_score_avg?: number
          rejection_count?: number
          response_count?: number
          safety_block_count?: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ats?: string | null
          careers_url?: string
          created_at?: string
          high_prob_count?: number
          id?: string
          interview_count?: number
          last_import_count?: number | null
          last_imported_at?: string | null
          last_quality_recalc_at?: string | null
          name?: string
          notes?: string | null
          priority_score?: number
          quality_score_avg?: number
          rejection_count?: number
          response_count?: number
          safety_block_count?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      legitimacy_checks: {
        Row: {
          company_id: string | null
          created_at: string
          domain_age_days: number | null
          glassdoor_rating: number | null
          has_linkedin: boolean | null
          id: string
          red_flags: string[] | null
          score: number | null
          user_id: string
        }
        Insert: {
          company_id?: string | null
          created_at?: string
          domain_age_days?: number | null
          glassdoor_rating?: number | null
          has_linkedin?: boolean | null
          id?: string
          red_flags?: string[] | null
          score?: number | null
          user_id: string
        }
        Update: {
          company_id?: string | null
          created_at?: string
          domain_age_days?: number | null
          glassdoor_rating?: number | null
          has_linkedin?: boolean | null
          id?: string
          red_flags?: string[] | null
          score?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "legitimacy_checks_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_logs: {
        Row: {
          body: string
          channel: string
          created_at: string
          error: string | null
          id: string
          kind: string
          provider_sid: string | null
          status: string
          to_number: string | null
          user_id: string
        }
        Insert: {
          body: string
          channel?: string
          created_at?: string
          error?: string | null
          id?: string
          kind: string
          provider_sid?: string | null
          status?: string
          to_number?: string | null
          user_id: string
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string
          error?: string | null
          id?: string
          kind?: string
          provider_sid?: string | null
          status?: string
          to_number?: string | null
          user_id?: string
        }
        Relationships: []
      }
      openai_usage: {
        Row: {
          completion_tokens: number | null
          cover_letter_id: string | null
          created_at: string
          error: string | null
          estimated_cost_cents: number | null
          id: string
          job_id: string | null
          kind: string
          match_score: number | null
          model: string | null
          prompt_tokens: number | null
          resume_version_id: string | null
          success: boolean
          user_id: string
        }
        Insert: {
          completion_tokens?: number | null
          cover_letter_id?: string | null
          created_at?: string
          error?: string | null
          estimated_cost_cents?: number | null
          id?: string
          job_id?: string | null
          kind: string
          match_score?: number | null
          model?: string | null
          prompt_tokens?: number | null
          resume_version_id?: string | null
          success?: boolean
          user_id: string
        }
        Update: {
          completion_tokens?: number | null
          cover_letter_id?: string | null
          created_at?: string
          error?: string | null
          estimated_cost_cents?: number | null
          id?: string
          job_id?: string | null
          kind?: string
          match_score?: number | null
          model?: string | null
          prompt_tokens?: number | null
          resume_version_id?: string | null
          success?: boolean
          user_id?: string
        }
        Relationships: []
      }
      recruiter_contacts: {
        Row: {
          avg_response_hours: number
          company_id: string | null
          company_name: string | null
          contact_count: number
          created_at: string
          email: string | null
          id: string
          last_contact_at: string | null
          last_response_at: string | null
          name: string
          notes: string | null
          response_count: number
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avg_response_hours?: number
          company_id?: string | null
          company_name?: string | null
          contact_count?: number
          created_at?: string
          email?: string | null
          id?: string
          last_contact_at?: string | null
          last_response_at?: string | null
          name: string
          notes?: string | null
          response_count?: number
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avg_response_hours?: number
          company_id?: string | null
          company_name?: string | null
          contact_count?: number
          created_at?: string
          email?: string | null
          id?: string
          last_contact_at?: string | null
          last_response_at?: string | null
          name?: string
          notes?: string | null
          response_count?: number
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      resume_versions: {
        Row: {
          bullets: string[] | null
          created_at: string
          explanation: string | null
          id: string
          is_template: boolean
          job_id: string | null
          keywords: string[] | null
          label: string | null
          match_score: number | null
          skills: string[] | null
          summary: string | null
          target_role: string | null
          updated_at: string
          user_id: string
          variant_key: string
        }
        Insert: {
          bullets?: string[] | null
          created_at?: string
          explanation?: string | null
          id?: string
          is_template?: boolean
          job_id?: string | null
          keywords?: string[] | null
          label?: string | null
          match_score?: number | null
          skills?: string[] | null
          summary?: string | null
          target_role?: string | null
          updated_at?: string
          user_id: string
          variant_key?: string
        }
        Update: {
          bullets?: string[] | null
          created_at?: string
          explanation?: string | null
          id?: string
          is_template?: boolean
          job_id?: string | null
          keywords?: string[] | null
          label?: string | null
          match_score?: number | null
          skills?: string[] | null
          summary?: string | null
          target_role?: string | null
          updated_at?: string
          user_id?: string
          variant_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "resume_versions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      user_settings: {
        Row: {
          active_weekdays: number[]
          application_mode: string
          auto_apply: boolean | null
          auto_review_daily_cap: number
          automation_paused: boolean
          company_cooldown_days: number
          created_at: string
          daily_cap: number | null
          email: string | null
          excluded_ats: string[]
          excluded_companies: string[]
          friday_prepare_only: boolean
          full_name: string | null
          id: string
          linkedin_url: string | null
          location: string | null
          manual_review_only: boolean | null
          onboarded_at: string | null
          packet_daily_cap: number
          per_ats_daily_cap: number
          phone_number: string | null
          remote_only: boolean
          role_categories: string[]
          safe_auto_submit_confirmed_at: string | null
          safe_auto_submit_daily_cap: number
          safe_auto_submit_dry_run: boolean
          safe_auto_submit_dry_run_passed_at: string | null
          safe_auto_submit_dry_run_report: Json | null
          safe_auto_submit_enabled: boolean
          salary_min: number
          schedule_hour: number
          schedule_minute: number
          sms_daily_cap: number
          sms_enabled: boolean
          sms_notify_auto_mode: boolean
          sms_notify_batch_complete: boolean
          sms_notify_batch_start: boolean
          sms_notify_followups: boolean
          sms_notify_high_probability: boolean
          sms_notify_manual_mode: boolean
          sms_notify_safety_block: boolean
          target_roles: string[] | null
          trust_threshold: number | null
          updated_at: string
          user_id: string
          website: string | null
        }
        Insert: {
          active_weekdays?: number[]
          application_mode?: string
          auto_apply?: boolean | null
          auto_review_daily_cap?: number
          automation_paused?: boolean
          company_cooldown_days?: number
          created_at?: string
          daily_cap?: number | null
          email?: string | null
          excluded_ats?: string[]
          excluded_companies?: string[]
          friday_prepare_only?: boolean
          full_name?: string | null
          id?: string
          linkedin_url?: string | null
          location?: string | null
          manual_review_only?: boolean | null
          onboarded_at?: string | null
          packet_daily_cap?: number
          per_ats_daily_cap?: number
          phone_number?: string | null
          remote_only?: boolean
          role_categories?: string[]
          safe_auto_submit_confirmed_at?: string | null
          safe_auto_submit_daily_cap?: number
          safe_auto_submit_dry_run?: boolean
          safe_auto_submit_dry_run_passed_at?: string | null
          safe_auto_submit_dry_run_report?: Json | null
          safe_auto_submit_enabled?: boolean
          salary_min?: number
          schedule_hour?: number
          schedule_minute?: number
          sms_daily_cap?: number
          sms_enabled?: boolean
          sms_notify_auto_mode?: boolean
          sms_notify_batch_complete?: boolean
          sms_notify_batch_start?: boolean
          sms_notify_followups?: boolean
          sms_notify_high_probability?: boolean
          sms_notify_manual_mode?: boolean
          sms_notify_safety_block?: boolean
          target_roles?: string[] | null
          trust_threshold?: number | null
          updated_at?: string
          user_id: string
          website?: string | null
        }
        Update: {
          active_weekdays?: number[]
          application_mode?: string
          auto_apply?: boolean | null
          auto_review_daily_cap?: number
          automation_paused?: boolean
          company_cooldown_days?: number
          created_at?: string
          daily_cap?: number | null
          email?: string | null
          excluded_ats?: string[]
          excluded_companies?: string[]
          friday_prepare_only?: boolean
          full_name?: string | null
          id?: string
          linkedin_url?: string | null
          location?: string | null
          manual_review_only?: boolean | null
          onboarded_at?: string | null
          packet_daily_cap?: number
          per_ats_daily_cap?: number
          phone_number?: string | null
          remote_only?: boolean
          role_categories?: string[]
          safe_auto_submit_confirmed_at?: string | null
          safe_auto_submit_daily_cap?: number
          safe_auto_submit_dry_run?: boolean
          safe_auto_submit_dry_run_passed_at?: string | null
          safe_auto_submit_dry_run_report?: Json | null
          safe_auto_submit_enabled?: boolean
          salary_min?: number
          schedule_hour?: number
          schedule_minute?: number
          sms_daily_cap?: number
          sms_enabled?: boolean
          sms_notify_auto_mode?: boolean
          sms_notify_batch_complete?: boolean
          sms_notify_batch_start?: boolean
          sms_notify_followups?: boolean
          sms_notify_high_probability?: boolean
          sms_notify_manual_mode?: boolean
          sms_notify_safety_block?: boolean
          target_roles?: string[] | null
          trust_threshold?: number | null
          updated_at?: string
          user_id?: string
          website?: string | null
        }
        Relationships: []
      }
      verification_checks: {
        Row: {
          ats_domain_match: boolean | null
          business_footprint_score: number | null
          company_id: string | null
          created_at: string | null
          decision: string | null
          has_careers_page: boolean | null
          has_linkedin: boolean | null
          has_official_site: boolean | null
          id: string
          news_signals_count: number | null
          payment_request: boolean | null
          personal_email_domain: boolean | null
          raw: Json | null
          scam_flags: string[] | null
          score: number | null
          user_id: string
        }
        Insert: {
          ats_domain_match?: boolean | null
          business_footprint_score?: number | null
          company_id?: string | null
          created_at?: string | null
          decision?: string | null
          has_careers_page?: boolean | null
          has_linkedin?: boolean | null
          has_official_site?: boolean | null
          id?: string
          news_signals_count?: number | null
          payment_request?: boolean | null
          personal_email_domain?: boolean | null
          raw?: Json | null
          scam_flags?: string[] | null
          score?: number | null
          user_id: string
        }
        Update: {
          ats_domain_match?: boolean | null
          business_footprint_score?: number | null
          company_id?: string | null
          created_at?: string | null
          decision?: string | null
          has_careers_page?: boolean | null
          has_linkedin?: boolean | null
          has_official_site?: boolean | null
          id?: string
          news_signals_count?: number | null
          payment_request?: boolean | null
          personal_email_domain?: boolean | null
          raw?: Json | null
          scam_flags?: string[] | null
          score?: number | null
          user_id?: string
        }
        Relationships: []
      }
      weekly_learning_reports: {
        Row: {
          created_at: string
          id: string
          payload: Json
          recommendations: string[]
          user_id: string
          week_end: string
          week_start: string
        }
        Insert: {
          created_at?: string
          id?: string
          payload?: Json
          recommendations?: string[]
          user_id: string
          week_end: string
          week_start: string
        }
        Update: {
          created_at?: string
          id?: string
          payload?: Json
          recommendations?: string[]
          user_id?: string
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      application_priority: "high" | "good" | "manual" | "skip"
      application_status:
        | "queued"
        | "manual_review"
        | "approved"
        | "submitted"
        | "interview"
        | "rejected"
        | "offer"
        | "withdrawn"
        | "submitted_manually"
        | "follow_up_due"
        | "interview_requested"
        | "ghosted"
        | "archived"
        | "imported"
        | "reviewed"
        | "submitted_manual"
        | "recruiter_screen"
        | "technical_interview"
        | "final_interview"
        | "safety_blocked"
        | "skipped_cap"
        | "submitted_automatically"
      automation_action:
        | "scrape"
        | "score"
        | "tailor_resume"
        | "generate_cover"
        | "submit"
        | "export_packet"
        | "legitimacy_check"
        | "ats_check"
        | "follow_up"
      company_category:
        | "saas"
        | "data"
        | "cs_ops"
        | "product_pm"
        | "remote_first"
        | "mba_friendly"
        | "other"
      verification_status: "verified" | "manual_review" | "rejected"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      application_priority: ["high", "good", "manual", "skip"],
      application_status: [
        "queued",
        "manual_review",
        "approved",
        "submitted",
        "interview",
        "rejected",
        "offer",
        "withdrawn",
        "submitted_manually",
        "follow_up_due",
        "interview_requested",
        "ghosted",
        "archived",
        "imported",
        "reviewed",
        "submitted_manual",
        "recruiter_screen",
        "technical_interview",
        "final_interview",
        "safety_blocked",
        "skipped_cap",
        "submitted_automatically",
      ],
      automation_action: [
        "scrape",
        "score",
        "tailor_resume",
        "generate_cover",
        "submit",
        "export_packet",
        "legitimacy_check",
        "ats_check",
        "follow_up",
      ],
      company_category: [
        "saas",
        "data",
        "cs_ops",
        "product_pm",
        "remote_first",
        "mba_friendly",
        "other",
      ],
      verification_status: ["verified", "manual_review", "rejected"],
    },
  },
} as const
