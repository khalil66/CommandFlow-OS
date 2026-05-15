// Words / patterns indicating a scam job posting
export const SCAM_PHRASES = [
  "pay to apply", "registration fee", "training fee", "application fee",
  "buy your own equipment", "purchase equipment", "send check", "cashier's check",
  "money order", "wire transfer", "western union", "moneygram",
  "bitcoin", "btc", "crypto wallet", "usdt", "ethereum payment",
  "earn $", "easy money", "work from home and earn", "$500 a day",
  "no experience needed and earn", "guaranteed income",
  "send your bank", "send ssn", "social security number to apply",
  "gift cards", "amazon gift card",
];

export const PERSONAL_EMAIL_DOMAINS = [
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com",
  "icloud.com", "live.com", "msn.com", "proton.me", "protonmail.com",
  "mail.com", "yandex.com", "gmx.com",
];

export function detectScamFlags(text: string): string[] {
  const t = (text || "").toLowerCase();
  return SCAM_PHRASES.filter((p) => t.includes(p));
}

export function isPersonalEmailDomain(domain?: string | null): boolean {
  if (!domain) return false;
  return PERSONAL_EMAIL_DOMAINS.includes(domain.toLowerCase().trim());
}
