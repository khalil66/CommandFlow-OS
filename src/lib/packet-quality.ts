export type Confidence = "Strong Match" | "Good Match" | "Stretch Opportunity" | "Low Probability";

export function confidenceLabel(quality: number): Confidence {
  if (quality >= 88) return "Strong Match";
  if (quality >= 75) return "Good Match";
  if (quality >= 60) return "Stretch Opportunity";
  return "Low Probability";
}

export interface QualityInputs {
  resume_match: number; // 0-100
  keyword_alignment: number; // 0-100
  portfolio_alignment: number; // 0-100 (100 if mapped, 50 otherwise)
  interview_probability: number; // 0-100
  trust_score: number; // 0-100
  ats_compatibility: number; // 100 if supported, 30 otherwise
  salary_quality: number; // 0-100 (≥75K = 100, ≥55K = 75, missing = 50, below = 0)
}

export function computeQuality(i: QualityInputs): {
  score: number;
  breakdown: Record<string, number>;
} {
  const w = {
    resume_match: 0.18,
    keyword_alignment: 0.14,
    portfolio_alignment: 0.1,
    interview_probability: 0.2,
    trust_score: 0.16,
    ats_compatibility: 0.12,
    salary_quality: 0.1,
  };
  const b: Record<string, number> = {};
  let total = 0;
  for (const [k, weight] of Object.entries(w)) {
    const v = Math.max(0, Math.min(100, i[k as keyof QualityInputs] ?? 0));
    b[k] = Math.round(v * weight);
    total += v * weight;
  }
  return { score: Math.round(total), breakdown: b };
}
