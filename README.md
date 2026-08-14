# Career Command

Build an AI Remote Job Application Command Center for Khalil Hickson.

Use this profile:

Location: Jacksonville, FL

Website: khalilhickson.com

Target roles: Data Analyst, Technical Operations Specialist, Customer Success Manager, Project Manager, Operations Analyst, Technical Support Engineer, SaaS Support Specialist

Skills: SQL, Tableau, Excel, Salesforce, Zendesk, Data Analysis, KPI Optimization, Forecasting, Operations Strategy

Experience highlights: 10,000+ Tier 2/3 tickets analyzed, 25% escalation reduction, 91% CSAT, 35% fulfillment efficiency improvement, KPI dashboards, forecasting models, customer revenue analysis

Build these pages:

Dashboard

Job Search Queue

Company Legitimacy Checker

ATS Filter

Resume Tailoring Studio

Application Tracker

Manual Review Queue

Analytics Dashboard

Settings

Core logic:

Only support Greenhouse, Lever, Ashby, and Breezy HR

Automatically reject Workday, Taleo, SAP SuccessFactors, login-required applications, MFA, CAPTCHA, and suspicious companies

Score every job by resume match, company legitimacy, ATS compatibility, salary, remote status, and role fit

Auto-prepare applications but require approval before final submission unless trust score is 90+

Track daily application count, response rate, interview rate, and best-performing resume versions

Create a clean SaaS-style UI using cards, tables, filters, charts, and status badges.
Use Supabase as the database.
Use OpenAI API for resume tailoring and job matching.
Use Playwright or Browserbase for browser automation. Add advanced filters to the Job Search Queue:

Filters:

Remote only

Salary minimum

Job title

ATS platform

Company legitimacy score

Resume match score

No login required

No MFA

No CAPTCHA

U.S.-based roles only

Exclude staffing agencies

Exclude commission-only roles

Exclude unpaid roles

Add scoring:

Resume Match Score: 0–100

ATS Compatibility Score: 0–100

Company Legitimacy Score: 0–100

Application Difficulty Score: Easy, Medium, Hard

Final Apply Score: weighted total

Rules:
If ATS is not Greenhouse, Lever, Ashby, or Breezy HR, mark as Unsupported.
If login, MFA, or CAPTCHA is detected, move to Manual Review.
If legitimacy score is under 70, reject.
If final score is 90+, mark as Ready to Apply.Create a Resume Tailoring Studio.

Inputs:

Job title

Job description

Company name

Master resume

Target role category

The AI should generate:

Tailored professional summary

Optimized skills section

5–7 job-specific resume bullets

ATS keyword list

Short cover letter

Match score explanation

Use Khalil Hickson’s background:

Data Analyst and Technical Operations Specialist

SQL, Tableau, Excel, Zendesk, Salesforce

10,000+ support cases analyzed

25% escalation reduction

91% CSAT

KPI dashboards

Forecasting models

Operations efficiency improvements

Keep writing professional, ATS-friendly, and human-sounding.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://khalils-job-ace.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/e3d15bed-bdda-4965-9151-a59c323e34ae).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
