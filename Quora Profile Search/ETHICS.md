# Ethical Use Policy

This tool helps people find publicly available **professional** information about professionals in the United States and Europe, for legitimate professional outreach. Anyone who deploys or uses it agrees to this policy.

## 1. What is collected
- Only professional information a person chose to publish: job title, employer, skills, experience, and professional links (GitHub, LinkedIn, personal site, portfolio).
- Only people whose public profile places them in the United States or Europe (EU/EEA, UK, Switzerland and other European countries).
- By default, only people with a GitHub profile they linked themselves or an email address they published.
- Only email addresses the person published themselves, on their own site, their GitHub profile's public email field, or their own Reddit post. Personal addresses (e.g. Gmail) are labeled *personal* and can be switched off in Settings. Phone numbers, home addresses, and information about family, health, religion, politics, sexuality, ethnicity or finances are **never** collected.
- Every stored detail keeps its public source URL and discovery date. If something can't be traced to a public source, it isn't stored.

## 2. How it is collected
- **Official APIs and permitted search APIs only.** Quora: search-engine API results. Quora is never crawled. Medium: search-engine API results plus each author's official public RSS feed. Medium pages are never crawled. Reddit: official Data API, within its rate limits. Without API keys, search-engine snippets of public posts only; Reddit is never crawled, and records from snippets expire after 30 days because deletions can't be checked. GitHub: official REST API. LinkedIn: search snippets only, never crawled.
- **Personal websites:** fetched only where robots.txt allows, with an identifying user agent and at most one request per second per site.
- The tool **never** logs in to accounts, uses others' credentials, solves CAPTCHAs, rotates IPs, or gets around rate limits, paywalls, privacy settings, or any other access control. A 401, 403 or 429 response means stop.
- Résumé files and document hosts (Google Docs/Drive, Dropbox) aren't read, because they often contain private details.

## 3. Accuracy and honesty
- AI output is never stored as fact by itself. Extracted fields are checked against the source text, and unsupported values are discarded. Missing information stays blank.
- A profile is **verified** only through an explicit cross-link, such as a website linking back to the person's account. Matching names alone never establish identity.
- The interface always distinguishes *verified*, *self-reported* and *possible*. AI summaries are labeled as interpretation.
- User edits are marked as user-provided and kept apart from discovered data.

## 4. Pseudonymous accounts (Reddit)
- Reddit accounts are treated as pseudonymous. The tool doesn't try to work out who is behind an account, never searches other sites for a username, and never links accounts based on writing style or name similarity.
- Only links and contact details the author posted themselves are used. Communities where people advertise their own services (e.g. r/forhire) are the default sources.
- When a source post is deleted or removed, the record built from it is deleted during the daily sync, in line with Reddit's Data API Terms.

## 5. Acceptable use
**Allowed:** recruiting, hiring freelancers or contractors, partnership or business-development outreach, and professional networking, sent to the contact the person published for that purpose.

**Not allowed:**
- spam, bulk unsolicited messaging, or adding people to mailing lists without consent;
- selling, renting, or reselling the data, or feeding it to data brokers;
- harassment, stalking, doxxing, intimidation, or locating someone physically;
- building profiles of private individuals, or monitoring people;
- any eligibility decision about credit, employment screening, housing or insurance (FCRA-regulated uses);
- training AI models on collected personal data.

## 6. Legal compliance
Users are responsible for complying with applicable law and platform terms, including:
- **CAN-SPAM** for commercial email: identify yourself, include a working opt-out, and honor it promptly;
- state privacy laws such as **CCPA/CPRA** (California) and similar laws in other states, including deletion requests;
- for people in Europe, the **GDPR / UK GDPR**: have a lawful basis (usually legitimate interest, balanced against the person's interests), tell people where you got their data (normally in your first message and at the latest within one month, per Article 14), and honor objections and deletion requests. Under **ePrivacy** rules, many EU countries require prior consent for unsolicited marketing email, especially to personal addresses;
- **GitHub's** Acceptable Use Policy: information from GitHub, including public profile emails, may not be used for spam, which includes sending unsolicited emails to users. Emails sourced from GitHub are flagged in the app;
- **Reddit's** Developer Terms, Data API Terms and Responsible Builder Policy (commercial use requires Reddit's approval), plus **Quora's**, **Medium's**, **LinkedIn's** and **GitHub's** terms.

## 7. Removal requests and retention
- Anyone may ask for their information to be removed. Delete the record (Contacts → person → Delete). This removes the person, their profiles and their contacts. Don't collect it again.
- Keep records only while there's a legitimate professional purpose, and review stored contacts periodically.
- Deployments must use access control (the MVP has no user accounts) and keep the database private.
