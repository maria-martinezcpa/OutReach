---
name: resume-mohamed-jd
description: Generate a tailored ATS-safe .docx resume for Mohamed Hagag (BIM coordinator / BIM engineer with architecture, interior design, and construction background) from a job description. Use whenever the user pastes a job description (JD) for Mohamed, invokes /resume-mohamed-jd, asks to tailor Mohamed's or Mohamed Hagag's resume to a JD, or requests an ATS docx with locked contact (hagagdesign0026@gmail.com, LinkedIn, portfolio links), locked career history from Mohamed_Hagag_BIM_Engineer.docx, BIM-first positioning, bold key-skill emphasis, and canonical layout.
---

# Resume Mohamed JD

## Purpose
Generate one tailored, ATS-safe `.docx` resume for **Mohamed Hagag** based on the provided JD.

**Canonical reference (since 2026-10-12):** `Mohamed_Hagag_BIM_Engineer.docx`, the user-supplied BIM Engineer resume kept in the skill folder (and at the workspace root). It is the source of truth for the headline, summary, technical skills, the Saboo Inc. title and BIM bullets, and every other bullet, project, and education line. `Mohamed Hagag ATS CV 26.pdf` remains as historical background only, and where it disagrees with the BIM Engineer docx, the docx wins. Since 2026-10-12 `build_resume.py` builds a **compact version** of that docx (same facts, merged bullets, one-line projects, six skills lines, 2–4 bold summary terms) to meet the Length Budget. The docx stays the source for facts; the compact build is the layout and length baseline. The layout and section order follow the approved `Josue_Resume.docx` pattern (adopted 2026-09-16 for the resume-faizan-jd skill and reused here unchanged): SUMMARY, TECHNICAL SKILLS, EXPERIENCE, PROJECTS, EDUCATION, with underlined section headers and roles nested under one company row. **Before every run**, read the canonical reference from the skill folder (or the current workspace if a newer copy is present there) and treat it as the source of truth for employers, dates, role titles, projects, education, and baseline bullets.

**Never revert** to an older history that omits the current Saboo Inc. role, lists James Cubitt & Partners as the current employer, or drops the GCC, Egypt, or early-career entries unless the user explicitly asks.

## Input
- Treat all user-provided JD text as the primary tailoring source.
- **Job URL input (user instruction 2026-10-12):** when the user gives a job posting URL, fetch the posting with WebFetch and use the fetched job description as the JD. If the page cannot be fetched or returns no usable JD text (login wall, expired post, empty page), say so and ask the user to paste the JD instead of guessing. When the user gives both a URL and pasted text, use the pasted text as the JD and still record the URL.
- Extract company and role target from JD for filename and positioning.
- JD tailoring applies to **summary wording**, **experience bullets**, and **technical skills keywords/order** only, not locked employers, dates, locations, role titles, projects skeleton, education entries, or canonical section order.

## Non-Negotiable Accuracy Rules
1. Never change locked company names, locations, or dates.
2. Never fabricate tools, roles, certifications, licences, or achievements.
3. Keep tool and market chronology truthful by role date (see Tool Temporal Rules).
4. For each run, generate exactly one new tailored resume `.docx` output.
5. Never change locked contact information (phone, email, LinkedIn, portfolio links).
6. Do not invent unsupported employers, education, certifications, projects, tools, or career claims. Do not copy old resume content verbatim. Rebuild the resume dynamically from the patterns below.

## Bold and Emphasis Usage (Mandatory)
Recruiter-scannable emphasis, modelled on the approved reference layout: headings bold, category labels bold, and **selective inline bold on key skills, tools, and metrics** inside bullets so mandatory JD skills stand out at a glance.

**Bold for structure:**
- Name line: `Mohamed Hagag`
- ALL CAPS section headers: `SUMMARY`, `TECHNICAL SKILLS`, `EXPERIENCE`, `PROJECTS`, `EDUCATION`, `CERTIFICATIONS` (each with a thin bottom border)
- Project name lines under `PROJECTS`
- Technical skills **category labels** only (e.g. `Scheduling & Project Controls:`), items stay regular
- Company rows, role rows, and education lines are **regular** weight (Josue layout)

**Inline bold inside bullets (experience and projects):**
- Bold **2–4 key terms per bullet**: tools, processes, core skills, and metrics that match the JD (e.g. `**Procore**`, `**RFIs**` and `**submittals**`, `**Primavera P6**`, `**$12M**` public works project).
- Prioritise JD-mandatory skills first, then evergreen construction and architecture terms. Every JD must-have the candidate legitimately covers should appear bold at least once in EXPERIENCE.
- Never bold whole sentences, verbs, or filler. Never bold more than roughly 30% of a bullet's words.
- Summary carries **2–4 bold primary skill terms** inline, never bold sentences.

**Regular (non-bold) for all other content:**
- Title line, contact lines, company rows, dates, role/location rows, tools lines, technical skills items, education lines

**Italics only where specified:**
- Experience role title row (left side)
- `Tools:` line at the end of each employer block (italic, size 20, format `Tools: item, item, item`)

## Locked Experience Data (Immutable)

### Company rows (regular company name, regular overall date range, right-aligned)
**History simplification (2026-10-06):** the user asked for overlapping employment to be removed so the career reads as one clean sequence. Three entries from the canonical PDF are therefore excluded from every resume: `Independent (Freelance)` 2023–2025 (overlapped Property Consultant, BEE, TAW, and James Cubitt), `ARCHIPRISM` 2017–2019 (overlapped INCEPTIONCO), and `El Nour for Real Estate Investments` Jul–Aug 2018 (overlapped INCEPTIONCO). Do not reintroduce them unless the user asks. Remote-work evidence comes from the summary positioning, not from a freelance row.

One company row per employer, each with a single role row beneath it. **DAR internship removed (2026-10-06):** the user asked to drop the `Site Architect Intern` stint (Jul–Aug 2019) at DAR as no longer useful at this career stage. DAR for Project Management Co. is now a single row for the site role only, dated `Sep 2020 – Nov 2021`. Do not reintroduce the internship unless the user asks.

| Company row (left) | Overall dates (right) |
|---|---|
| `Saboo Inc.` | `Jun 2026 – Present` |
| `James Cubitt & Partners` | `Jul 2025 – Feb 2026` |
| `TAW Developments` | `Jan 2025 – Jul 2025` |
| `BEE Group` | `Oct 2024 – Dec 2024` |
| `Egy Property / El Shams Eiffell / Insider Real Estate` | `Sep 2023 – Sep 2024` |
| `Egyptian Armed Forces Engineering Authority` | `Jan 2022 – Mar 2023` |
| `DAR for Project Management Co.` | `Sep 2020 – Nov 2021` |
| `Hany Saad Innovations` | `Jul 2020 – Aug 2020` |
| `INCEPTIONCO` | `2018 – 2019` |

### Role rows (italic title, left; `dates · location`, right) — locked for all resumes
Use these **exact** italic role rows on **every** tailored resume, regardless of JD focus. The right side is the role's own date range, a middle dot, then the location.

| Company | Role title (italic, left) | Right side |
|---|---|---|
| Saboo Inc. | `BIM Engineer / Assistant Project Manager` | `Jun 2026 – Present · California, USA` |
| James Cubitt & Partners | `Design Architect` | `Jul 2025 – Feb 2026 · GCC (UAE, Saudi Arabia, Qatar)` |
| TAW Developments | `Architect / 3D Visualizer` | `Jan 2025 – Jul 2025 · Cairo, Egypt` |
| BEE Group | `Interior Designer` | `Oct 2024 – Dec 2024 · Cairo, Egypt` |
| Egy Property / El Shams Eiffell / Insider Real Estate | `Property Consultant` | `Sep 2023 – Sep 2024 · Cairo, Egypt` |
| Egyptian Armed Forces Engineering Authority | `Technical / Administrative Support (Military Service)` | `Jan 2022 – Mar 2023 · Egypt` |
| DAR for Project Management Co. | `Site Architect / Implementation Engineer` | `Sep 2020 – Nov 2021 · Cairo, Egypt` |
| Hany Saad Innovations | `Interior Designer Intern` | `Jul 2020 – Aug 2020 · Cairo, Egypt` |
| INCEPTIONCO | `Co-Founder / VR Specialist` | `2018 – 2019 · Cairo, Egypt` |

Each role row is followed by its own bullets. An italic `Tools:` line closes the Saboo, James Cubitt, TAW, and DAR blocks only; one-bullet roles (BEE, Property Consultant, Armed Forces, Hany Saad, INCEPTIONCO) have no Tools line (see Length Budget).

**Do not** JD-tailor, rename, or swap these role titles per run. **Do not** drop the DAR site role, the military service entry, the property consultant year, or any early-career entry, and **do not** omit Saboo Inc.

**Do not** invent titles or employers not listed above unless the user explicitly confirms a new verified entry.

**Content by JD type (bullets/skills only, titles unchanged):**
- **BIM / VDC / Revit coordination roles (default lane):** Saboo federated models, clash detection, CDE in ACC/BIM 360, BEP and ISO 19650, model audits, QTO and 4D, IFC/BCF; James Cubitt Revit documentation and multidisciplinary coordination with Navisworks model review; TAW and DAR Revit/AutoCAD modeling and drawing-to-site verification.
- **Construction / project management / project engineer roles:** Saboo submittals, RFIs, procurement, bidding, public works compliance; DAR site execution and progress monitoring; TAW tenant coordination.
- **Architecture / design roles:** James Cubitt GCC design coordination, TAW plans/elevations/facades, DAR design-to-site implementation.
- **BIM / visualization / CGI roles:** TAW 3D visualization, INCEPTIONCO VR/AR, Revit/3ds Max/Twinmotion/Lumion depth, portfolio links.
- **Interior design roles:** BEE Group villa renovation, DAR four-villa interiors, Hany Saad internship.
- **Real estate / development roles:** Property consultant year, TAW developer-side work.

Violations never allowed:
- Listing James Cubitt & Partners, TAW Developments, or any earlier employer as the current role
- Reintroducing the removed DAR internship, Freelance, ARCHIPRISM, or El Nour entries
- Dropping Saboo Inc. or any locked employer, including the early-career entries
- Changing locked locations or date ranges
- Adding unlisted employers or institutions
- Changing locked phone, email, LinkedIn, or portfolio links
- Renaming locked role titles
- Using `Architect`, `Architectural Designer`, or `Landscape Architect` in the headline or as a present-tense self-description without a confirmed US licence
- Adding certifications or licences (PMP, LEED, PE, RA, ARB, RIBA, etc.) other than the locked OSHA 30-Hour Construction certificate in Fixed Certifications

## Locked Header (Immutable default)
Center-aligned block, in this order:

1. **Name (bold):** `Mohamed Hagag`
2. **Title line (regular, fixed frame with role-based insertion):**
   Base (adopted 2026-10-12 from the user-approved `Mohamed_Hagag_BIM_Engineer.docx`):
   `BIM Coordinator | Project Designer | Revit, Navisworks & ACC/BIM 360 | Architecture & Interior Design | Construction Coordination`
   Keep the five-segment frame (`<primary role> | <secondary role> | <BIM tool segment> | <discipline segment> | <domain segment>`) and adjust **at most two segments** per JD:
   - **Primary role segment (first)** defaults to `BIM Coordinator`. It may mirror the JD title only from this allowed list: `BIM Coordinator`, `BIM Engineer` (his held title at Saboo Inc.), `BIM Specialist`, `BIM Modeler`, `BIM Designer`, `Revit Designer`, `VDC Coordinator` (only when the JD title itself says VDC). For design-lane JDs (architecture, interiors, visualization) the first segment may switch to `Project Designer`, `Designer`, `Interior Designer`, or `3D Visualizer`, and for construction-lane JDs (APM, project engineer, project coordinator, preconstruction, field) to `Assistant Project Manager`. No other first-segment values are allowed.
   - **Secondary role segment** defaults to `Project Designer`. Use `Assistant Project Manager` for construction-heavy BIM/VDC JDs, or `BIM Coordinator` when the first segment moved to a design or construction title.
   - **BIM tool segment** lists the JD's top supported BIM tools in JD order, from: `Revit`, `Navisworks`, `ACC/BIM 360`, `AutoCAD`, `Bluebeam`. Never list a tool the candidate does not cover.
   - **Discipline segment** — default `Architecture & Interior Design`; adjust to the JD, e.g. `Architecture & BIM Coordination`, `Architecture & Construction Management`, `Interior Design & Architecture`.
   - **Domain segment (last)** — default `Construction Coordination`; adjust for domain roles, e.g. `Clash Detection • CDE Management • ISO 19650`, `Construction Documents • Model Coordination`, `Submittals & RFIs • Site Execution`.
   - **Title licensing guardrail (US):** Mohamed holds no US architect licence and no professional engineering licence. Never use `Architect`, `Project Architect`, `Design Architect`, `Architectural Designer`, or `Architectural Revit Designer` in the headline. `Engineer` may appear **only** as `BIM Engineer`, which matches his held role title and is not a protected engineering title. Never use `Structural Engineer`, `MEP Engineer`, `Civil Engineer`, `Mechanical Engineer`, `Electrical Engineer`, `Professional Engineer`, or `PE`. Historical role rows earned abroad (`Design Architect`, `Architect / 3D Visualizer`, `Site Architect / Implementation Engineer`) stay verbatim in EXPERIENCE because they are factual employment records.
   - **Seniority guardrail:** no `Senior`, `Sr.`, `Lead`, `Principal`, or `BIM Manager` in the headline. His formal BIM coordination role began Jun 2026. Use a senior title only when the user explicitly asks for it.
   - **Past titles are never retitled.** On 2026-10-12 the user asked to rename earlier roles (BEE Group and earlier) as BIM roles to show 3+ years of BIM experience. This was declined because titles at named employers are checked in background and reference checks. Show BIM depth through the Revit thread instead, and keep every locked role title verbatim.
3. **Contact line (regular, pipe separators):**
   `San Francisco, CA | +1 (415) 740-6090 | hagagdesign0026@gmail.com | linkedin.com/in/mohamed-hagag-480083266`
4. **Portfolio line (regular, pipe separators, same style as the contact line):**
   `behance.net/mohamedlhagag | cgarchitect.com/members/mohamedlhagag | issuu.com/mohamedlhagag/docs/mohamed_hagag_portfolio`

Deeper JD-specific positioning belongs in the **summary** and **bullets**. Never rewrite a role segment outside the allowed values or drop the pipe structure. The Saboo Inc. role row in EXPERIENCE stays `BIM Engineer / Assistant Project Manager` regardless of the headline.

## BIM-Led Positioning (Mandatory, default since 2026-10-12)

Every generated resume reads as a **BIM coordinator who runs model coordination and the common data environment on live US projects, backed by 8+ years of Revit-based design documentation, multidisciplinary coordination, and site execution**. Design and construction depth are the supporting advantages, not the lead.

Apply this positioning through wording and order:

- Lead Saboo Inc. bullets with BIM coordination: federated architectural, structural, and MEP models in Navisworks Manage, clash detection and clash reports, CDE management in ACC/BIM 360, BIM standards against the BEP and ISO 19650, LOD and model audits, quantity take-offs and 4D sequencing, Revit sheets/views/families, and IFC/BCF exchange. Submittals, RFIs, and drawing review follow. Payroll and administrative compliance bullets stay last.
- **Revit thread (2026-10-12):** the first bullet of James Cubitt, TAW, and DAR must name Revit (Navisworks model review at James Cubitt only), so the BIM modeling thread reads continuously from 2020 to the present. Frame these as Revit modeling, documentation, and coordination, never as clash detection, CDE, BEP, or ISO 19650 work. BEE Group, Property Consultant, Armed Forces, Hany Saad, and INCEPTIONCO carry no Revit claim.
- Describe visualization as a design communication tool tied to decisions and documentation, never as standalone artwork.
- Never use first-person phrasing.
- In the summary, state BIM coordination ownership first, then the phase span and the project types, then Revit documentation. See BIM ATS Pattern.
- In `TECHNICAL SKILLS`, keep `BIM Coordination & Standards` first and `Revit & BIM Modeling` second (see Technical Skills Rewriting).
- **Design-lane exception** (architecture, interiors, 3D visualization JDs with no BIM coordination ask): switch to the design-led order. Headline first segment `Project Designer` (or the allowed design title), design ownership leads every design role, `Revit & BIM Modeling` and `Creative & Visualization` move ahead of `BIM Coordination & Standards`, and Saboo BIM bullets follow drawing review rather than leading.
- **Construction-lane exception** (APM, project engineer, project coordinator, preconstruction, field): submittals, RFIs, procurement, scheduling, and site execution lead, with BIM coordination positioned as the technical advantage. Headline first segment `Assistant Project Manager`.

## BIM ATS Pattern (Mandatory, 2026-10-19)

Taken from the architecture-field resumes that score, and applied here without leaving the BIM lane. BIM screens still want coordination. They also want the deliverable, the phase, and the building type in the same place a parser can read them. A resume that only names Navisworks, ACC, and a fee loses that screen.

Use this shape on every BIM resume:

1. The summary names BIM coordination, then the phase span `design development through construction`, then at least three project types he actually delivered: residential, hospitality, mixed-use, or public.
2. The first skills line leads with deliverables (`Federated Models`, `Clash Detection & Reporting`, `Construction Documents`, `Sheet Sets`). Software names follow those nouns on the same line.
3. One of the six skills lines is `Project Types`, a plain list of building types. Do not add a seventh category.
4. Each of the first three Saboo bullets and the first James Cubitt bullet uses: **one action, one BIM or drawing product, one phase, one type or size.** Example: coordinated federated models in Navisworks through construction for a public pump station.
5. Coordination means architectural, structural, and MEP information and the consultants on the project. Do not open a bullet with payroll, folder permissions, or an ISO clause. Those may follow the deliverable bullets.
6. Project bullets lead with the building type and the size. The fee may appear after the task. It does not open the sentence.

Do not import unsupported tools from those sample resumes. No ETABS, SAP2000, Civil 3D, structural design, HVAC design, or LEED.

## Locked Contact Data (Immutable)
- Phone: +1 (415) 740-6090 (locked, always printed on the contact line)
- Email: hagagdesign0026@gmail.com (locked, set 2026-10-01). Never use the legacy emails `mohamedhagag7@outlook.com` or `mhagag3007@gmail.com` on output resumes.
- LinkedIn: linkedin.com/in/mohamed-hagag-480083266
- Portfolio: behance.net/mohamedlhagag, cgarchitect.com/members/mohamedlhagag, issuu.com/mohamedlhagag/docs/mohamed_hagag_portfolio

**Contact line and portfolio line are mandatory on every resume variant.** Always use pipe-separated format including **phone, email, and full LinkedIn URL** on the contact line and all three portfolio links on the portfolio line:

`San Francisco, CA | +1 (415) 740-6090 | hagagdesign0026@gmail.com | linkedin.com/in/mohamed-hagag-480083266`
`behance.net/mohamedlhagag | cgarchitect.com/members/mohamedlhagag | issuu.com/mohamedlhagag/docs/mohamed_hagag_portfolio`

**Never use on output resumes:**
- Any email other than the locked `hagagdesign0026@gmail.com`, including the legacy emails `mohamedhagag7@outlook.com` and `mhagag3007@gmail.com`
- Contact blocks that omit LinkedIn or the portfolio line
- Any other phone number or a non-US location

## Tool Temporal Rules (Critical)
- **Saboo Inc. (Jun 2026–Present), role `BIM Engineer / Assistant Project Manager`:** Navisworks Manage (Clash Detective, TimeLiner), ACC/BIM 360 (Docs, Model Coordination), Revit (sheets, views, families, quantity take-offs), IFC/BCF exchange, federated model coordination, clash detection and reporting, CDE management, BIM Execution Plan, ISO 19650, LOD requirements, model audits, 4D sequencing, plus Procore, Buildern, Buildertrend, Primavera P6, Microsoft Project, Smartsheet, Bluebeam Revu, and Excel tracking. This is the **only** role that may carry formal BIM coordination claims (clash detection, CDE management, BEP, ISO 19650, LOD, model audits, 4D, QTO, IFC/BCF). Do not backdate them. This is the **only** role that may carry US public works compliance claims (DIR certified payroll, prevailing wage, California Apprenticeship Council training fund contributions, contractor prequalification, bid bonds, pre-bid walkthroughs). Project values ($18.5M combined, $12M, $3M, $3.5M) belong here only.
- **James Cubitt & Partners (Jul 2025–Feb 2026):** GCC design codes and regional regulations (UAE, Saudi Arabia, Qatar), multidisciplinary design coordination, Revit, AutoCAD, Navisworks (model review only), SketchUp, Rhino, visualization tools allowed. No clash detection management, CDE, BEP, or ISO 19650 claims, no US public works, no Procore claims.
- **TAW Developments (Jan 2025–Jul 2025):** Plans, elevations, facades, 3D visualization (3ds Max, Lumion, Twinmotion, Revit, AutoCAD, Photoshop), tenant plan review and supervision, developer-side coordination. Project metrics (10 buildings, 24,000 m² site, 42,000 m² BUA, 7,800 m² footprint, 16-building compound) belong here only.
- **BEE Group (Oct 2024–Dec 2024):** Interior design, mood boards, material concepts, drawings, 3D visuals for a New Cairo villa renovation. No construction management software claims.
- **Property Consultant (Sep 2023–Sep 2024):** Client communication, negotiation, market analysis, stakeholder management, developer product insight. No design software or site claims.
- **Egyptian Armed Forces Engineering Authority (Jan 2022–Mar 2023):** Documentation, coordination, and tracking support for government engineering and construction projects, administrative and technical office work. No design software or client-facing claims beyond documentation.
- **DAR for Project Management Co. site role (Sep 2020–Nov 2021):** Site execution, drawing and specification compliance, progress monitoring, high-end finishing works, renovation and interior execution for four villas, AutoCAD/Revit for site coordination. No Procore/ACC claims, no US compliance.
- **Hany Saad (Jul 2020–Aug 2020):** Internship-level support only (interior design support). No ownership or leadership claims.
- **INCEPTIONCO (2018–2019):** VR/AR real-time simulation of designs, co-founder and VR specialist claims allowed. No construction management claims.

## Length Budget (Mandatory, user instruction 2026-10-12)
Every resume must fit in **about 2.5 pages (A4) and never more than 3 pages**. The approved compact baseline measures about 2.6 pages. Hit the budget by cutting repetition, never by shrinking fonts, margins, or spacing from the Canonical Layout Specification.

- Saboo Inc. **9** bullets by default (5 BIM, then 4 merged construction bullets: drawing review with submittals, RFIs, Procore/ACC logs, and P6 scheduling; the $18.5M project line; preconstruction plus prequalification; public works compliance). A 10th is allowed only if the build still measures 2.75 pages or less. The CERTIFICATIONS section (added 2026-10-12) costs about two lines, which is why the default dropped to 9. James Cubitt **5**. TAW **4**. DAR **4**. BEE, Property Consultant, Armed Forces, Hany Saad, INCEPTIONCO **1 each**.
- `Tools:` lines only for Saboo, James Cubitt, TAW, and DAR. Omit them for 1-bullet roles.
- `TECHNICAL SKILLS`: **6 categories**, 9–13 items each.
- `PROJECTS`: all 8 projects, **one bullet each**.
- Summary stays one paragraph of 70–100 words.
- When a JD needs extra emphasis, swap bullets rather than add them. Adding a bullet to one role means removing or merging one elsewhere.
- **Measure before delivering.** Run `python page_count.py <output.docx>` from the skill folder (Word automation via pywin32; install with `pip install pywin32` if missing). It prints the page where each section starts and the estimated total. If the result exceeds 2.75 pages, trim the lowest-priority bullets (early roles first, then the last Saboo construction bullets) and rebuild. If Word is unavailable, say so in the report rather than guessing a page count.

## Required Resume Structure
Match the canonical section order exactly (Josue layout):

1. Header (name, locked title line, contact line, portfolio line)
2. **SUMMARY**
3. **TECHNICAL SKILLS**
4. **EXPERIENCE**
5. **PROJECTS**
6. **EDUCATION**
7. **CERTIFICATIONS** (default since 2026-10-12, see Fixed Certifications)

Section headings: ALL CAPS, **bold**, plain text, each with a thin single black bottom border (`sz 6`, `space 1`). No tinted fill bars, no tables, no sidebars.

**Do not include** `CORE COMPETENCIES`, `SELECTED EARLY EXPERIENCE`, `PORTFOLIO`, `ADDITIONAL VALUE`, certifications other than the locked OSHA 30 entry, references, hobbies, photos, sidebars, equipment lists, or cover-letter content unless explicitly requested. Core competencies fold into `TECHNICAL SKILLS` as a `Project Coordination & Controls` category, early experience folds into `EXPERIENCE` as locked company blocks, and portfolio links live on the header portfolio line.

## Canonical Layout Specification (Mandatory)

**Page and font**
- A4 page size (**11906 x 16838** DXA)
- Font: **Calibri** throughout, document default run size 21
- Default body: **21** half-points (10.5pt)
- Margins: top/bottom **720** DXA (0.5 in), left/right **576** DXA (0.4 in)

**Header block (center-aligned)**
- Name: **Mohamed Hagag**, bold, size **44** (22pt), spacing after **40**
- Title line: regular, size **20** (10pt), spacing after **40**, `|` separators
- Contact line: regular, size **20** (10pt), spacing after **40**, pipe `|` separators
- Portfolio line: regular, size **20** (10pt), spacing after **120**, pipe `|` separators

**Section headers**
- Bold, size **22** (11pt), spacing before **180**, after **60**
- Bottom border: single, black (`000000`), size **6**, space **1**

**Summary**
- One paragraph, size **21** (10.5pt), spacing after **80**, with 2–4 inline bold primary skill terms
- Baseline references **8+ years**, construction and architecture delivery across the United States, Egypt, and GCC markets, and the M.Sc. Construction Management track where relevant

**Experience metadata rows**
- Right tab stop: **10800** DXA, left-justified paragraph
- Company row: regular company name, regular overall date range, size **22** (11pt), spacing before **120** per employer block. The tab sits inside the company `TextRun` after the name text
- Dates: en-dash (e.g. `Jul 2025 – Feb 2026`)
- Role row: italic title, size **20** (10pt), left; right side regular size 20 `dates · location` (middle dot `·`), spacing after **60**
- Each company row has one role row, followed by its own bullets
- `keepNext` / `keepLines` on company rows and role rows **only**. Never set `keepNext` on bullets: it chains a whole employer block together and Word pushes the block to the next page, leaving large white gaps between employers. Bullets flow freely across page breaks

**Experience bullets**
- List bullets (`●`, indent left 720, hanging 360), regular, size **21** (10.5pt), spacing after **40**, with inline bold on 2–4 key terms per bullet
- Third person verbs, no `I`

**Experience tools line**
- One italic line per employer (company block) after its last role's bullets: `Tools: item, item, item`, size **20**, spacing after **40**
- Lists the tools actually used in that role per the temporal rules, JD-reordered, 8–13 items for Saboo and James Cubitt, 5–8 for TAW and DAR, none for one-bullet roles

**Technical skills**
- `Category: item, item, item` per line
- Category label bold, remaining items regular, size **21** (10.5pt), spacing after **40**

**Projects**
- Project name: **bold**, size **22** (11pt), spacing before **80**, after **40**, `keepNext`
- One bulleted sentence per project, size 21, spacing after **40**, with 1–3 inline bold terms
- Do not merge title and description into one line

**Education** (second-to-last section, before CERTIFICATIONS)
- One regular line per entry, size **21** (10.5pt), spacing after **40**, format `Degree, Institution, City, Country (Mon YYYY – Mon YYYY)` or `(Expected YYYY)` for in-progress degrees
- No bold, no tab stops

## Manual Fallback Formatting Spec

If `Mohamed_Resume.docx` is not available (the canonical reference is a PDF, so this spec is the primary build instruction until an approved docx exists), recreate the layout manually with these settings:

- Page setup: A4.
- Margins: top 0.5 in, bottom 0.5 in, left 0.4 in, right 0.4 in.
- Header/footer: do not use visible headers or footers.
- Font family: Calibri throughout. Color: black text only.
- Layout: single column, no tables, no sidebars, no icons, no graphics, no decorative lines.
- Line spacing: single spacing throughout.
- Body font size: 10.5 pt for summary, experience bullets, skills, education, and project bullets.
- Use tab-separated right-aligned dates (tab stop 10800 DXA) instead of tables. Section headers get a thin bottom border.
- Length is capped by the Length Budget (about 2.5 pages, never over 3). Keep the layout and structure fixed, cut content rather than spacing, and never leave white gaps between employer blocks (no `keepNext` on bullets, no page breaks).

## Punctuation and Prose Rules (Mandatory)

**Required structural punctuation**
- Pipe `|` on locked title line, contact line, and portfolio line
- Optional bullet `•` between phrases inside the domain segment of the five-segment title line
- Colon `:` after each technical skills category name
- En-dash `–` on locked date ranges
- Square-metre symbol `m²` and dollar sign `$` on locked project metrics

**Avoid in newly written prose when possible**
- Semicolons
- Em dashes as clause separators (use commas or periods)
- Decorative colons or pipes outside the structures above

## Summary Rules
- Exactly **one** paragraph
- Third person, no `I` / `my`
- Roughly **70–100 words**, JD-aware and truthful
- 2–4 inline bold primary skill terms (reduced from nine on 2026-10-12 for scannability), nothing else bold
- Use `8+ years of experience`, counted from his first dated work in 2018 (INCEPTIONCO co-founder role) through the current Saboo Inc. role. Never use the `6+ years` figure from the legacy CV summary, and never claim more than 8+. Never claim 8+ years of **BIM coordination**: the 8+ figure covers architecture, interior design, BIM, and construction coordination combined.

Preferred pattern (BIM product first, then phase span and project types):

`BIM Coordinator and Project Designer with 8+ years of experience coordinating **federated models** and **construction documents** from design development through construction for residential, hospitality, mixed-use, and public projects in the United States, Egypt, and GCC markets. Runs clash detection in **Navisworks** and the common data environment in ACC/BIM 360, and produces Revit sheets, details, and issue reports. Revit documentation runs across four employers since 2020, with formal BIM coordination since 2026. Brings site review of built work against those drawings, plus an M.Sc. in Construction Management in progress.`

State the BIM history exactly as it is: Revit modeling and documentation across four employers since 2020 (about 2.5 years of Revit-based work at DAR, TAW, James Cubitt, and Saboo), with formal BIM coordination since Jun 2026. Never claim 3+ years of BIM, BIM coordination, or BIM engineering.

For design-lane JDs open with `Project Designer with 8+ years of experience across architecture, interior design, 3D visualization, and BIM...` and lead with design development and documentation, keeping BIM coordination as the second sentence.

For construction-lane JDs open with `Assistant Project Manager and BIM Engineer with 8+ years of experience...` and lead with submittals, RFIs, procurement support, and schedule tracking, with BIM coordination as the technical advantage.

Supported summary themes (BIM-lane JDs lead with the first four):
- BIM coordination: federated models, clash detection, coordination meetings, issue tracking to closure
- common data environment management in ACC/BIM 360, BIM Execution Plan, ISO 19650, LOD, model audits
- Revit modeling, sheets, views, families, technical documentation, IFC/BCF exchange
- quantity take-offs and 4D sequencing tied to procurement and schedule
- project coordination, submittals, RFIs, and document control
- scheduling, progress tracking, and cost tracking support
- procurement, bidding, and preconstruction support
- site execution, quality control, and field reporting
- drawings and specification interpretation and technical review
- California public works compliance (prevailing wage, DIR certified payroll, CAC)
- architectural design development and multidisciplinary coordination
- 3D visualization and design communication
- interior design and high-end finishing execution
- real estate market insight and client-facing negotiation
- multi-market experience (United States, Egypt, GCC)

Never lead the summary with payroll, compliance, or administrative themes. Never describe him as an `architect` or a licensed engineer in the present tense.

## JD Emphasis Priority (Mandatory)
Tailoring must visibly centre on the skills the JD mentions most. Before writing, rank the JD's skills and tools by how often and how prominently they appear (title, must-have list, first responsibilities, repeated mentions). The top 5–8 become the **primary emphasis set** for that run.

Apply the primary emphasis set everywhere, in this order:
1. **Header title line** — insert the top term per Locked Header rules.
2. **Summary** — name the top 3–4 terms in the first two sentences.
3. **Experience bullets** — the first 3–4 bullets of the two most recent roles must each name at least one primary term. Reorder bullets so the ones carrying primary terms come first. Inline bold goes to primary terms before any evergreen term.
4. **Tools lines** — primary terms listed first.
5. **Technical skills** — reorder categories so the one holding the most primary terms is first, and move primary terms to the front of their lines.
6. **Projects** — bold primary terms where a project truthfully uses them.

Every primary term the candidate legitimately covers must appear **bold at least twice** across EXPERIENCE and PROJECTS. Terms the JD mentions once in passing get no bold unless space allows. Never bold a JD term the candidate does not cover, and never add it to skills.

## Experience Rules
- Third person action verbs (`Coordinated`, `Reviewed`, `Prepared`, `Supported`, `Led`, etc.)
- Bullet counts (fixed by the Length Budget): Saboo Inc. **9** (10 only if length allows), James Cubitt & Partners **5**, TAW Developments **4**, DAR site role **4**, BEE Group, Property Consultant, Armed Forces, Hany Saad, and INCEPTIONCO **1 each**. Depth comes from merged, keyword-rich bullets rather than more bullets
- Strongest JD overlap in Saboo (BIM block first) and James Cubitt for BIM JDs, James Cubitt, TAW, and Saboo for design JDs, Saboo and DAR for construction/site JDs, then remaining roles. Bullets that carry the JD's primary emphasis terms come first in each role (see JD Emphasis Priority), while still respecting Design-Led Positioning order
- Bold 2–4 JD-relevant tools, skills, or metrics per bullet (see Bold and Emphasis Usage). Close each employer block with an italic `Tools:` line
- Target **20–35 words** per bullet where possible
- Bullet shape, BIM ATS Pattern: `[Verb] [product] in [tool] through [phase] for [type or size].` The first three Saboo bullets and the first James Cubitt bullet each contain all four parts. Bold the product, the phase, or the type. Do not open those bullets with payroll, a fee, or an ISO clause.
- Order bullets within each role so BIM coordination (Saboo) or modeling, documentation, and coordination (earlier roles) come first; purely visual bullets follow and are tied to decisions or documentation (see Design-Led Positioning). For construction-lane JDs, coordination/delivery bullets lead instead

Preferred action verbs:
Coordinated, Reviewed, Prepared, Supported, Led, Managed, Tracked, Monitored, Developed, Designed, Produced, Documented, Assisted, Maintained, Interpreted, Supervised, Verified, Translated, Compiled, Organized, Communicated, Collaborated, Delivered, Advised

Supported metrics:
- $18.5M combined value across three California projects
- $12M public water pump station project
- $3M public citywide generator project across four locations in Santa Clara
- $3.5M private mosque renovation project in Union City
- 10 principal buildings, 24,000 m² site, approximately 42,000 m² BUA, 7,800 m² footprint (New O1 Mall & Hotel)
- 16 buildings (Silver Palm Compound floor extension and garage redesign)
- Eight buildings renovated from structural/rough condition to high-end finish (National Training Academy)
- Four villas renovated in Sheikh Zayed and New Cairo
- Three GCC markets (UAE, Saudi Arabia, Qatar)
- Three real estate companies in one year
- One interior design internship (Hany Saad)

Use metrics naturally. Do not stack too many numbers in one bullet. Never invent percentages, cost savings, or schedule reductions that are not on the canonical CV.

## Expanded Bullet Bank (Mandatory depth)
The bank below is the pool to swap from, not a list to add. Respect the Length Budget bullet counts. Use the patterns below (reworded and JD-woven per run, `{Tool}` = the JD's primary tool already permitted in that role by the temporal rules) in addition to the canonical achievements. Place them after the core coordination bullets and before any purely creative bullet.

**Saboo Inc. BIM block (lead with 4–5 for BIM-lane JDs):** federated architectural, structural, and MEP model coordination in Navisworks Manage with clash detection tests, clash reports, and issue tracking to resolution through coordination meetings; CDE management in ACC/BIM 360 (folder structure, model uploads, version control, access permissions); BIM standards enforced against the project BEP and ISO 19650 (file naming, LOD requirements, routine model audits); quantity take-offs from Revit for procurement and cost tracking, and model-to-schedule linking for 4D sequencing; Revit sheets, views, and families with IFC and BCF exchange to external teams.

**Saboo Inc. construction block (add 4–6):** submittal and RFI logs maintained in `{Tool}` with status tracking and follow-up to closure; material and product data compliance review against drawings and specifications; bid solicitation, quote tracking, and subcontractor/vendor communication for procurement; schedule and progress follow-up with field documentation and coordination issue resolution; preconstruction support through pre-bid walkthroughs, bid bond requests, and proposal package preparation; California public works administration including DIR certified payroll, prevailing wage documentation, and CAC training fund contributions; contractor prequalification packages and administrative records.

**James Cubitt & Partners (add 2–3):** design development and technical documentation in `{Tool}` across residential compounds, high-rise towers, malls, museums, business complexes, hotels, banks, sports facilities, and mixed-use developments; coordination of multidisciplinary input against client requirements, site conditions, local regulations, and regional design codes; balancing functionality, aesthetics, sustainability, and constructability across projects of varying scale.

**TAW Developments (add 2–3):** plans, elevations, facades, and 3D visualization for the New O1 Mall & Hotel; review and supervision of tenant plans for retail, restaurant, and office units during O1 Mall expansion and facade renovation; building extension, garage redesign, parking, exterior, and landscape coordination for Silver Palm Compound; review of tenant renovation and design proposals for B Seventy.

**DAR for Project Management Co. site role (add 2–3):** verification that architectural works matched drawings and project requirements during the eight-building National Training Academy renovation; monitoring of site activities and coordination of execution issues through high-end finishing from structural/rough condition; coordination of design intent with on-site implementation and client requirements for four villas in Sheikh Zayed and New Cairo; interior design execution and material follow-up.

**BEE Group (add 1):** mood boards, material concepts, drawings, and 3D visualizations supporting client design decisions and project execution for a New Cairo villa renovation.

**Property Consultant (add 1):** primary and resale transactions, client communication, negotiation, market analysis, and stakeholder management with insight into developer products, design features, and customer priorities.

**Armed Forces (add 1):** documentation, coordination, and tracking for government engineering and construction projects across administrative and technical office functions.

**Early-career blocks (1–2 each):** Hany Saad interior design support; INCEPTIONCO VR/AR real-time simulation of client designs as co-founder and VR specialist.

Never add bullets that introduce unsupported tools, employers, certifications, or metrics. The bank above is the only source of additional depth.

## Cross-History Skill Weaving (Mandatory)
The JD's primary skills must NOT appear only at Saboo Inc. Weave them through **3–5 employers** so the resume shows **8+ years** of relevant history where truthful. Rewrite earlier-role bullet wording to name the target skill while keeping locked achievements, employers, dates, and titles intact.

**Earliest plausible start per skill (never claim earlier):**
| Target skill | Weave through | History depth |
|---|---|---|
| Drawings & specification review / technical review | DAR site (2020) → TAW → James Cubitt → Saboo | ~6 yrs |
| Project coordination / stakeholder coordination | DAR site (2020) → Armed Forces → TAW → James Cubitt → Saboo | ~6 yrs |
| Site execution / quality control / field reporting | DAR site (2020) → TAW (tenant supervision) → Saboo | ~6 yrs |
| Submittals / RFIs / procurement / bidding / public works compliance | Saboo only. Do not backdate. DAR site coordination may reference execution issue resolution, not RFIs | Since 2026 |
| Scheduling & progress tracking (Primavera P6, Microsoft Project, Smartsheet) | DAR site (progress monitoring, 2020) → Armed Forces (tracking) → Saboo (P6/MS Project) | ~6 yrs |
| BIM coordination (federated models, clash detection, CDE, BEP, ISO 19650, LOD, model audits, 4D, QTO, IFC/BCF) | Saboo only. Do not backdate. Earlier roles carry Revit modeling, Navisworks model review (James Cubitt), and multidisciplinary coordination instead | Since 2026 |
| Construction management software (Procore, Buildern, Buildertrend, ACC/BIM 360) | Saboo only. Do not backdate | Since 2026 |
| Revit / BIM modeling | DAR site (2020) → TAW → James Cubitt → Saboo, first bullet of each names Revit (GUC from 2015 for AutoCAD/Revit fundamentals) | ~2.5 yrs of Revit work, ~6 yrs span |
| 3D visualization (3ds Max, Lumion, Twinmotion, SketchUp, Rhino) | INCEPTIONCO (2018) → Hany Saad → BEE → TAW → James Cubitt | ~7 yrs |
| VR / AR / real-time simulation | INCEPTIONCO only | 2018–2019 |
| Interior design / high-end finishing | Hany Saad (2020) → DAR villas → BEE | ~5 yrs |
| Client-facing / negotiation / sales | INCEPTIONCO (2018) → Property Consultant → TAW | ~7 yrs |
| GCC codes and regulations | James Cubitt only | 2025–2026 |
| Document control / administrative compliance | Armed Forces (2022) → Saboo | ~4 yrs |

**Weaving technique (proven bullet slots):** name the skill inside existing canonical achievements rather than inventing new ones, e.g. "site execution for the eight-building renovation with `{Tool}` drawing review", "tenant plan review and supervision using `{Tool}`", "design development in `{Tool}` across GCC projects", "schedule and progress follow-up in `{Tool}`".

**Plausibility guardrails:** never place a tool at a role before its mapped start date; never put Procore/ACC, clash detection, CDE, BEP, ISO 19650, or public works compliance before Jun 2026 (Saboo start); keep the Armed Forces and Property Consultant entries free of design software claims.

## Technical Skills Rewriting
`TECHNICAL SKILLS` is the densest ATS keyword section. Use comma-separated category lines, format `Category: item, item, item` (category label bold, items regular). Aim for **6–14 items per category** so the section reads as dense and complete. Put JD primary emphasis terms first in each line, then evergreen Mohamed terms, and move the category holding the most primary terms to the top (keeping `BIM Coordination & Standards` and `Revit & BIM Modeling` first for BIM-lane JDs, `Revit & BIM Modeling` and `Creative & Visualization` first for design-lane JDs, and the construction categories first for construction-lane JDs). Expand depth with sub-skills and practices, not with unsupported software.

Default category order (BIM ATS pattern, deliverables before brands):
1. `BIM Deliverables` — Federated Models, Clash Detection & Reporting, Construction Documents, Sheet Sets, Issue Tracking, Model Review, Quantity Take-Off, 4D Sequencing, BIM Execution Plan (BEP), ISO 19650, Navisworks Manage, ACC/BIM 360
2. `Revit & Construction Documents` — Revit, AutoCAD, Plans, Elevations, Sections, Details, Schedules, Sheet Production, Views & Families, Design Development, Navisworks Model Review, Bluebeam Revu
3. `Project Types` — Residential, Hospitality, Mixed-Use, Retail, High-Rise, Museums, Compounds, Interior Architecture, Renovation, Public Infrastructure, Facade Renovation
4. `Construction Management & Controls` — Procore, Buildern, Buildertrend, Primavera P6, Microsoft Project, Smartsheet, Submittals, RFIs, Procurement Support, Document Control, Public Works Compliance
5. `Interior Design & Visualization` — Interior Design, Space Planning, Mood Boards, Material Concepts, 3D Visualization, 3ds Max, Lumion, Twinmotion, Adobe Photoshop, Adobe InDesign
6. `Design Coordination` — Multidisciplinary Coordination, Consultant Coordination, Constructability Review, Site Review, Quality Control, Regional Design Codes (GCC), Stakeholder Coordination, Field Reporting, Microsoft Excel

For a BIM-lane JD, keep `BIM Deliverables` first. Put a JD tool at the front of its line only after the deliverable nouns, unless that tool is the JD title. `Creative & Visualization` is folded into line 5. Do not add a seventh line.

Keep exactly six categories (Length Budget). For construction-lane JDs move `Construction Management & Controls` to the top. Specialized category names below may replace one of the six, never add a seventh.

Use specialized categories when relevant:
- `Preconstruction & Bidding`
- `Public Works Compliance`
- `Site Supervision & Quality Control`
- `Interior Design & Finishes`
- `Real Estate & Client Advisory`
- `VR / AR & Real-Time Visualization`
- `Markets & Codes`
- `Languages` (only if the user supplies verified language proficiencies)

Evergreen Mohamed skill set:
Project Coordination, Construction Scheduling, RFIs, Submittals, Site Supervision, Quality Control, Cost Tracking Support, Stakeholder Coordination, Field Reporting, Document Control, Procurement Support, Subcontractor Coordination, Bid Solicitation, Drawing & Specification Review, Technical Review, Multidisciplinary Coordination, Procore, Buildern, Buildertrend, Autodesk Construction Cloud (ACC/BIM 360), Primavera P6, Microsoft Project, Smartsheet, Bluebeam Revu, Adobe Acrobat, Microsoft Excel, Microsoft Word, Microsoft PowerPoint, AutoCAD, Revit, Navisworks, SketchUp, Rhino, Twinmotion, 3ds Max, Lumion, Adobe Photoshop, Adobe Illustrator, Adobe InDesign, Adobe After Effects, Adobe Premiere Pro

Domain vocabulary when relevant:
Public Works, Prevailing Wage, DIR Certified Payroll, California Apprenticeship Council (CAC), Contractor Prequalification, Bid Bonds, Pre-Bid Walkthroughs, Bid Proposals, Product Data, Compliance Documentation, Material Takeoff Support, Tenant Coordination, Facade Renovation, Floor Extension, Garage & Parking Redesign, Landscape Coordination, High-End Finishing, Renovation, Interior Design, Mood Boards, Material Concepts, Design Development, Technical Documentation, Constructability, Sustainability, Regional Design Codes (GCC), VR/AR, Real-Time Simulation, Market Analysis, Negotiation

Put the target job's most important tools first in the relevant category, followed by evergreen Mohamed terms.

## Keyword Strategy
Use four priority keyword zones:
1. Fixed title/tagline
2. Summary first and second sentences
3. First 3-5 James Cubitt, TAW, and Saboo bullets (Saboo first for construction-lane JDs)
4. `TECHNICAL SKILLS`

Copy tool and process names directly when supported. Normalize common terms this way:
- `RFI` → `RFIs`
- `Submittal` → `Submittals`
- `BIM360` / `BIM 360` / `ACC` → `Autodesk Construction Cloud (ACC/BIM 360)`
- `P6` → `Primavera P6`
- `Navisworks` (coordination context) → `Navisworks Manage`
- `CDE` → `Common Data Environment (CDE)`
- `BEP` → `BIM Execution Plan (BEP)`
- `QTO` / `Takeoffs` → `Quantity Take-Off`
- `Clash detection` / `Clash Detective` → `Clash Detection & Reporting`
- `VDC` → `Virtual Design & Construction (VDC)` in skills, only alongside his supported BIM coordination terms
- `MS Project` → `Microsoft Project`
- `CAD` → `AutoCAD`
- `Bluebeam` → `Bluebeam Revu`
- `CM` → `Construction Management`
- `QA/QC` → `Quality Control`
- `Subs` → `Subcontractors`
- `Specs` → `Specifications`
- `Renderings` → `3D Visualization`
- `Prevailing wage` / `certified payroll` → `Prevailing Wage`, `DIR Certified Payroll`
- `APM` → `Assistant Project Manager`
- `Architectural Designer` / `Architect` (as a JD title) → `Project Designer` or `Designer` in the headline, with `architectural design` kept as a skill keyword in bullets and skills
- `Archviz` / `CGI` → `3D Visualization`

Usually ignore target company name inside the resume body, salary and benefits, HR boilerplate, location logistics unless relevant, and certifications unless explicitly supplied.

## Target Skill Boundary
Extract the target job's core requirements, then map them only to Mohamed-supported skills and tools. Reflect required skills strongly when they are supported, such as Project Coordination, Submittals, RFIs, Procurement Support, Bid Solicitation, Scheduling, Progress Tracking, Cost Tracking Support, Document Control, Drawing & Specification Review, Site Supervision, Quality Control, Field Reporting, Stakeholder and Subcontractor Coordination, Public Works Compliance, Procore, Buildern, Buildertrend, Autodesk Construction Cloud, Primavera P6, Microsoft Project, Smartsheet, Bluebeam Revu, Excel, AutoCAD, Revit, Navisworks, SketchUp, Rhino, Twinmotion, 3ds Max, Lumion, Adobe Creative Suite, Interior Design, 3D Visualization, and VR/AR.

Supported BIM terms (since 2026-10-12): Navisworks Manage, Clash Detective, TimeLiner, ACC/BIM 360 Docs and Model Coordination, federated models, clash detection and reporting, CDE, BEP, ISO 19650, LOD, model audits, IFC, BCF, quantity take-off, 4D sequencing, Revit families, sheets, and views.

Do not copy unsupported target-only tools or credentials into the resume as Mohamed skills. For example, do not add `Solibri`, `Dynamo`, `Revizto`, `BIMcollab`, `Synchro`, `Assemble`, `Autodesk Certified Professional`, `PlanGrid`, `Sage 300`, `Viewpoint`, `CMiC`, `Timberline`, `Tekla`, `Civil 3D`, `Grasshopper`, `Enscape`, `V-Ray`, `Corona`, `Unreal Engine`, `PMP`, `LEED AP`, `PE`, `RA`, `NCARB`, `RIBA`, or `ARB` unless they are later added to this skill as supported Mohamed items.

When a job is centered on an unsupported tool or credential, keep the fixed headline unchanged and choose supported adjacent terms in the summary, bullets, and skills instead of overclaiming.

## Role-Specific Emphasis

Assistant project manager / project engineer / project coordinator roles:
- Emphasize Saboo submittals, RFIs, procurement, bid solicitation, schedule follow-up, field documentation, Procore/ACC, Primavera P6, Microsoft Project, Bluebeam, and DAR site execution.

Preconstruction / estimating support / bidding roles:
- Emphasize pre-bid walkthroughs, bid bond requests, bid proposal packages, quote tracking, contractor prequalification, drawing and specification review for material requirements, and cost tracking support.

Public works / government / municipal roles:
- Emphasize the $12M water pump station and $3M citywide generator projects, DIR certified payroll, prevailing wage, CAC training fund contributions, prequalification packages, and Armed Forces government project documentation.

Site / field engineer / construction supervision roles:
- Emphasize DAR National Training Academy renovation (eight buildings), high-end finishing from structural/rough condition, drawing compliance, progress monitoring, execution issue coordination, quality control, and field reporting.

Architect / design architect / architectural designer roles:
- Emphasize James Cubitt GCC design coordination and codes, TAW plans/elevations/facades, DAR design-to-site implementation, Revit, AutoCAD, Navisworks, SketchUp, Rhino, design development, technical documentation, and constructability.

BIM / VDC / Revit coordination roles (default lane):
- Lead with the BIM ATS bullet shape. Saboo opens on federated models, clash reports, and construction documents for a named project type and size, then CDE issues in ACC/BIM 360. BEP, ISO 19650, LOD, QTO, and 4D follow those deliverable bullets. Support with James Cubitt Revit sheets for GCC hospitality, high-rise, and mixed-use work, TAW plans and elevations for the 10-building and 16-building projects, and DAR drawing-to-site review.

3D visualization / CGI / archviz roles:
- Emphasize TAW New O1 Mall & Hotel visualization, 3ds Max, Lumion, Twinmotion, SketchUp, Rhino, Adobe Photoshop/After Effects/Premiere Pro, INCEPTIONCO VR/AR, and the Behance, CGArchitect, and Issuu portfolio links.

Interior design roles:
- Emphasize BEE Group villa renovation, mood boards, material concepts, DAR four-villa interiors and high-end finishing, Hany Saad internship, and 3D visuals supporting client decisions.

Real estate / development / owner-side roles:
- Emphasize Property Consultant primary and resale transactions, market analysis, negotiation, developer product insight, and TAW developer-side tenant coordination.

Renovation / tenant improvement / fit-out roles:
- Emphasize TAW O1 Mall expansion and facade renovation, tenant plan review for retail/restaurant/office units, B Seventy tenant proposals, Silver Palm floor extension and garage redesign, DAR renovation execution, and the $3.5M mosque renovation.

## Fixed Certifications (default since 2026-10-12)
Every resume ends with a `CERTIFICATIONS` section placed after `EDUCATION`, one regular line, same style as education lines (size **21**, spacing after **40**, no bold, no tab stops):
- `OSHA 30-Hour Construction, OSHA Safety Training Institute (Issued Oct 2026)`

The user supplied this from Mohamed's LinkedIn on 2026-10-12. Never alter the issuer or date, never imply a separate OSHA card number or trainer status, and add no other certification unless the user supplies it. For construction-lane, site, field, and safety-adjacent JDs, the summary may also name `OSHA 30` once, and `OSHA 30-Hour Construction` may be added to the `Construction Management & Controls` skills line. Only Jun 2026 and later roles may reference applying OSHA safety practice.

## Fixed Education
Keep `EDUCATION` unchanged (last section, one regular line each):
- `M.Sc. Construction Management, California State University, East Bay, California, USA (Expected 2027)`
- `B.Sc. Architecture and Urban Design, German University in Cairo (GUC), Cairo, Egypt (2015 – 2021), GPA: Very Good, Thesis: Excellent`

Use the M.Sc. to support construction management, scheduling, project controls, cost tracking, and public works positioning. Use the B.Sc. to support architectural design, urban design, BIM, drawing interpretation, and design fundamentals.

## Projects Rules (Mandatory — all eight, fixed names)
Use `PROJECTS` as a supported project bank. Keep the eight names, the order, and one bullet each. Do not invent projects. The default bullet leads with building type and size, then the task. A fee may follow the task. It does not open the sentence. Swap only the task words when the user asks to tailor projects, or when a JD term is already true for that project.

1. **Public Water Pump Station, California** — Public infrastructure project. Drawing and specification review, submittals, and RFIs for a $12M pump station.
2. **Citywide Generator Project, Santa Clara** — Public project across four locations. Vendor coordination and field documentation for a $3M generator program.
3. **Mosque Renovation, Union City** — Private renovation. Drawing review and submittal packages for a $3.5M mosque.
4. **New O1 Mall & Hotel, MIDAR New Capital** — Hospitality and retail, 10 buildings, about 42,000 m². Plans, elevations, and facades.
5. **O1 Mall Expansion & Facade Renovation, New Cairo** — Operating mall. Facade renovation and tenant plans for retail, restaurant, and office.
6. **Silver Palm Compound, New Cairo** — 16-building residential compound. Floor extension, garage redesign, and landscape coordination.
7. **National Training Academy Renovation, Sheikh Zayed** — Institutional renovation of eight buildings from rough structure to high-end finish, checked against drawings.
8. **Al-Dyar Compound Villa Renovation, New Cairo** — Residential villa renovation. Interior drawings, mood boards, and material concepts.

Do not invent new projects. Do not rename projects. Do not add target-company names, job-company names, or unsupported domains into project names or descriptions. If the user explicitly asks to tailor projects, rephrase only within the supported project purpose and scale. B Seventy tenant reviews and the four Sheikh Zayed / New Cairo villas remain experience bullets, not project entries, unless the user explicitly asks to promote them.

## JD Tailoring Workflow
1. Read the canonical reference (`Mohamed Hagag ATS CV 26.pdf`, or `Mohamed_Resume.docx` if an approved copy exists) from the skill folder (or workspace if newer) and use it as the data source; build the layout per the Canonical Layout Specification (Josue layout: SUMMARY, TECHNICAL SKILLS, EXPERIENCE, PROJECTS, EDUCATION, CERTIFICATIONS).
2. Extract top 10 JD signals and rank them into the primary emphasis set (JD Emphasis Priority).
3. Map to truthful evidence across the locked history (Saboo, James Cubitt, TAW, BEE, Property Consultant, Armed Forces, DAR, Hany Saad, INCEPTIONCO).
4. Write the headline from the base `BIM Coordinator | Project Designer | Revit, Navisworks & ACC/BIM 360 | Architecture & Interior Design | Construction Coordination`, adjusting at most two segments per Locked Header rules (allowed role titles only, never `Architect` or a protected engineering title, no `Senior`/`Lead`/`Manager` unless requested).
5. Rewrite the summary with 8+ years, BIM coordination first (design ownership first only for design-lane JDs), the target role cluster, supported top tools, and supported career themes.
6. Rewrite Saboo bullets with the BIM block first (federated models, clash detection, CDE, BEP/ISO 19650, QTO/4D, IFC/BCF), then the construction block, matching the JD's strongest supported overlaps.
7. Rewrite James Cubitt bullets with GCC design coordination, codes, and multidisciplinary documentation.
8. Rewrite TAW bullets with plans/elevations/facades, visualization, tenant coordination, and compound extension work.
9. Rewrite DAR site bullets with execution, drawing compliance, progress monitoring, and villa renovation patterns.
10. Rewrite BEE, Property Consultant, Armed Forces, and early-career bullets within their temporal boundaries.
11. Rewrite `TECHNICAL SKILLS` with dense but natural target-aligned supported categories.
12. Keep the approved template layout, section order, education, and project block unchanged (unless project tailoring explicitly requested).
13. Run preflight checklist.
14. Output one `.docx`, ATS-safe, realistic, saved to `Resumes/[YYYY-MM-DD]/[CompanyName]_[JobTitle]/` with the JD saved beside it as `JD.txt` (Output Folder Rule).

## Mandatory Preflight Checklist
- [ ] All **9 company rows** present (Saboo, James Cubitt, TAW, BEE, Property Consultant, Armed Forces, DAR, Hany Saad, INCEPTIONCO) with **9 role rows** (one per company)
- [ ] No Freelance, ARCHIPRISM, El Nour, or DAR Site Architect Intern entry (removed 2026-10-06)
- [ ] Section order is SUMMARY, TECHNICAL SKILLS, EXPERIENCE, PROJECTS, EDUCATION, CERTIFICATIONS
- [ ] Saboo Inc. listed as current/most recent role (`Jun 2026 – Present`)
- [ ] DAR company row and role row both `Sep 2020 – Nov 2021` (site role only)
- [ ] Locked companies, dates, locations, contact unchanged
- [ ] Locked role titles unchanged
- [ ] Header title keeps the five-segment frame; role segments are from the allowed lists (`BIM Coordinator | Project Designer` default), no form of `Architect`/`Architectural`, `Engineer` only as `BIM Engineer`, and no `Senior`/`Lead`/`Manager` unless the user asked
- [ ] Saboo role row reads `BIM Engineer / Assistant Project Manager`
- [ ] No clash detection, CDE, BEP, ISO 19650, LOD, model audit, 4D, QTO, or IFC/BCF claim outside Saboo Inc.
- [ ] Summary does not call him an `architect` in the present tense
- [ ] Tool chronology valid per role date (no Procore/ACC/public works claims before Saboo/Jun 2026, no GCC codes outside James Cubitt)
- [ ] JD primary skills woven across **3–5 employers** per Cross-History Skill Weaving map where truthful
- [ ] All **8 projects** present with correct names and one bullet each, unless tailoring explicitly requested
- [ ] **EDUCATION** section with both verbatim entries
- [ ] **CERTIFICATIONS** section with the verbatim OSHA 30 line, and no other certification
- [ ] No `CORE COMPETENCIES`, `SELECTED EARLY EXPERIENCE`, `PORTFOLIO`, or `ADDITIONAL VALUE` section
- [ ] Summary: one paragraph, third person, 8+ years (never 8+ years of BIM coordination alone), 2–4 inline bold terms
- [ ] Bold limited to name, section headers, project titles, skills category labels, inline summary terms, and 2–4 inline key terms per bullet (company rows, role rows, education lines regular)
- [ ] Section headers carry the bottom border
- [ ] JD primary emphasis terms lead the summary, first bullets, skills, and are bold at least twice
- [ ] Italic `Tools:` line closes each substantive employer block
- [ ] No `keepNext` on bullet paragraphs, no manual page breaks, no white gaps between employers
- [ ] Bullet counts match the Length Budget (Saboo 9, or 10 if length allows, James Cubitt 5, TAW 4, DAR 4, one each for the other five roles)
- [ ] `page_count.py` reports about 2.5 pages and never more than 3 (or the report says Word was unavailable)
- [ ] Exactly six skills categories, 9–13 items each
- [ ] Layout: Calibri, A4, tab stop 10800, bold skills labels with colons, project title lines size 22
- [ ] Contact uses pipes; name is `Mohamed Hagag`
- [ ] Phone `+1 (415) 740-6090` present on the contact line
- [ ] Email is `hagagdesign0026@gmail.com`
- [ ] LinkedIn `linkedin.com/in/mohamed-hagag-480083266` present on contact line
- [ ] Portfolio line with Behance, CGArchitect, and Issuu links present
- [ ] No certifications or licences beyond the locked OSHA 30 entry, and no unsupported software
- [ ] Summary and bullets read as BIM coordination first, with design and construction depth as the differentiator (design-led only for design-lane JDs, construction-led only for construction-lane JDs)
- [ ] BIM ATS Pattern: summary names the phase span and at least three project types; first skills line leads with deliverables; a `Project Types` line is present; the first three Saboo bullets and the first James Cubitt bullet each name a product, a phase, and a type or size; project bullets do not open with a fee
- [ ] Exactly one new `.docx` produced
- [ ] Tailored resume saved under `Resumes/[YYYY-MM-DD]/[NNN]_[CompanyName]_[JobTitle]/` (next unused 3-digit day sequence) with `JD.txt` beside it (first line `URL: <job url>` whenever a URL was given), no existing tailored `.docx` overwritten. A sample resume instead goes to the workspace root as `Mohamed_Sample_BIM_Engineer.docx` (undated, overwritten in place)

## DOCX Inline Bold Helper
**Inline bold helper:** write bullet text with `**term**` markers and split it into alternating regular and bold `TextRun`s:
```javascript
const rich = (text, size = 21) => text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((part) =>
  part.startsWith("**")
    ? new TextRun({ text: part.slice(2, -2), bold: true, font: "Calibri", size })
    : new TextRun({ text: part, font: "Calibri", size }));
```

Never place `new Tab()` as a direct child of `Paragraph`; keep it inside the left `TextRun` after the label text (`new TextRun({ children: [label, new Tab()] })`, right tab stop 10800). Section headers use `border: { bottom: { style: "single", size: 6, color: "000000", space: 1 } }`. Preflight: zero `</w:r><w:tab/><w:r>` in `word/document.xml`.

## Naming Rule
When generating a resume document, name the `.docx` file in this format:

`Mohamed_[MM-DD]_[CompanyName]_[JobTitle].docx`

Use underscores between all parts and convert spaces in the company name and job title to underscores. Use `_v2`, `_v3` if the filename already exists in its JD folder (see Output Folder Rule). The sample resume is the exception: always `Mohamed_Sample_BIM_Engineer.docx` at the workspace root, no date, overwritten in place.

Example:

`Mohamed_09-30_Gensler_Project_Designer.docx`

## Output Folder Rule (Mandatory)
Never save a tailored resume loose in the workspace root (the undated sample resume is the only file that lives there, see below). Save every tailored resume inside a date folder, and inside that a **day-sequence JD folder**:

`Resumes/[YYYY-MM-DD]/[NNN]_[CompanyName]_[JobTitle]/Mohamed_[MM-DD]_[CompanyName]_[JobTitle].docx`

- **Root:** `Resumes/` in the current workspace (the folder holding the canonical CV). Create it if missing.
- **Date folder:** the date the resume is generated, in `YYYY-MM-DD` format so folders sort chronologically (e.g. `2026-09-30`). One folder per day, shared by every JD processed that day. Create it if missing.
- **Day-sequence prefix (Mandatory):** every new JD folder for that day starts with a zero-padded 3-digit order number so folders sort in generation order and are easy to find. First JD of the day is `001_`, second is `002_`, then `003_`, and so on. Before creating a folder, list the existing subfolders of that date folder, read any leading `NNN_` prefixes, and use `max + 1` (start at `001` if none exist). Never reuse a sequence number for a different JD on the same day. Never renumber older folders.
- **JD folder:** `[NNN]_[CompanyName]_[JobTitle]` — sequence prefix + company/title extracted from the JD, using the same underscore conversion as the filename. Strip characters that are invalid in Windows paths (`\ / : * ? " < > |`) and trailing dots or spaces, and keep the company+title portion under 80 characters by shortening the job title, never the company name or the `NNN_` prefix. If the company cannot be identified from the JD, use `Unknown_Company`.
- **JD copy:** save the JD as a plain text file named `JD.txt` (UTF-8) inside the JD folder, so each resume stays paired with the posting it was tailored to. Use the pasted text exactly as given, or the fetched JD text when the user supplied a URL.
- **Job URL line:** whenever a job URL is known, the **first line** of `JD.txt` is `URL: <job url>`, followed by one blank line, then the JD text. If the user sends the URL after the resume was built, prepend that line to the existing `JD.txt` without changing the rest of the file.
- **Same JD again on the same day:** reuse the existing numbered JD folder (match on the `[CompanyName]_[JobTitle]` suffix after `NNN_`) and add the `_v2`, `_v3` suffix to the filename. Never overwrite an existing `.docx`. Do not allocate a new sequence number for a revision of the same JD.
- **Same JD on a later day:** create a new numbered JD folder under the new date folder (that day's next `NNN_`). Do not move or edit earlier dates.
- **Sample resume (no JD):** the one exception to the dated-folder rule (user instruction 2026-10-06). Save it in the **workspace root** as `Mohamed_Sample_BIM_Engineer.docx` (BIM baseline, renamed 2026-10-12), with **no date** in the name and no `JD.txt`. Overwrite the previous sample in place so there is always exactly one current sample at the root. Never put a sample inside `Resumes/`.

Example tree:

```
Resumes/
  2026-09-30/
    001_Gensler_Project_Designer/
      JD.txt
      Mohamed_09-30_Gensler_Project_Designer.docx
    002_HOK_Interior_Designer/
      JD.txt
      Mohamed_09-30_HOK_Interior_Designer.docx
      Mohamed_09-30_HOK_Interior_Designer_v2.docx
  2026-10-01/
    001_Turner_Construction_Assistant_Project_Manager/
      JD.txt
      Mohamed_10-01_Turner_Construction_Assistant_Project_Manager.docx
```

After saving, report the full relative path of the new `.docx` to the user.

## Output and Cleanup
- Generate only the final `.docx` (plus the `JD.txt` copy required by the Output Folder Rule) unless the user explicitly asks for another file type or intermediate source file.
- Save tailored resumes into `Resumes/[YYYY-MM-DD]/[NNN]_[CompanyName]_[JobTitle]/` per the Output Folder Rule. The sample resume alone is saved undated at the workspace root.
- Never delete existing `.docx` outputs unless asked.
- Clean up only generation scripts, `node_modules`, `package.json`, `package-lock.json`, and temp unzip folders.
- Build tooling: check for Node first (`node --version`). If Node is available, use the `docx` npm package. If it is not (the case on the machine this skill was authored on), use Python with `python-docx` (`pip install python-docx`) and start from `build_resume.py` in the skill folder, which already implements the full Canonical Layout Specification (A4, Calibri, tab stop 10800, bordered section headers, `**term**` inline bold, no `keepNext` on bullets). Copy it to a temp location, replace the title line, summary, skills, bullets, and Tools lines with the tailored content, and run `python build_resume.py <output path>`. Never edit the copy in the skill folder during a run.
- Compare against `Mohamed_Hagag_BIM_Engineer.docx` in the skill folder (the approved BIM baseline) when possible.

## Skill Folder Contents
This skill is installed at user level (`~/.cursor/skills/resume-mohamed-jd/`) and works from any Cursor workspace/session. The folder holds:
- `SKILL.md` — this file
- `Mohamed Hagag ATS CV 26.pdf` — historical career source, superseded by `Mohamed_Hagag_BIM_Engineer.docx` wherever they differ. Its summary figure (`6+ years`), contact emails, and `Assistant Project Manager` headline are superseded by this skill
- `Mohamed_Hagag_BIM_Engineer.docx` — **canonical source (2026-10-12)**, the user-approved BIM Engineer resume
- `Mohamed_Resume.docx` — the generator's baseline output, identical in content to the BIM Engineer docx
- `build_resume.py` — python-docx reference generator, now the compact 2.6-page BIM baseline
- `page_count.py` — Word-based page counter used in preflight

Read the reference files from the skill folder, not from the workspace, unless the workspace holds a newer copy. Write outputs to `Resumes/` in the **current workspace** per the Output Folder Rule.

## Skill Activation
This is a **global Cursor personal skill** (`~/.cursor/skills/resume-mohamed-jd/`). Auto-invoke in any Cursor session when the user pastes a JD for Mohamed, gives a job URL for Mohamed, asks to tailor Mohamed Hagag's resume, or requests an ATS `.docx` with these layout/ATS controls. Always use the locked history and BIM-first profile from `Mohamed_Hagag_BIM_Engineer.docx` (Saboo Inc. current as BIM Engineer / Assistant Project Manager, DAR site role only, Hany Saad and INCEPTIONCO retained). Layout and ATS rules in Canonical Layout Specification, Length Budget, Bold and Emphasis Usage, and the Mandatory Preflight Checklist are non-negotiable.
