const RESUME_SHAPE = `  "resume": {
    "name": "...",
    "headline": "Target role | 2–4 core areas, e.g. Revit & BIM Coordination • Clash Detection",
    "contact": ["city, state", "phone", "email", "LinkedIn URL", "other profile/portfolio URLs"],
    "summary": "...",
    "skills": [ { "category": "...", "items": ["existing and inferred skills"] } ],
    "experience": [ { "title": "...", "company": "...", "location": "...", "dates": "e.g. Jun 2021 – Present", "bullets": ["..."], "tools": ["..."] } ],
    "projects": [ { "name": "Project name, City", "link": "", "dates": "", "bullets": ["..."] } ],
    "other_sections": [ { "heading": "Education", "markdown": "one plain line per entry, no bullets: Degree, School, City, Country (dates)" } ]
  }`;

// How much to write for each experience/project entry (used by both modes).
const DETAIL_RULES = `   - Describe every experience and project in enough depth that a recruiter can see the full set of skills it involved:
     - The first bullet says what the work or project was: what was built or delivered, for what kind of client, building or product, its scale, and my role.
     - "bullets": scale the number of bullets to how long the entry lasted, so long periods show the many kinds of work done in them:
         under 6 months: 3–4 bullets; 6–18 months: 4–6; 1.5–3 years: 6–8; over 3 years: 8–10.
       Cover the whole range of the work across that time (e.g. planning or design, modeling or building, coordination with other teams, documentation and drawings, reviews or testing, delivery, process improvements, training others), not only the headline task.
     - Each bullet: an action verb, what was done and how (methods, tools, standards), and the context or result. One to two lines each; no filler.
     - In every bullet, bold (**like this**) the 1–3 most important keywords: tools, methods, deliverables or results already in that bullet. Never bold a whole sentence.
     - "tools": the software, technologies, methods and standards used in that entry.
   - "headline": one line under my name: the target role, then 2–4 of my real core areas, separated by " | " and "•". Only areas my resume supports.
   - Dates: use the same style everywhere, e.g. "Jun 2021 – Present" (en dash).
   - Project names: leave out labels such as "(Independent Portfolio Project)", "(Independent)", "Portfolio Project", "Personal Project" and sample-model labels such as "(Snowdon Towers sample)". Never describe a project as independent, personal or portfolio work anywhere in the resume; describe the work itself. Do not state or imply that it was done for an employer or client unless my resume says so.`;

const INSTRUCTIONS = `You are an expert resume writer and ATS (applicant tracking system) specialist.
Tailor my master resume below to the target job. Work through these steps:

1. ANALYZE THE JOB: list the essential skills, technologies and qualifications it requires.

2. COMPARE: split them into skills my resume already shows (matched) and skills it does not (missing).

3. EXPAND MY SKILLS, HONESTLY: for each missing skill, decide:
   - INFERRED: my resume has concrete evidence that I have used it, or it is a direct, standard part of work I describe (e.g. "built REST APIs with Express" supports "Node.js" and "REST API design"). Add it to my skills and quote the evidence.
   - GAP: there is no evidence. Do NOT add it anywhere in the resume; list it as a gap instead.
   You may also add a few complementary technical skills that routinely accompany tools I already list and are clearly supported by my described work. Keep additions modest (8 at most), specific and in the same style and granularity as my existing skills, so the list reads naturally. No buzzwords, no soft-skill padding, no proficiency or seniority claims.

4. REWRITE THE RESUME:
   - Experience and projects: keep every entry in the same order. Copy job titles, company names, locations, dates, project names and links EXACTLY as written. Do not add, remove, merge or rename entries.
   - Rewrite only the descriptions of each entry: emphasize the work most relevant to this job and use the job's terminology where it truthfully applies.
${DETAIL_RULES}
   - Where my resume is brief, expand it with the standard, necessary steps of the work it describes (e.g. modeling in Revit implies creating views, sheets and families; building an API implies designing endpoints and handling errors), but every detail must be stated or clearly implied by that same entry. Keep my existing numbers; never invent metrics, clients, tools, team sizes or outcomes. If an entry is too thin to reach the bullet range honestly, write fewer bullets rather than inventing.
   - Write a new 2–3 sentence summary aimed at this job.
   - Skills: my existing skills (reordered by relevance; you may drop clearly irrelevant ones) plus the inferred skills, grouped into categories.
   - Education, certifications and any other sections: keep the facts unchanged.
   - Let the length follow the experience: usually two pages; a long career may need more.

Reply with ONLY one \`\`\`json code block, no text before or after it, in exactly this shape:
{
  "job_analysis": {
    "essential_skills": ["..."],
    "matched_skills": ["..."],
    "missing_skills": ["..."]
  },
  "inferred_skills": [
    { "skill": "...", "category": "the resume.skills category it was added to", "evidence": "the part of my resume that supports it" }
  ],
  "skill_gaps": [
    { "skill": "...", "suggestion": "an honest way to address it (course, side project, cover letter)" }
  ],
${RESUME_SHAPE}
}
Use empty arrays for sections my resume does not have.`;

// "High-impact" (exaggerated) mode, for classroom demonstrations of what AI can do to a resume.
// The model also audits its own inflation; that audit stays hidden until "Show AI changes".
const DEMO_INSTRUCTIONS = `CLASSROOM DEMONSTRATION. I am a teacher showing students how far AI can inflate a resume, and why that is risky. I will show the resume first and then reveal your audit to the students. It will not be sent to employers.

1. Rewrite my master resume for the target job in "maximum impact" style:
   - Experience and projects: keep every entry in the same order. Copy job titles, company names, locations, dates, project names and links EXACTLY as written. Only the descriptions change.
${DETAIL_RULES}
   - Amplify every bullet: commanding action verbs, the grandest plausible organizational scope, business impact, and industry-typical metrics (percentages, time or money saved, team sizes, volumes), even where my resume gives no numbers.
   - Summary: position me as a top candidate for exactly this job.
   - Skills: add the job's key skills, including ones my resume shows no evidence of.
   - Education and certifications: keep the facts unchanged.
   - Let the length follow the experience: usually two pages.

2. Audit your own work: list EVERY exaggeration you made (each invented metric, inflated scope or responsibility, and unsupported skill) with my original wording, your exaggerated wording, the technique used, and what would expose it in an interview, technical test or reference check.

Reply with ONLY one \`\`\`json code block, no text before or after it, in exactly this shape:
{
  "job_analysis": {
    "essential_skills": ["..."],
    "matched_skills": ["..."],
    "missing_skills": ["..."]
  },
  "inferred_skills": [
    { "skill": "...", "category": "the resume.skills category it was added to", "evidence": "the part of my resume that supports it, or \"none\" if added only for the demo" }
  ],
  "skill_gaps": [],
  "exaggerations": [
    { "original": "my original wording, or \"not in resume\"", "exaggerated": "your new wording", "technique": "invented metric | scope inflation | added responsibility | unsupported skill | verb upgrade", "interview_risk": "what would expose it" }
  ],
${RESUME_SHAPE}
}
Use empty arrays for sections my resume does not have.`;

// Labels added by earlier versions; removed from saved resumes when they are opened.
const DEMO_NOTE = 'Classroom demo: AI-exaggerated resume with invented claims. Not for real job applications.';
const OLD_DEMO_BANNER = '**⚠ CLASSROOM DEMO: AI-exaggerated resume. Contains invented claims. Not for real job applications.**';
const isDemo = (data) => Array.isArray(data?.exaggerations);

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const jobId = params.get('id');
// Set when the popup opened several jobs at once: generate this job's resume automatically.
const autoStart = params.get('auto') === '1';
// Set when the "Tailor all" queue (queue.html) runs this page in a hidden frame: generate,
// save, then report the result to the queue. force=1 regenerates an existing resume.
const queueMode = params.get('queue') === '1';
const forceRegenerate = params.get('force') === '1';

function reportToQueue(ok, error = '', extra = {}) {
  if (queueMode && window.parent !== window) window.parent.postMessage({ type: 'tailorResult', jobId, ok, error, ...extra }, location.origin);
}
let job = null;
let resume = '';
let markdown = '';
// { data, excluded }: Claude's JSON reply and the inferred skills the user unticked.
// Null when a plain Markdown resume was pasted instead.
let analysis = null;
// 'honest' or 'demo' (exaggerated); remembered between tabs.
let mode = 'honest';
// From Settings, e.g. "8+".
let experienceYears = '';
// 'ready' | 'not-ready': which save folder this resume goes in.
let status = 'not-ready';
// High-impact results start with the AI-changes panel collapsed (not remembered on purpose).
let revealChanges = false;

// ---------- Prompt ----------

function experienceRule() {
  return experienceYears
    ? `TOTAL EXPERIENCE: I have ${experienceYears} years of professional experience. Whenever the resume (summary or anywhere else) states my total experience, write exactly "${experienceYears} years". Never calculate it from the dates in my resume.`
    : 'TOTAL EXPERIENCE: do not state a total number of years of experience unless my resume states it. Never calculate it from the dates in my resume.';
}

// Safety net: in the Summary, replace any "about 3.5 years" style total with the Settings value.
function fixExperienceYears(md) {
  if (!experienceYears) return md;
  const years = /\b(?:about|around|approximately|nearly|almost|over|more than|roughly)?\s*\d+(?:\.\d+)?\+?\s*(?:years?|yrs?)\b/gi;
  let inSummary = false;
  return md.split('\n').map((line) => {
    if (/^#{1,2}\s/.test(line)) inSummary = /^##\s+(summary|profile|professional summary)\b/i.test(line);
    return inSummary && !/^#/.test(line) ? line.replace(years, (m) => `${/^\s/.test(m) ? ' ' : ''}${experienceYears} years`) : line;
  }).join('\n');
}

function buildPrompt() {
  const highlights = (job.highlights || [])
    .map((h) => `${h.title || 'Highlights'}:\n${(h.items || []).map((i) => `- ${i}`).join('\n')}`)
    .join('\n\n');

  return `${mode === 'demo' ? DEMO_INSTRUCTIONS : INSTRUCTIONS}

${experienceRule()}

=== TARGET JOB ===
Title: ${job.title}
Company: ${job.company}
Location: ${job.location || 'n/a'}

${highlights}

Full description:
${job.description || '(no description provided)'}

=== MY MASTER RESUME ===
${resume}`;
}

// ---------- Claude Code (callBridge comes from bridge-client.js) ----------

// Setup instructions with this extension's own ID filled in, plus a copy button.
function setupHelp() {
  const command = setupCommand();
  const copy = Object.assign(document.createElement('button'), { className: 'link-btn', textContent: 'Copy' });
  copy.onclick = async () => {
    await navigator.clipboard.writeText(command);
    copy.textContent = 'Copied ✓';
  };
  return [
    'Set it up once: in VS Code, open the Job Finder folder and run this in the terminal, then restart the browser: ',
    Object.assign(document.createElement('code'), { textContent: command }),
    ' ',
    copy,
  ];
}

async function checkBridge() {
  const status = $('bridgeStatus');
  try {
    const { via, res } = await callBridge({ type: 'ping' });
    status.className = res.ok ? 'bridge-status ok' : 'bridge-status bad';
    status.textContent = res.ok
      ? `● Claude Code is connected (${via === 'native' ? 'native messaging' : 'local bridge'}).`
      : '● Connected, but Claude Code was not found on this PC. Set CLAUDE_PATH and try again.';
    return res.ok;
  } catch {
    status.className = 'bridge-status bad';
    status.replaceChildren('● Claude Code is not set up. ', ...setupHelp());
    return false;
  }
}

async function generateWithClaudeCode() {
  const prompt = buildPrompt();
  $('steps').hidden = true;
  $('preview').hidden = true;
  $('editor').hidden = true;
  $('analysis').hidden = true;
  $('askBtn').disabled = true;
  const spinner = Object.assign(document.createElement('div'), { className: 'spinner' });
  $('status').replaceChildren(Object.assign(document.createElement('div'), { className: 'empty' }));
  $('status').firstChild.append(spinner, 'Claude Code is tailoring your resume… about a minute.');

  try {
    const { res } = await callBridge({ type: 'tailor', prompt });
    if (res?.error) throw new Error(res.error);
    if (!res?.text?.trim()) throw new Error('Claude Code returned an empty reply.');
    acceptReply(res.text);
    if (!markdown) throw new Error('Claude Code\'s reply could not be read as a resume.');
    return true;
  } catch (err) {
    console.error(err);
    if (queueMode) reportToQueue(false, err instanceof ConnectionError ? 'Claude Code helper not reachable' : err.message);
    showSteps();
    showError(err instanceof ConnectionError
      ? ['Claude Code is not reachable from this browser. ', ...setupHelp()]
      : `Claude Code failed: ${err.message}`);
    checkBridge();
    return false;
  } finally {
    updateButtons();
  }
}

// Accepts Claude's whole reply: keeps only the inside of a ``` block if there is one, then
// returns { data } for the JSON format or { markdown } for a plain Markdown resume.
function parseReply(text) {
  const fenced = text.match(/```(?:json|markdown|md)?[ \t]*\r?\n([\s\S]*?)\r?\n```/i);
  const body = (fenced ? fenced[1] : text).trim();
  if (body.startsWith('{')) {
    try {
      const data = JSON.parse(body);
      if (data?.resume) return { data };
    } catch (err) {
      throw new Error(`That looks like JSON but it could not be read (${err.message}). Make sure you copied the whole code block.`);
    }
  }
  return { markdown: body };
}

// ---------- JSON resume -> Markdown ----------

// Removes "Independent" / "Portfolio Project" / "... sample" style labels from a project name,
// keeping any other text in the same brackets: "X (Independent, FMX)" -> "X (FMX)".
const PROJECT_LABEL = /^(independent|personal|portfolio|self[- ]directed)(\s+(portfolio|personal))?(\s+project)?$|\bsample\b/i;
function stripProjectLabel(name) {
  return String(name || '')
    .replace(/\s*[([]([^()[\]]*)[)\]]/g, (match, inner) => {
      const kept = inner.split(',').map((part) => part.trim()).filter((part) => part && !PROJECT_LABEL.test(part));
      return kept.length ? ` (${kept.join(', ')})` : '';
    })
    .replace(/\s*[-–—:]\s*(independent|personal|portfolio)(\s+(portfolio|personal))?(\s+project)?\s*$/i, '')
    .trim();
}

// Applies stripProjectLabel to the "### " headings in the Projects section of a saved resume.
function cleanProjectHeadings(md) {
  let inProjects = false;
  return md.split('\n').map((line) => {
    if (/^##\s/.test(line)) inProjects = /^##\s+projects\b/i.test(line);
    if (!inProjects || !/^###\s/.test(line)) return line;
    const link = line.match(/^###\s+\[(.+)\]\((.+)\)\s*$/);
    return link ? `### [${stripProjectLabel(link[1])}](${link[2]})` : `### ${stripProjectLabel(line.slice(4))}`;
  }).join('\n');
}

const norm = (s) => String(s || '').toLowerCase().replace(/[‐-―]/g, '-').replace(/\s+/g, ' ').trim();
const list = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);

function resumeToMarkdown(data, excluded) {
  const r = data.resume;
  const skip = new Set(excluded.map(norm));

  // Make sure every kept inferred skill is in the skills list, and every unticked one is not.
  // A skill whose category doesn't match an existing group goes into the closest group (or the
  // last one) instead of starting a new one-item line.
  const skills = list(r.skills).map((g) => ({ category: g.category, items: list(g.items).filter((s) => !skip.has(norm(s))) }));
  const words = (s) => new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2));
  for (const inf of list(data.inferred_skills)) {
    if (skip.has(norm(inf.skill))) continue;
    if (skills.some((g) => g.items.some((s) => norm(s) === norm(inf.skill)))) continue;
    let group = skills.find((g) => norm(g.category) === norm(inf.category));
    if (!group && skills.length) {
      const wanted = words(inf.category);
      const scored = skills.map((g) => ({ g, n: [...words(g.category)].filter((w) => wanted.has(w)).length }));
      const best = scored.sort((a, b) => b.n - a.n)[0];
      group = best.n > 0 ? best.g : skills[skills.length - 1];
    }
    if (!group) skills.push((group = { category: inf.category || 'Additional', items: [] }));
    group.items.push(inf.skill);
  }

  // Single-column layout that job sites and ATS parsers read correctly:
  //   ### Job Title
  //   Company — Location
  //   Dates
  //   - bullets ... - Tools: ...
  // No " | " inside ### or *italic* lines: markdownToHtml would turn those into two-column rows
  // (kept only so resumes saved by older versions still display).
  const noRow = (s) => String(s || '').replace(/\s+\|\s+/g, ' - ');
  const out = [`# ${r.name || 'Your Name'}`];
  if (r.headline) out.push(String(r.headline).replace(/\s*•\s*/g, ' | '));
  if (list(r.contact).length) out.push(list(r.contact).join(' | '));
  if (r.summary) out.push('## Summary', r.summary);

  const skillLines = skills.filter((g) => g.items.length).map((g) => `- ${g.category ? `**${g.category}:** ` : ''}${g.items.join(', ')}`);
  if (skillLines.length) out.push('## Skills', skillLines.join('\n'));

  if (list(r.experience).length) {
    out.push('## Experience');
    for (const e of list(r.experience)) {
      const where = [e.title && e.company ? e.company : '', e.location].filter(Boolean).map(noRow).join(' — ');
      out.push([
        `### ${noRow(e.title || e.company)}`,
        where,
        e.dates || '',
        ...(e.overview ? [`- ${e.overview}`] : []), // older replies had a separate overview
        ...list(e.bullets).map((b) => `- ${b}`),
        list(e.tools).length ? `- Tools: ${list(e.tools).join(', ')}` : '',
      ].filter(Boolean).join('\n'));
    }
  }

  if (list(r.projects).length) {
    out.push('## Projects');
    for (const p of list(r.projects)) {
      const name = noRow(stripProjectLabel(p.name));
      out.push([
        `### ${p.link ? `[${name}](${p.link})` : name}`,
        p.dates || '',
        ...(p.overview ? [`- ${p.overview}`] : []),
        ...list(p.bullets).map((b) => `- ${b}`),
        list(p.tools).length ? `- Tools: ${list(p.tools).join(', ')}` : '',
      ].filter(Boolean).join('\n'));
    }
  }

  for (const s of list(r.other_sections)) {
    if (s.heading && s.markdown) out.push(`## ${s.heading}`, s.markdown);
  }
  return out.join('\n\n');
}

// Lists experience/project headers that don't appear in the master resume, i.e. that Claude
// may have renamed despite the instructions. Dates are skipped: their formatting often varies.
function changedHeaders(data) {
  const master = norm(resume);
  const masterNoLabels = norm(resume.split(/\r?\n/).map(stripProjectLabel).join('\n'));
  const missing = [];
  for (const e of list(data.resume.experience)) {
    for (const field of [e.title, e.company]) {
      if (field && !master.includes(norm(field))) missing.push(field);
    }
  }
  for (const p of list(data.resume.projects)) {
    const name = stripProjectLabel(p.name);
    if (name && !master.includes(norm(name)) && !masterNoLabels.includes(norm(name))) missing.push(name);
  }
  return [...new Set(missing)];
}

// ---------- Minimal, safe Markdown renderer ----------

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) =>
      /^(https?:|mailto:)/i.test(href) ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>` : label,
    );
}

// "Left | Right" (last " | ") -> two spans for a row; null when there's no separator.
function splitRow(text) {
  const at = text.lastIndexOf(' | ');
  return at > 0 ? [text.slice(0, at), text.slice(at + 3)] : null;
}

function markdownToHtml(md) {
  const out = ['<header class="r-head">'];
  let inHeader = true; // name, headline and contact lines, until the first "## " section
  let list = null; // 'ul' | 'ol'
  let para = [];

  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };

  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) {
      flushPara();
      closeList();
    } else if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      flushPara();
      closeList();
      if (inHeader && m[1].length === 2) {
        out.push('</header>');
        inHeader = false;
      }
      const row = !inHeader && m[1].length === 3 && splitRow(m[2]);
      out.push(row
        ? `<h3 class="row"><span>${inline(row[0])}</span><span>${inline(row[1])}</span></h3>`
        : `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
    } else if (!inHeader && (m = line.trim().match(/^\*([^*].*[^*])\*$/)) && (splitRow(m[1]) || /^tools:/i.test(m[1]))) {
      // "*Title | Dates · Location*" row, or "*Tools: ...*" line.
      flushPara();
      closeList();
      const row = splitRow(m[1]);
      out.push(row && !/^tools:/i.test(m[1])
        ? `<p class="row sub"><em>${inline(row[0])}</em><span>${inline(row[1])}</span></p>`
        : `<p class="tools">${inline(m[1])}</p>`);
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushPara();
      closeList();
      out.push('<hr>');
    } else if ((m = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/))) {
      flushPara();
      const type = /\d/.test(m[1]) ? 'ol' : 'ul';
      if (list !== type) {
        closeList();
        out.push(`<${type}>`);
        list = type;
      }
      out.push(`<li>${inline(m[2])}</li>`);
    } else {
      closeList();
      para.push(line.trim());
    }
  }
  flushPara();
  closeList();
  if (inHeader) out.push('</header>');
  return out.join('\n');
}

// ---------- UI ----------

function updateButtons() {
  for (const id of ['copyBtn', 'downloadBtn', 'printBtn', 'saveBtn', 'pdfBtn']) $(id).disabled = !markdown;
  $('askBtn').disabled = !job || !resume;
}

// Step 1 (open Claude) + step 2 (paste the reply). `opened` highlights step 2.
function showSteps(opened = false) {
  $('steps').hidden = false;
  $('stepOpen').classList.toggle('done', opened);
  $('stepPaste').classList.toggle('current', opened);
  if (opened) $('pasteBox').focus();
}

function showError(message, withSettings = false) {
  const box = document.createElement('div');
  box.className = 'empty error';
  box.append(...[message].flat());
  if (withSettings) {
    const btn = Object.assign(document.createElement('button'), { className: 'primary', textContent: 'Open settings' });
    btn.onclick = () => chrome.runtime.openOptionsPage();
    box.append(btn, 'Reload this tab after saving.');
  }
  $('status').replaceChildren(box);
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
}

function chips(items, className = 'chip') {
  return el('div', { className: 'chips' }, items.map((s) => el('span', { className }, s)));
}

// Skills analysis panel: matched skills, inferred skills (tick to keep), gaps, and warnings.
function renderAnalysis() {
  const panel = $('analysis');
  if (!analysis) {
    panel.hidden = true;
    return;
  }
  const { data, excluded } = analysis;
  const ja = data.job_analysis || {};
  const inferred = list(data.inferred_skills);
  const gaps = list(data.skill_gaps);
  const changed = changedHeaders(data);

  const demo = isDemo(data);
  const exaggerations = list(data.exaggerations);

  if (demo && !revealChanges) {
    const btn = el('button', { className: 'link-btn reveal-btn', textContent: 'Show AI changes' });
    btn.onclick = () => {
      revealChanges = true;
      renderAnalysis();
    };
    panel.replaceChildren(btn);
    panel.className = 'analysis collapsed no-print';
    panel.hidden = false;
    return;
  }
  panel.className = 'analysis no-print';

  panel.replaceChildren(
    el('h2', {}, demo ? 'What the AI changed' : 'Skills analysis'),
    demo && el('p', { className: 'muted' }, `${exaggerations.length} claims were inflated or invented. Each one below is something an interviewer could check.`),
    demo && exaggerations.length > 0 && el('div', { className: 'exag-wrap' }, el('table', { className: 'exag' },
      el('thead', {}, el('tr', {}, ['Original', 'Exaggerated', 'Technique', 'How it gets exposed'].map((h) => el('th', {}, h)))),
      el('tbody', {}, exaggerations.map((x) => el('tr', {},
        el('td', { className: 'orig' }, x.original || '—'),
        el('td', {}, x.exaggerated || '—'),
        el('td', {}, el('span', { className: 'tech' }, x.technique || '—')),
        el('td', { className: 'risk' }, x.interview_risk || '—'),
      ))),
    )),
    changed.length > 0 && el('div', { className: 'warn' },
      '⚠ These experience/project names are not in your master resume, so Claude may have changed them: ',
      el('b', {}, changed.join(', ')),
      '. Check them in Edit, or ask Claude again.'),
    list(ja.matched_skills).length > 0 && el('div', { className: 'section-label' }, 'Already on your resume'),
    list(ja.matched_skills).length > 0 && chips(list(ja.matched_skills), 'chip hit'),
    el('div', { className: 'section-label' }, `${demo ? 'Skills added' : 'Added from your experience'} (${inferred.length - excluded.length} of ${inferred.length} kept)`),
    inferred.length
      ? el('ul', { className: 'inferred' }, inferred.map((inf) => {
          const box = el('input', { type: 'checkbox', checked: !excluded.some((x) => norm(x) === norm(inf.skill)) });
          box.onchange = () => toggleInferred(inf.skill, box.checked);
          return el('li', {}, el('label', {}, box, el('b', {}, inf.skill), inf.category ? el('span', { className: 'cat' }, inf.category) : null),
            inf.evidence
              ? /^none\b/i.test(inf.evidence)
                ? el('div', { className: 'evidence none' }, 'No evidence in the resume')
                : el('div', { className: 'evidence' }, `Based on: ${inf.evidence}`)
              : null);
        }))
      : el('p', { className: 'muted' }, 'None: your resume already covers what this job needs, or there was no evidence for more.'),
    gaps.length > 0 && el('div', { className: 'section-label' }, 'Gaps: not added, because your resume shows no evidence'),
    gaps.length > 0 && el('ul', { className: 'gaps' }, gaps.map((g) => el('li', {}, el('b', {}, g.skill), g.suggestion ? ` — ${g.suggestion}` : ''))),
    el('p', { className: 'muted small' }, "Unticking a skill rebuilds the resume from Claude's reply, which replaces any manual edits."),
  );
  panel.hidden = false;
}

function toggleInferred(skill, keep) {
  const rest = analysis.excluded.filter((x) => norm(x) !== norm(skill));
  analysis.excluded = keep ? rest : [...rest, skill];
  markdown = fixExperienceYears(resumeToMarkdown(analysis.data, analysis.excluded));
  chrome.storage.local.set({ [`tailored:${jobId}`]: markdown, [`analysis:${jobId}`]: analysis });
  showResult();
  autoSave();
}

function showResult() {
  $('steps').hidden = true;
  $('status').replaceChildren();
  renderAnalysis();
  $('preview').innerHTML = markdownToHtml(markdown);
  $('editor').value = markdown;
  const editing = $('viewEdit').classList.contains('active');
  $('preview').hidden = editing;
  $('editor').hidden = !editing;
  updateButtons();
}

function setView(edit) {
  $('viewEdit').classList.toggle('active', edit);
  $('viewPreview').classList.toggle('active', !edit);
  if (markdown) showResult();
}

function acceptReply(text) {
  if (!text || !text.trim()) return;
  let parsed;
  try {
    parsed = parseReply(text);
  } catch (err) {
    showSteps();
    $('pasteBox').value = text;
    showError(err.message);
    return;
  }
  if (parsed.data) {
    analysis = { data: parsed.data, excluded: [] };
    revealChanges = false;
    markdown = fixExperienceYears(resumeToMarkdown(analysis.data, analysis.excluded));
  } else {
    analysis = null;
    markdown = fixExperienceYears(parsed.markdown);
  }
  $('pasteBox').value = '';
  chrome.storage.local.set({ [`tailored:${jobId}`]: markdown, [`analysis:${jobId}`]: analysis });
  setView(false);
  autoSave();
}

// "Resume - Company - Role" (same name as the files in your save folder).
function resumeFileBase() {
  const clean = (s, max) => String(s || '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).replace(/[. ]+$/, '');
  return `Resume - ${clean(job.company, 60)} - ${clean(job.title, 80)}`;
}

function fileName() {
  return `${resumeFileBase()}.md`;
}

// ---------- Saving to the folder chosen in Settings ----------
// Each job gets its own numbered subfolder ("0012 - Company - Title", numbered by the helper in
// bridge/save.js) holding only "Resume - Company - Role.pdf" and job-description.txt. The files
// sent here (resume .md/.html, job.json, analysis.json) are kept in the save folder's hidden
// .data\0012 folder, so the Saved jobs page can reopen and edit the job.
// Saving the same job again overwrites its files and keeps its number.

let saveTimer = null;

// A standalone page that opens in any browser and prints like the preview (same template CSS).
async function resumeHtmlDocument() {
  const name = (markdown.match(/^#\s+(.+)$/m) || [])[1] || 'Resume';
  const css = await (await fetch('resume-template.css')).text();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(resumeFileBase())}</title>
<style>
body { margin: 0; background: #fff; }
.resume { max-width: 8.5in; margin: 0 auto; padding: 0.5in 0.55in; box-sizing: border-box; }
@media print { .resume { padding: 0; } }
${css}
</style>
</head>
<body>
<article class="resume">
${markdownToHtml(markdown)}
</article>
</body>
</html>
`;
}

function jobToMarkdown(j) {
  const posted = j.posted && j.postedAt ? `${j.posted} (around ${new Date(j.postedAt).toLocaleDateString()})` : j.posted;
  const facts = [
    ['Company', j.company],
    ['Location', j.location],
    ['Source', j.via && `via ${j.via}`],
    ['Posted', posted],
    ['Salary', j.salaryText],
    ['Schedule', j.schedule],
    ['Remote', j.remote ? 'Yes' : ''],
    ['Posting link', j.link],
  ];
  const lines = [`# ${j.title}`, '', ...facts.filter(([, v]) => v).map(([k, v]) => `- **${k}:** ${v}`)];
  if (list(j.applyOptions).length) lines.push('', '## Apply links', ...j.applyOptions.map((o) => `- [${o.title}](${o.link})`));
  for (const h of list(j.highlights)) lines.push('', `## ${h.title || 'Highlights'}`, ...list(h.items).map((i) => `- ${i}`));
  if (j.description) lines.push('', '## Full description', '', j.description);
  lines.push('', '---', `Saved by Universal Job Finder on ${new Date().toLocaleString()}.`);
  return lines.join('\n') + '\n';
}

function showSaveStatus(text, kind = '', { path = '', withSettings = false } = {}) {
  const status = $('saveStatus');
  status.className = `save-status ${kind}`;
  status.textContent = text;
  status.title = path;
  if (withSettings) {
    const btn = Object.assign(document.createElement('button'), { className: 'link-btn', textContent: 'Settings' });
    btn.onclick = () => chrome.runtime.openOptionsPage();
    status.append(' ', btn);
  }
}

async function saveToFolder({ quiet = false } = {}) {
  if (!markdown || !job) return { ok: false, error: 'Nothing to save.' };
  const { saveDir = '' } = await chrome.storage.local.get('saveDir');
  if (!saveDir) {
    if (!quiet) showSaveStatus('Choose a save folder first:', 'bad', { withSettings: true });
    return { ok: false, error: 'No save folder set in Settings.' };
  }

  showSaveStatus('Saving…');
  const files = {
    'resume.md': markdown,
    'resume.html': await resumeHtmlDocument(),
    'job-description.md': jobToMarkdown(job),
    'job.json': JSON.stringify(job, null, 2),
  };
  if (analysis) files['analysis.json'] = JSON.stringify(analysis, null, 2);

  try {
    const { res } = await callBridge({ type: 'save', dir: saveDir, job, files, status });
    if (res?.error) throw new Error(res.error);
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const number = String(res.index).padStart(4, '0');
    const where = res.status === 'ready' ? 'Ready' : 'Not ready';
    if (res.pdfError) showSaveStatus(`Saved #${number}, but no PDF: ${res.pdfError}`, 'bad', { path: res.path });
    else showSaveStatus(`Saved ✓ #${number}${res.pdf ? ' + PDF' : ''} in ${where} · ${res.ready} ready / ${res.total} jobs · ${time}`, 'ok', { path: res.pdf || res.path });
    rememberSaved(res);
    return { ok: true, res };
  } catch (err) {
    console.error(err);
    const error = err instanceof ConnectionError ? 'Claude Code helper not reachable' : err.message;
    showSaveStatus(`Not saved: ${error}`, 'bad');
    return { ok: false, error };
  }
}

// Updates the extension's copy of the saved-job list, so the popup hides this job from now on.
async function rememberSaved(res) {
  const { savedJobs = { total: 0, jobs: [] } } = await chrome.storage.local.get('savedJobs');
  const key = jobKey(job);
  const jobs = savedJobs.jobs.filter((j) => j.index !== res.index);
  jobs.push({ index: res.index, jobId: job.id, key, title: job.title, company: job.company, location: job.location, status: res.status });
  await chrome.storage.local.set({ savedJobs: { total: res.total, ready: res.ready, notReady: res.notReady, jobs } });
}

// "Ready to apply" switch: remembered per job, and moves the saved folder to Ready/ or Not ready/.
async function setStatus(next) {
  status = next;
  await chrome.storage.local.set({ [`status:${jobId}`]: status });
  if (markdown) saveToFolder();
}

// Saves quietly after a new result or an edit, when a folder is set and auto-save is on.
function autoSave(delay = 0) {
  if (queueMode) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const { autoSave: enabled = true, saveDir = '' } = await chrome.storage.local.get(['autoSave', 'saveDir']);
    if (enabled && saveDir) saveToFolder({ quiet: true });
  }, delay);
}

async function init() {
  $('viewPreview').onclick = () => setView(false);
  $('viewEdit').onclick = () => setView(true);
  $('askBtn').onclick = () => generateWithClaudeCode();
  $('generateBtn').onclick = () => generateWithClaudeCode();
  $('copyPromptBtn').onclick = async () => {
    await navigator.clipboard.writeText(buildPrompt());
    $('copyPromptBtn').textContent = 'Copied ✓';
    setTimeout(() => ($('copyPromptBtn').textContent = 'Copy prompt'), 1500);
  };
  // Pasting Claude's reply is enough: no extra click needed.
  $('pasteBox').addEventListener('paste', (e) => {
    e.preventDefault();
    acceptReply(e.clipboardData.getData('text/plain'));
  });
  $('useReplyBtn').onclick = () => acceptReply($('pasteBox').value);
  $('printBtn').onclick = () => {
    setView(false);
    const title = document.title;
    document.title = resumeFileBase(); // suggested name for "Save as PDF"
    window.print();
    document.title = title;
  };
  $('copyBtn').onclick = async () => {
    await navigator.clipboard.writeText(markdown);
    $('copyBtn').textContent = 'Copied ✓';
    setTimeout(() => ($('copyBtn').textContent = 'Copy'), 1500);
  };
  $('downloadBtn').onclick = () => {
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: fileName() });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  // Manual edits are kept and saved, so copy/download/print use your edited version.
  $('editor').addEventListener('input', () => {
    markdown = $('editor').value;
    $('preview').innerHTML = markdownToHtml(markdown);
    chrome.storage.local.set({ [`tailored:${jobId}`]: markdown });
    autoSave(2000); // after you pause typing
  });
  $('saveBtn').onclick = () => saveToFolder();
  // Saves (which writes the PDF) and opens the PDF in your default PDF viewer.
  $('pdfBtn').onclick = async () => {
    $('pdfBtn').disabled = true;
    const saved = await saveToFolder();
    $('pdfBtn').disabled = false;
    if (!saved?.ok || !saved.res.pdf) return;
    const { saveDir = '' } = await chrome.storage.local.get('saveDir');
    callBridge({ type: 'openFile', dir: saveDir, file: saved.res.pdf }).catch(() => {});
  };

  const stored = await chrome.storage.local.get([`job:${jobId}`, `tailored:${jobId}`, `analysis:${jobId}`, `status:${jobId}`, 'resume', 'tailorMode', 'experienceYears']);
  experienceYears = stored.experienceYears || '';
  status = stored[`status:${jobId}`] === 'ready' ? 'ready' : 'not-ready';
  $('readyToggle').checked = status === 'ready';
  $('readyToggle').onchange = () => setStatus($('readyToggle').checked ? 'ready' : 'not-ready');
  mode = stored.tailorMode === 'demo' ? 'demo' : 'honest';
  for (const radio of document.querySelectorAll('input[name="mode"]')) {
    radio.checked = radio.value === mode;
    radio.onchange = () => {
      mode = radio.value;
      chrome.storage.local.set({ tailorMode: mode });
    };
  }
  job = stored[`job:${jobId}`];
  resume = stored.resume || '';
  markdown = stored[`tailored:${jobId}`] || '';
  if (markdown.startsWith(OLD_DEMO_BANNER)) {
    markdown = markdown.slice(OLD_DEMO_BANNER.length).trim();
  }
  if (markdown.endsWith(`*${DEMO_NOTE}*`)) markdown = markdown.slice(0, -`*${DEMO_NOTE}*`.length).trim();
  markdown = fixExperienceYears(cleanProjectHeadings(markdown));
  if (markdown !== (stored[`tailored:${jobId}`] || '')) chrome.storage.local.set({ [`tailored:${jobId}`]: markdown });
  analysis = stored[`analysis:${jobId}`] || null;
  updateButtons();

  if (!job) {
    showError('Job not found. Open the extension and click "Tailor resume" on a job again.');
    reportToQueue(false, 'Job details not found.');
    return;
  }

  document.title = `Resume – ${job.title} at ${job.company}`;
  $('jobTitle').textContent = job.title;
  const meta = $('jobMeta');
  meta.textContent = [job.company, job.location, `via ${job.via}`].filter(Boolean).join(' • ');
  if (job.link) {
    const a = Object.assign(document.createElement('a'), {
      href: job.link, target: '_blank', rel: 'noopener noreferrer', textContent: 'View posting ↗',
    });
    meta.append(' • ', a);
  }

  if (queueMode) {
    if (!resume) return reportToQueue(false, 'No master resume in Settings.');
    if (markdown && !forceRegenerate) return reportToQueue(true, '', { skipped: true });
    if (!(await generateWithClaudeCode())) return; // already reported
    const saved = await saveToFolder({ quiet: true });
    return reportToQueue(saved.ok, saved.error, { index: saved.res?.index });
  }

  if (!resume) {
    showError('Paste your master resume in Settings first.', true);
  } else if (markdown) {
    showResult();
  } else if (autoStart) {
    // Drop ?auto=1 so reloading this tab doesn't start another generation.
    params.delete('auto');
    history.replaceState(null, '', `${location.pathname}?${params}`);
    await generateWithClaudeCode();
  } else {
    showSteps();
    checkBridge();
  }
}

init();
