// Writes tailored resumes and job details into the folder chosen in the extension's Settings,
// and keeps a numbered list of every saved job there:
//   <folder>/jobs.json   the list (used by the extension to skip jobs you already have)
//   <folder>/jobs.csv    the same list, readable in Excel
//   <folder>/0001 - Company - Title/             one folder per job (new save folders: flat)
//   <folder>/Ready/0001 - .../, Not ready/...     save folders made by older versions (by status)
//   <folder>/.data/0001/                         hidden working files for job 0001
// Each job folder holds only "Resume - Company - Title.pdf" and job-description.txt. The files the
// extension sends (resume .md/.html, job.json, analysis.json, job-description.md) live in
// .data/<number>/, where the Saved jobs page reads them back.
// Job numbers are given once and never reused; marking a job ready moves its folder.
// Only plain file names are accepted, and every file stays inside that folder.
const fs = require('fs');
const path = require('path');

const REGISTRY = 'jobs.json';
const REGISTRY_CSV = 'jobs.csv';
const LOCK = '.jobs.lock';
const STATUS_DIRS = { ready: 'Ready', 'not-ready': 'Not ready' };
const DELETED_DIR = 'Deleted';
const DATA_DIR = '.data';
// Files an older version kept in the job folder; moved to .data/<number>/ when the job is saved.
const LEGACY_DATA_FILES = ['job.json', 'analysis.json', 'job-description.md', 'notes.md'];
// Windows paths over ~260 characters break Chrome's PDF export and Explorer.
const MAX_PATH = 250;
let csvWarning = '';
const normStatus = (s) => (s === 'ready' ? 'ready' : 'not-ready');

// Windows-safe folder name: no reserved characters, no trailing dots/spaces.
function safeName(s, max = 100) {
  return String(s || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .replace(/[. ]+$/, '') || 'untitled';
}

// Same posting seen again (even from another job board): same company, title and location.
// Must match jobKey() in bridge-client.js.
function jobKey(job) {
  const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return [job.company, job.title, job.location].map(clean).join('|');
}

function resolveDir(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir.trim())) {
    throw new Error('Set a full folder path in Settings, e.g. D:\\Resumes.');
  }
  return path.resolve(dir.trim());
}

// Creates the folder if needed and proves we can write to it.
function checkDir(dir) {
  const base = resolveDir(dir);
  fs.mkdirSync(base, { recursive: true });
  const probe = path.join(base, '.job-finder-write-test');
  fs.writeFileSync(probe, '');
  fs.rmSync(probe);
  return { ok: true, path: base, total: loadRegistry(base).jobs.length };
}

// ---------- The numbered job list ----------

// Batch tailoring saves several jobs at once from separate processes; the lock file makes
// sure two of them never hand out the same number.
function withLock(base, fn) {
  const lock = path.join(base, LOCK);
  const started = Date.now();
  for (;;) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 30_000) fs.rmSync(lock, { force: true }); // left by a crash
      } catch {
        // removed by its owner meanwhile
      }
      if (Date.now() - started > 15_000) throw new Error('The save folder is busy. Try again.');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { force: true });
  }
}

// The resume in a job folder is "Resume - Company - Role.pdf". Older saves also kept the .md and
// .html there (or plain resume.md / resume.html); those are moved into .data/<number>/.
const RESUME_FILE = /^(resume|Resume - .+)\.(md|html|pdf)$/;

function resumeBase(entry) {
  return `Resume - ${safeName(entry.company, 60)} - ${safeName(entry.title, 80)}`;
}

// The resume file name for a job folder, shortened when the full PDF path would be too long.
function resumeName(folder, entry) {
  for (const [company, title] of [[60, 80], [30, 40], [20, 25], [12, 15]]) {
    const name = `Resume - ${safeName(entry.company, company)} - ${safeName(entry.title, title)}`;
    if (path.join(folder, `${name}.pdf`).length <= MAX_PATH) return name;
  }
  return `Resume - ${safeName(entry.company, 12)} - ${safeName(entry.title, 15)}`;
}

function dataDirFor(base, entry) {
  return path.join(base, DATA_DIR, String(entry.index).padStart(4, '0'));
}

// Hides the .data folder in Windows Explorer (best effort).
function hideDataDir(base) {
  if (process.platform !== 'win32') return;
  try {
    require('child_process').spawnSync('attrib', ['+h', path.join(base, DATA_DIR)], { windowsHide: true });
  } catch {
    // not hidden: harmless
  }
}

// Moves working files an older version saved in the job folder into the job's .data folder,
// so the job folder ends up with only the PDF and job-description.txt.
function moveLegacyFiles(folder, dataDir) {
  let names = [];
  try {
    names = fs.readdirSync(folder);
  } catch {
    return;
  }
  for (const name of names) {
    const ext = path.extname(name);
    let to = null;
    if (LEGACY_DATA_FILES.includes(name)) to = name;
    else if (RESUME_FILE.test(name) && (ext === '.md' || ext === '.html')) to = `resume${ext}`;
    if (!to) continue;
    try {
      fs.renameSync(path.join(folder, name), path.join(dataDir, to));
    } catch {
      // open in another program: leave it for next time
    }
  }
}

// Plain-text job file for each folder: link and key details first, then the full description.
function jobText(job, fallbackDescription = '') {
  const hl = (Array.isArray(job.highlights) ? job.highlights : []).flatMap((h) => (typeof h === 'string' ? [h] : h.items || []));
  const lines = [`Job: ${job.title || ''}`, `Company: ${job.company || ''}`, `Location: ${job.location || ''}`];
  if (job.salaryText) lines.push(`Pay: ${job.salaryText}`);
  if (job.schedule) lines.push(`Type: ${job.schedule}`);
  if (job.posted) lines.push(`Posted: ${job.posted}`);
  lines.push(`Source: ${job.via || ''}`, `Link: ${job.link || ''}`);
  if (hl.length) lines.push('', 'Highlights:', ...hl.map((h) => `- ${h}`));
  lines.push('', 'Job Description', '---------------', '', job.description || fallbackDescription || '');
  return lines.join('\n').replace(/\r?\n/g, '\r\n') + '\r\n';
}

// The resume (.md) in a job folder, whatever it's called; null if there is none.
function findResume(folder, entry) {
  const wanted = `${resumeBase(entry)}.md`;
  let names = [];
  try {
    names = fs.readdirSync(folder);
  } catch {
    return null;
  }
  if (names.includes(wanted)) return wanted;
  return names.find((n) => /^Resume - .+\.md$/.test(n)) || (names.includes('resume.md') ? 'resume.md' : null);
}

// Renames the resume files in a job folder to the job's current company and role.
function renameResumeFiles(folder, entry) {
  let names = [];
  try {
    names = fs.readdirSync(folder);
  } catch {
    return;
  }
  for (const ext of ['.md', '.html', '.pdf']) {
    const wanted = `${resumeName(folder, entry)}${ext}`;
    const old = names.find((n) => n !== wanted && n.endsWith(ext) && RESUME_FILE.test(n));
    if (old && !names.includes(wanted)) {
      try {
        fs.renameSync(path.join(folder, old), path.join(folder, wanted));
      } catch {
        // file open elsewhere: keep the old name
      }
    }
  }
}

function folderName(entry) {
  return `${String(entry.index).padStart(4, '0')} - ${safeName(entry.company, 40)} - ${safeName(entry.title, 60)}`;
}

function loadRegistry(base) {
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(base, REGISTRY), 'utf8'));
    if (Array.isArray(reg.jobs)) return reg;
  } catch {
    // no list yet
  }
  // New save folders are flat: job folders sit directly in the save folder (no Ready/ or
  // Not ready/); the status is kept in jobs.json / jobs.csv. Lists created by older versions have
  // no "layout" and keep their status subfolders.
  return { version: 1, layout: 'flat', nextIndex: 1, jobs: [] };
}

// Where a job's folder belongs: "<Status>/<0012 - Company - Title>", or just the name when flat.
function statusFolder(reg, entry, name) {
  return reg.layout === 'flat' ? name : path.join(STATUS_DIRS[normStatus(entry.status)], name);
}

// First run in a folder that already has job subfolders (from before numbering): number them
// oldest first and rename them to "0001 - Company - Title".
function adoptExistingFolders(base, reg) {
  const known = new Set([...reg.jobs.map((j) => j.folder), ...Object.values(STATUS_DIRS), DELETED_DIR, DATA_DIR]);
  const found = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || known.has(entry.name)) continue;
    const jobFile = path.join(base, entry.name, 'job.json');
    try {
      found.push({ dir: entry.name, job: JSON.parse(fs.readFileSync(jobFile, 'utf8')), time: fs.statSync(jobFile).mtimeMs });
    } catch {
      // not a job folder
    }
  }
  found.sort((a, b) => a.time - b.time);
  for (const { dir, job, time } of found) {
    if (reg.jobs.some((j) => j.jobId === job.id || j.key === jobKey(job))) continue;
    const entry = makeEntry(reg, job, new Date(time).toISOString());
    entry.folder = folderName(entry);
    try {
      fs.renameSync(path.join(base, dir), path.join(base, entry.folder));
    } catch {
      entry.folder = dir; // in use or name taken: keep the old folder name
    }
    reg.jobs.push(entry);
  }
}

function makeEntry(reg, job, savedAt) {
  return {
    index: reg.nextIndex++,
    jobId: job.id || '',
    key: jobKey(job),
    title: job.title || '',
    company: job.company || '',
    location: job.location || '',
    via: job.via || '',
    link: job.link || '',
    folder: '',
    status: 'not-ready',
    firstSaved: savedAt,
    lastSaved: savedAt,
  };
}

function placeFolder(base, reg, entry) {
  entry.status = normStatus(entry.status);
  const wanted = statusFolder(reg, entry, path.basename(entry.folder || folderName(entry)));
  if (entry.folder === wanted) return;
  const from = entry.folder && path.join(base, entry.folder);
  const to = path.join(base, wanted);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    if (from && fs.existsSync(from) && !fs.existsSync(to)) fs.renameSync(from, to);
    entry.folder = wanted;
  } catch {
    // folder open in another program: keep it where it is for now, retry next time
  }
}

function placeFolders(base, reg) {
  const before = JSON.stringify(reg.jobs.map((j) => j.folder));
  for (const entry of reg.jobs) placeFolder(base, reg, entry);
  return JSON.stringify(reg.jobs.map((j) => j.folder)) !== before;
}

function counts(reg) {
  const ready = reg.jobs.filter((j) => j.status === 'ready').length;
  return { total: reg.jobs.length, ready, notReady: reg.jobs.length - ready };
}

function writeRegistry(base, reg) {
  reg.jobs.sort((a, b) => a.index - b.index);
  fs.writeFileSync(path.join(base, REGISTRY), JSON.stringify(reg, null, 2));

  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [
    ['Index', 'Status', 'Title', 'Company', 'Location', 'Source', 'First saved', 'Last saved', 'Folder', 'Posting link'],
    ...reg.jobs.map((j) => [String(j.index).padStart(4, '0'), j.status === 'ready' ? 'Ready' : 'Not ready', j.title, j.company, j.location, j.via, j.firstSaved, j.lastSaved, j.folder, j.link]),
  ];
  // BOM so Excel opens it as UTF-8.
  // jobs.csv is only a readable copy: if it's open in Excel (locked), skip it and say so,
  // rather than failing the whole request. It catches up on the next change.
  try {
    fs.writeFileSync(path.join(base, REGISTRY_CSV), '\ufeff' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n');
    csvWarning = '';
  } catch (e) {
    if (!['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) throw e;
    csvWarning = 'jobs.csv is open in another program (Excel?), so it was not updated. Close it and it will update on the next change.';
  }
}

function listJobs(dir) {
  const base = resolveDir(dir);
  if (!fs.existsSync(base)) return { jobs: [], total: 0, ready: 0, notReady: 0 };
  const reg = withLock(base, () => {
    const r = loadRegistry(base);
    const before = r.jobs.length;
    adoptExistingFolders(base, r);
    const moved = placeFolders(base, r);
    for (const j of r.jobs) renameResumeFiles(path.join(base, j.folder), j);
    if (moved || r.jobs.length !== before || csvWarning) writeRegistry(base, r);
    return r;
  });
  const jobs = reg.jobs.map((j) => ({
    index: j.index, jobId: j.jobId, key: j.key, title: j.title, company: j.company, location: j.location,
    status: normStatus(j.status), via: j.via, link: j.link, notes: j.notes || '', appliedOn: j.appliedOn || '',
    firstSaved: j.firstSaved, lastSaved: j.lastSaved, folder: j.folder,
    hasResume: fs.existsSync(path.join(dataDirFor(base, j), 'resume.md')) || Boolean(findResume(path.join(base, j.folder), j)),
  }));
  return { jobs, ...counts(reg), warning: csvWarning };
}

// ---------- Saving one job ----------

// status: 'ready' | 'not-ready' | undefined (keep the job's current status).
function saveJob(dir, job, files, status) {
  const base = resolveDir(dir);
  if (!job || typeof job !== 'object') throw new Error('Missing job details.');
  if (!files || typeof files !== 'object') throw new Error('Nothing to save.');
  const names = Object.keys(files);
  const bad = names.find((name) => !/^[\w][\w.-]*$/.test(name));
  if (bad) throw new Error(`Invalid file name: ${bad}`);

  fs.mkdirSync(base, { recursive: true });
  return withLock(base, () => {
    const reg = loadRegistry(base);
    adoptExistingFolders(base, reg);

    const now = new Date().toISOString();
    let entry = reg.jobs.find((j) => (job.id && j.jobId === job.id) || j.key === jobKey(job));
    const created = !entry;
    if (!entry) {
      entry = makeEntry(reg, job, now);
      entry.folder = folderName(entry);
      reg.jobs.push(entry);
    }
    entry.lastSaved = now;
    if (status) entry.status = normStatus(status);
    placeFolders(base, reg);

    const target = path.join(base, entry.folder);
    if (!target.startsWith(base + path.sep)) throw new Error('Invalid folder name.');
    fs.mkdirSync(target, { recursive: true });
    const dataDir = dataDirFor(base, entry);
    fs.mkdirSync(dataDir, { recursive: true });
    hideDataDir(base);
    moveLegacyFiles(target, dataDir);

    // Working files go to .data/<number>/ under plain names (resume.md, resume.html, job.json...).
    const written = [];
    for (const name of names) {
      fs.writeFileSync(path.join(dataDir, name), String(files[name] ?? ''), 'utf8');
      written.push(name);
    }
    // The job folder itself: the job description as text (the PDF is added by handlers.js).
    fs.writeFileSync(path.join(target, 'job-description.txt'), jobText(job, files['job-description.md']), 'utf8');
    writeRegistry(base, reg);

    return {
      ok: true, warning: csvWarning, created, path: target, dataPath: dataDir, index: entry.index, status: entry.status,
      files: written, html: names.includes('resume.html') ? path.join(dataDir, 'resume.html') : '',
      resumeName: resumeName(target, entry), ...counts(reg),
    };
  });
}

// ---------- Reading, editing and deleting one saved job (Saved jobs page) ----------

const READABLE_FILES = ['job.json', 'analysis.json', 'job-description.md'];

function findEntry(reg, index) {
  const entry = reg.jobs.find((j) => j.index === Number(index));
  if (!entry) throw new Error(`Job #${index} is not in the saved list.`);
  return entry;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function getJob(dir, index) {
  const base = resolveDir(dir);
  const reg = loadRegistry(base);
  const entry = findEntry(reg, index);
  const folder = path.join(base, entry.folder);
  const dataDir = dataDirFor(base, entry);
  const files = {};
  // .data/<number>/ first; older saves kept these files in the job folder itself.
  for (const name of READABLE_FILES) {
    for (const dir of [dataDir, folder]) {
      try {
        files[name] = fs.readFileSync(path.join(dir, name), 'utf8');
        break;
      } catch {
        // not saved here
      }
    }
  }
  const dataResume = path.join(dataDir, 'resume.md');
  const resumeFile = findResume(folder, entry);
  if (fs.existsSync(dataResume)) files['resume.md'] = fs.readFileSync(dataResume, 'utf8');
  else if (resumeFile) files['resume.md'] = fs.readFileSync(path.join(folder, resumeFile), 'utf8');
  return { entry: { ...entry, status: normStatus(entry.status) }, path: folder, files };
}

const EDITABLE = ['title', 'company', 'location', 'via', 'link', 'notes', 'appliedOn', 'status'];

// fields: any of EDITABLE. Updates the list, job.json and (for title/company/status) the folder.
function updateJob(dir, index, fields = {}) {
  const base = resolveDir(dir);
  return withLock(base, () => {
    const reg = loadRegistry(base);
    const entry = findEntry(reg, index);
    for (const k of EDITABLE) {
      if (fields[k] !== undefined) entry[k] = k === 'status' ? normStatus(fields[k]) : String(fields[k]).trim();
    }
    if (!entry.title || !entry.company) throw new Error('Title and company are required.');
    entry.key = jobKey(entry);
    const dupe = reg.jobs.find((j) => j !== entry && j.key === entry.key);
    if (dupe) throw new Error(`That would duplicate job #${String(dupe.index).padStart(4, '0')}.`);
    entry.lastSaved = new Date().toISOString();

    // Rename/move the folder to match: "<Status>/<0012 - Company - Title>" (or flat).
    const wanted = statusFolder(reg, entry, folderName(entry));
    if (wanted !== entry.folder) {
      const from = path.join(base, entry.folder);
      const to = path.join(base, wanted);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      if (fs.existsSync(to)) throw new Error(`A folder named "${wanted}" already exists.`);
      if (fs.existsSync(from)) {
        try {
          fs.renameSync(from, to);
        } catch (e) {
          throw new Error(`Could not rename the folder (is a file in it open?): ${e.message}`);
        }
      } else {
        fs.mkdirSync(to, { recursive: true });
      }
      entry.folder = wanted;
    }

    const folder = path.join(base, entry.folder);
    renameResumeFiles(folder, entry);

    // Keep job.json (used to reopen the tailoring tab) and job-description.txt in step with the list.
    const dataDir = dataDirFor(base, entry);
    fs.mkdirSync(dataDir, { recursive: true });
    moveLegacyFiles(folder, dataDir);
    const jobFile = path.join(dataDir, 'job.json');
    const job = readJson(jobFile) || { id: entry.jobId };
    for (const k of ['title', 'company', 'location', 'via', 'link']) job[k] = entry[k];
    fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));
    let description = '';
    try {
      description = fs.readFileSync(path.join(dataDir, 'job-description.md'), 'utf8');
    } catch {
      // none saved
    }
    fs.writeFileSync(path.join(folder, 'job-description.txt'), jobText(job, description), 'utf8');
    if (entry.notes) fs.writeFileSync(path.join(dataDir, 'notes.md'), entry.notes + '\n');
    else fs.rmSync(path.join(dataDir, 'notes.md'), { force: true });

    writeRegistry(base, reg);
    return { ok: true, warning: csvWarning, entry, ...counts(reg) };
  });
}

// Moves the job's folder to "Deleted/" (recoverable) and removes it from the list.
// Its number is never given to another job.
function deleteJob(dir, index) {
  const base = resolveDir(dir);
  return withLock(base, () => {
    const reg = loadRegistry(base);
    const entry = findEntry(reg, index);
    const from = path.join(base, entry.folder);
    if (fs.existsSync(from)) {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const to = path.join(base, DELETED_DIR, `${path.basename(entry.folder)} (deleted ${stamp})`);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      try {
        fs.renameSync(from, to);
      } catch (e) {
        throw new Error(`Could not move the folder (is a file in it open?): ${e.message}`);
      }
      // Its working files go with it, so a deleted job can still be recovered whole.
      const dataDir = dataDirFor(base, entry);
      if (fs.existsSync(dataDir)) {
        try {
          fs.renameSync(dataDir, path.join(to, '_data'));
        } catch {
          // in use: left in .data
        }
      }
    }
    reg.jobs = reg.jobs.filter((j) => j !== entry);
    writeRegistry(base, reg);
    return { ok: true, warning: csvWarning, index: entry.index, ...counts(reg) };
  });
}

// Opens the save folder, or one job's folder, in Windows Explorer.
function openFolder(dir, index) {
  const base = resolveDir(dir);
  const target = index == null ? base : path.join(base, findEntry(loadRegistry(base), index).folder);
  if (!fs.existsSync(target)) throw new Error('That folder does not exist yet.');
  const { spawn } = require('child_process');
  const opener = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(opener, [target], { detached: true, stdio: 'ignore' }).unref();
  return { ok: true, path: target };
}

// Opens a file inside the save folder (e.g. the resume PDF) in its default app.
function openFile(dir, file) {
  const base = resolveDir(dir);
  const target = path.resolve(String(file || ''));
  if (!target.startsWith(base + path.sep) || !fs.existsSync(target)) throw new Error('File not found in your save folder.');
  const { spawn } = require('child_process');
  if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
  return { ok: true, path: target };
}

module.exports = { checkDir, saveJob, listJobs, getJob, updateJob, deleteJob, openFolder, openFile, jobKey };
