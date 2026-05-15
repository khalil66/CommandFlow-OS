import jsPDF from "jspdf";

export interface ResumePacket {
  job: { title: string; company_name: string; location?: string | null; ats?: string | null; salary_min?: number | null; salary_max?: number | null; source_url?: string | null };
  resume?: { summary?: string | null; skills?: string[] | null; bullets?: string[] | null; keywords?: string[] | null; match_score?: number | null } | null;
  cover?: { body?: string | null } | null;
  prep?: {
    quality_score?: number;
    confidence?: string;
    why_company?: string;
    portfolio_project?: string | null;
    talking_points?: string[];
    recruiter_questions?: string[];
    technical_questions?: string[];
    star_examples?: Array<{ question: string; situation: string; task: string; action: string; result: string }>;
    linkedin_tips?: string[];
    ats_summary?: string;
  } | null;
}

const CANDIDATE = {
  name: "Khalil Hickson",
  title: "Data Analyst & Technical Operations Specialist",
  location: "Jacksonville, FL",
  website: "khalilhickson.com",
};

export function exportApplicationPdf(packet: ResumePacket, filename: string) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 48;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const maxW = pageW - margin * 2;
  let y = margin;

  const ensureSpace = (h: number) => {
    if (y + h > pageH - margin) { doc.addPage(); y = margin; }
  };
  const heading = (text: string, size = 11) => {
    ensureSpace(size + 8);
    doc.setFont("helvetica", "bold").setFontSize(size).setTextColor(20);
    doc.text(text.toUpperCase(), margin, y);
    y += size + 4;
    doc.setDrawColor(180).line(margin, y, margin + maxW, y);
    y += 10;
  };
  const para = (text: string, size = 10) => {
    if (!text) return;
    doc.setFont("helvetica", "normal").setFontSize(size).setTextColor(40);
    const lines = doc.splitTextToSize(text, maxW);
    for (const line of lines) { ensureSpace(size + 4); doc.text(line, margin, y); y += size + 4; }
    y += 4;
  };
  const bullets = (items: string[], size = 10) => {
    doc.setFont("helvetica", "normal").setFontSize(size).setTextColor(40);
    for (const item of items) {
      const lines = doc.splitTextToSize(`•  ${item}`, maxW - 12);
      for (let i = 0; i < lines.length; i++) {
        ensureSpace(size + 4);
        doc.text(lines[i], margin + (i === 0 ? 0 : 12), y);
        y += size + 4;
      }
    }
    y += 4;
  };

  // Header
  doc.setFont("helvetica", "bold").setFontSize(20).setTextColor(20);
  doc.text(CANDIDATE.name, margin, y); y += 22;
  doc.setFont("helvetica", "normal").setFontSize(11).setTextColor(80);
  doc.text(`${CANDIDATE.title}  ·  ${CANDIDATE.location}  ·  ${CANDIDATE.website}`, margin, y);
  y += 22;

  // Application packet metadata
  heading("Application Target");
  para(`${packet.job.title}  —  ${packet.job.company_name}`);
  const meta: string[] = [];
  if (packet.job.location) meta.push(packet.job.location);
  if (packet.job.ats) meta.push(`ATS: ${packet.job.ats}`);
  if (packet.job.salary_min) meta.push(`Salary: $${(packet.job.salary_min/1000).toFixed(0)}k–$${(packet.job.salary_max ?? 0)/1000}k`);
  if (packet.resume?.match_score != null) meta.push(`Match: ${packet.resume.match_score}/100`);
  if (meta.length) para(meta.join("  ·  "));
  if (packet.job.source_url) para(`Source: ${packet.job.source_url}`);

  if (packet.resume?.summary) {
    heading("Professional Summary");
    para(packet.resume.summary);
  }
  if (packet.resume?.skills?.length) {
    heading("Core Skills");
    para(packet.resume.skills.join("  ·  "));
  }
  if (packet.resume?.bullets?.length) {
    heading("Tailored Experience Highlights");
    bullets(packet.resume.bullets);
  }
  if (packet.resume?.keywords?.length) {
    heading("ATS Keywords");
    para(packet.resume.keywords.join(", "), 9);
  }
  if (packet.cover?.body) {
    doc.addPage(); y = margin;
    heading("Cover Letter");
    para(packet.cover.body);
  }

  if (packet.prep) {
    doc.addPage(); y = margin;
    heading("Application Readiness");
    if (packet.prep.quality_score != null) para(`Quality: ${packet.prep.quality_score}/100  ·  ${packet.prep.confidence ?? ""}`);
    if (packet.prep.portfolio_project) para(`Recommended portfolio project: ${packet.prep.portfolio_project}`);
    if (packet.prep.ats_summary) para(packet.prep.ats_summary);
    if (packet.prep.why_company) { heading("Why This Company"); para(packet.prep.why_company); }
    if (packet.prep.talking_points?.length) { heading("Talking Points"); bullets(packet.prep.talking_points); }
    if (packet.prep.recruiter_questions?.length) { heading("Likely Recruiter Questions"); bullets(packet.prep.recruiter_questions); }
    if (packet.prep.technical_questions?.length) { heading("Likely Technical Questions"); bullets(packet.prep.technical_questions); }
    if (packet.prep.star_examples?.length) {
      heading("STAR Examples");
      for (const s of packet.prep.star_examples) {
        para(`Q: ${s.question}`);
        bullets([`S: ${s.situation}`, `T: ${s.task}`, `A: ${s.action}`, `R: ${s.result}`]);
      }
    }
    if (packet.prep.linkedin_tips?.length) { heading("LinkedIn Optimization"); bullets(packet.prep.linkedin_tips); }
  }

  doc.save(filename);
}
