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
      applications: {
        Row: {
          cover_letter_id: string | null
          created_at: string
          follow_up_due_at: string | null
          id: string
          job_id: string
          notes: string | null
          portfolio_project: string | null
          priority: Database["public"]["Enums"]["application_priority"] | null
          resume_version_id: string | null
          status: Database["public"]["Enums"]["application_status"]
          submitted_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cover_letter_id?: string | null
          created_at?: string
          follow_up_due_at?: string | null
          id?: string
          job_id: string
          notes?: string | null
          portfolio_project?: string | null
          priority?: Database["public"]["Enums"]["application_priority"] | null
          resume_version_id?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          submitted_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cover_letter_id?: string | null
          created_at?: string
          follow_up_due_at?: string | null
          id?: string
          job_id?: string
          notes?: string | null
          portfolio_project?: string | null
          priority?: Database["public"]["Enums"]["application_priority"] | null
          resume_version_id?: string | null
          status?: Database["public"]["Enums"]["application_status"]
          submitted_at?: string | null
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
          id: string
          interview_probability: number | null
          legitimacy: number | null
          location: string | null
          posted_at: string | null
          ready_to_apply: boolean | null
          remote: boolean | null
          resume_match: number | null
          role_category: string | null
          salary_estimated: boolean | null
          salary_max: number | null
          salary_min: number | null
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
          id?: string
          interview_probability?: number | null
          legitimacy?: number | null
          location?: string | null
          posted_at?: string | null
          ready_to_apply?: boolean | null
          remote?: boolean | null
          resume_match?: number | null
          role_category?: string | null
          salary_estimated?: boolean | null
          salary_max?: number | null
          salary_min?: number | null
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
          id?: string
          interview_probability?: number | null
          legitimacy?: number | null
          location?: string | null
          posted_at?: string | null
          ready_to_apply?: boolean | null
          remote?: boolean | null
          resume_match?: number | null
          role_category?: string | null
          salary_estimated?: boolean | null
          salary_max?: number | null
          salary_min?: number | null
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
      resume_versions: {
        Row: {
          bullets: string[] | null
          created_at: string
          explanation: string | null
          id: string
          job_id: string | null
          keywords: string[] | null
          label: string | null
          match_score: number | null
          skills: string[] | null
          summary: string | null
          target_role: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          bullets?: string[] | null
          created_at?: string
          explanation?: string | null
          id?: string
          job_id?: string | null
          keywords?: string[] | null
          label?: string | null
          match_score?: number | null
          skills?: string[] | null
          summary?: string | null
          target_role?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          bullets?: string[] | null
          created_at?: string
          explanation?: string | null
          id?: string
          job_id?: string | null
          keywords?: string[] | null
          label?: string | null
          match_score?: number | null
          skills?: string[] | null
          summary?: string | null
          target_role?: string | null
          updated_at?: string
          user_id?: string
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
          auto_apply: boolean | null
          created_at: string
          daily_cap: number | null
          email: string | null
          full_name: string | null
          id: string
          location: string | null
          manual_review_only: boolean | null
          target_roles: string[] | null
          trust_threshold: number | null
          updated_at: string
          user_id: string
          website: string | null
        }
        Insert: {
          auto_apply?: boolean | null
          created_at?: string
          daily_cap?: number | null
          email?: string | null
          full_name?: string | null
          id?: string
          location?: string | null
          manual_review_only?: boolean | null
          target_roles?: string[] | null
          trust_threshold?: number | null
          updated_at?: string
          user_id: string
          website?: string | null
        }
        Update: {
          auto_apply?: boolean | null
          created_at?: string
          daily_cap?: number | null
          email?: string | null
          full_name?: string | null
          id?: string
          location?: string | null
          manual_review_only?: boolean | null
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
      automation_action:
        | "scrape"
        | "score"
        | "tailor_resume"
        | "generate_cover"
        | "submit"
        | "export_packet"
        | "legitimacy_check"
        | "ats_check"
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
