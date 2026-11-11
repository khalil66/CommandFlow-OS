import { z } from "zod";

export const resumeArgsSchema = z.object({
  title: z.string().min(1).max(500),
  company: z.string().min(1).max(500),
  category: z.string().max(100).optional(),
  job_description: z.string().min(10).max(50000),
  job_id: z.string().uuid().optional(),
  save: z.boolean().default(true),
});

export const resumeOutputSchema = z.object({
  matchScore: z.number().min(0).max(100),
  summary: z.string().min(20),
  skills: z.array(z.string().min(1)).min(1),
  bullets: z.array(z.string().min(1)).min(1),
  keywords: z.array(z.string().min(1)).min(1),
  cover: z.string().min(20),
  explanation: z.string().min(1),
  ats_readability: z.number().min(0).max(100),
});

export const prepOutputSchema = z.object({
  talking_points: z.array(z.string().min(1)).min(1),
  recruiter_questions: z.array(z.string().min(1)).min(1),
  technical_questions: z.array(z.string().min(1)).min(1),
  star_examples: z.array(z.object({
    question: z.string().min(1),
    situation: z.string().min(1),
    task: z.string().min(1),
    action: z.string().min(1),
    result: z.string().min(1),
  })).min(1),
  why_company: z.string().min(1),
  linkedin_tips: z.array(z.string().min(1)).min(1),
  ats_summary: z.string().min(1),
  readiness_explanation: z.string().min(1),
});