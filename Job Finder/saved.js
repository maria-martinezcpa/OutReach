// Saved jobs page: lists the numbered job list in your save folder (jobs.json) and lets you
// add, edit, mark ready, open and delete jobs. All changes go through the helper
// (bridge/save.js), which keeps jobs.json, jobs.csv and the job folders in step.

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(4, '0');

let saveDir = '';
let jobs = [];
let editing = null; // job being edited, or null when adding

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
}

function message(text, kind = '') {
  $('message').textContent = text;
  $('message').className = `s-message ${kind}`;
}

async function call(msg) {
  const { res } = await callBridge({ ...msg, dir: saveDir });
  if (res?.error) throw new Error(res.error);
  if (res?.warning) setTimeout(() => message(res.warning, 'bad'), 1500);
  return res;
}

function explain(err) {
  return err instanceof ConnectionError
    ? `The Claude Code helper isn't reachable. Run once in VS Code's terminal, then restart the browser: ${setupCommand()}`
    : err.message;
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

// ---------- Read ----------

async function load() {
  message('Loading…');
  try {
    const res = await call({ type: 'listJobs' });
    jobs = res.jobs;
    // Keep the popup's copy in step, so it hides these jobs in search results.
    await chrome.storage.local.set({ savedJobs: { total: res.total, ready: res.ready, notReady: res.notReady, jobs } });
    message(res.warning || '', res.warning ? 'bad' : '');
  } catch (err) {
    message(explain(err), 'bad');
  }
  render();
}

function visible() {
  const q = $('searchBox').value.trim().toLowerCase();
  const status = $('statusFilter').value;
  const list = jobs.filter((j) => {
    if (status === 'applied' ? !j.appliedOn : status && j.status !== status) return false;
    if (!q) return true;
    return [j.title, j.company, j.location, j.via, j.notes, pad(j.index)].join(' ').toLowerCase().includes(q);
  });
  const sorters = {
    'index-desc': (a, b) => b.index - a.index,
    'index-asc': (a, b) => a.index - b.index,
    lastSaved: (a, b) => String(b.lastSaved).localeCompare(String(a.lastSaved)),
    company: (a, b) => a.company.localeCompare(b.company) || a.index - b.index,
  };
  return list.sort(sorters[$('sortBy').value]);
}

function render() {
  const ready = jobs.filter((j) => j.status === 'ready').length;
  $('statTotal').textContent = jobs.length;
  $('statReady').textContent = ready;
  $('statNotReady').textContent = jobs.length - ready;
  $('statApplied').textContent = jobs.filter((j) => j.appliedOn).length;

  const list = visible();
  $('rows').replaceChildren(...list.map(row));
  const empty = $('empty');
  empty.hidden = list.length > 0;
  empty.textContent = !saveDir
    ? 'Set a save folder in Settings first.'
    : jobs.length ? 'No saved jobs match your search.' : 'No saved jobs yet. Tailor a resume, or click "+ Add job".';
}

function row(j) {
  const statusBtn = el('button', {
    className: `status-pill ${j.status}`,
    type: 'button',
    title: 'Click to switch between Ready and Not ready',
    textContent: j.status === 'ready' ? '✓ Ready' : 'Not ready',
  });
  statusBtn.onclick = () => update(j, { status: j.status === 'ready' ? 'not-ready' : 'ready' });

  const title = j.link
    ? el('a', { href: j.link, target: '_blank', rel: 'noopener noreferrer', title: 'Open the posting', textContent: j.title })
    : j.title;

  const btn = (text, onclick, extra = {}) => Object.assign(el('button', { type: 'button', className: 'secondary', textContent: text, ...extra }), { onclick });
  return el('tr', {},
    el('td', { className: 'num' }, `#${pad(j.index)}`),
    el('td', {}, statusBtn),
    el('td', { className: 'title-cell' }, title, j.notes ? el('div', { className: 'notes' }, j.notes) : null),
    el('td', {}, j.company),
    el('td', {}, j.location || ''),
    el('td', { className: 'muted' }, j.via || ''),
    el('td', { className: 'muted' }, j.appliedOn ? formatDate(j.appliedOn) : ''),
    el('td', { className: 'muted', title: `First saved ${formatDate(j.firstSaved)}` }, formatDate(j.lastSaved)),
    el('td', {}, el('div', { className: 'row-actions' },
      btn(j.hasResume ? 'Resume' : 'Tailor', () => openResume(j), { title: j.hasResume ? 'Open the tailored resume' : 'Tailor a resume for this job' }),
      btn('Edit', () => openDialog(j)),
      btn('Folder', () => openFolder(j)),
      btn('Delete', () => remove(j), { className: 'secondary danger' }),
    )),
  );
}

// Loads a saved job's files into the extension (what the tailoring page reads).
async function loadJobIntoExtension(j) {
  const { files, entry } = await call({ type: 'getJob', index: j.index });
  let job = null;
  try {
    job = JSON.parse(files['job.json'] || 'null');
  } catch {
    // unreadable job.json
  }
  job = { ...(job || {}), title: entry.title, company: entry.company, location: entry.location, via: entry.via, link: entry.link };
  job.id = job.id || entry.jobId || `saved-${entry.index}`;
  const data = { [`job:${job.id}`]: job, [`status:${job.id}`]: entry.status };
  if (files['resume.md']) data[`tailored:${job.id}`] = files['resume.md'];
  await chrome.storage.local.set(data);
  return job;
}

// Queues every saved job without a resume (the visible ones, if a filter or search is on).
async function tailorMissing() {
  const missing = visible().filter((j) => !j.hasResume);
  if (!missing.length) {
    message('Every job shown already has a resume.', 'ok');
    return;
  }
  if (!confirm(`Make resumes for ${missing.length} job${missing.length === 1 ? '' : 's'} without one? Each one is a Claude Code request and takes about a minute.`)) return;
  message(`Preparing ${missing.length} jobs…`);
  try {
    const jobs = [];
    for (const j of missing) jobs.push(await loadJobIntoExtension(j));
    await addToQueue(jobs);
    message('');
  } catch (err) {
    message(explain(err), 'bad');
  }
}

// Opens the tailoring tab with this job's saved files (the folder is the source of truth).
async function openResume(j) {
  try {
    const { files, entry } = await call({ type: 'getJob', index: j.index });
    let job = null;
    try {
      job = JSON.parse(files['job.json'] || 'null');
    } catch {
      // unreadable job.json
    }
    job = { ...(job || {}), title: entry.title, company: entry.company, location: entry.location, via: entry.via, link: entry.link };
    job.id = job.id || entry.jobId || `saved-${entry.index}`;
    const data = { [`job:${job.id}`]: job, [`status:${job.id}`]: entry.status };
    if (files['resume.md']) data[`tailored:${job.id}`] = files['resume.md'];
    if (files['analysis.json']) {
      try {
        data[`analysis:${job.id}`] = JSON.parse(files['analysis.json']);
      } catch {
        // ignore
      }
    }
    await chrome.storage.local.set(data);
    chrome.tabs.create({ url: `tailor.html?id=${encodeURIComponent(job.id)}` });
  } catch (err) {
    message(explain(err), 'bad');
  }
}

async function openFolder(j) {
  try {
    await call({ type: 'openFolder', index: j?.index });
  } catch (err) {
    message(explain(err), 'bad');
  }
}

// ---------- Update ----------

async function update(j, fields) {
  message('Saving…');
  try {
    const res = await call({ type: 'updateJob', index: j.index, fields });
    Object.assign(j, res.entry);
    // Keep the tailoring tab's copy in step.
    if (fields.status && j.jobId) await chrome.storage.local.set({ [`status:${j.jobId}`]: res.entry.status });
    const { [`job:${j.jobId}`]: local } = await chrome.storage.local.get(`job:${j.jobId}`);
    if (local) await chrome.storage.local.set({ [`job:${j.jobId}`]: { ...local, title: j.title, company: j.company, location: j.location, via: j.via, link: j.link } });
    message(`Saved #${pad(j.index)} ✓`, 'ok');
    await load();
    return true;
  } catch (err) {
    message(explain(err), 'bad');
    return false;
  }
}

// ---------- Delete ----------

async function remove(j) {
  if (!confirm(`Delete #${pad(j.index)} ${j.title} at ${j.company}?\n\nIts folder is moved to "Deleted" in your save folder, so you can still recover it. The number is not reused.`)) return;
  message('Deleting…');
  try {
    await call({ type: 'deleteJob', index: j.index });
    if (j.jobId) await chrome.storage.local.remove([`status:${j.jobId}`]);
    message(`Deleted #${pad(j.index)}.`, 'ok');
    await load();
  } catch (err) {
    message(explain(err), 'bad');
  }
}

// ---------- Create / edit dialog ----------

function openDialog(j = null) {
  editing = j;
  $('dialogTitle').textContent = j ? `Edit #${pad(j.index)}` : 'Add a job';
  $('descField').hidden = Boolean(j);
  $('fTitle').value = j?.title || '';
  $('fCompany').value = j?.company || '';
  $('fLocation').value = j?.location || '';
  $('fVia').value = j?.via || '';
  $('fLink').value = j?.link || '';
  $('fStatus').value = j?.status || 'not-ready';
  $('fApplied').value = j?.appliedOn || '';
  $('fNotes').value = j?.notes || '';
  $('fDescription').value = '';
  $('dialogError').textContent = '';
  $('editDialog').showModal();
  $('fTitle').focus();
}

function formFields() {
  return {
    title: $('fTitle').value.trim(),
    company: $('fCompany').value.trim(),
    location: $('fLocation').value.trim(),
    via: $('fVia').value.trim(),
    link: $('fLink').value.trim(),
    status: $('fStatus').value,
    appliedOn: $('fApplied').value,
    notes: $('fNotes').value.trim(),
  };
}

async function create(fields, description) {
  const job = {
    id: `manual-${Date.now().toString(36)}`,
    title: fields.title,
    company: fields.company,
    location: fields.location,
    via: fields.via,
    link: fields.link,
    description,
    highlights: [],
    applyOptions: [],
    added: 'manually',
  };
  const desc = [`# ${job.title}`, '', `- **Company:** ${job.company}`, job.location && `- **Location:** ${job.location}`,
    job.via && `- **Source:** ${job.via}`, job.link && `- **Posting link:** ${job.link}`, '', description && '## Full description', '', description]
    .filter((line) => line !== false && line !== undefined).join('\n');

  const res = await call({ type: 'save', job, status: fields.status, files: { 'job.json': JSON.stringify(job, null, 2), 'job-description.md': desc + '\n' } });
  if (!res.created) throw new Error(`This job is already saved as #${pad(res.index)}.`);
  if (fields.notes || fields.appliedOn) await call({ type: 'updateJob', index: res.index, fields: { notes: fields.notes, appliedOn: fields.appliedOn } });
  await chrome.storage.local.set({ [`job:${job.id}`]: job, [`status:${job.id}`]: fields.status });
  return res.index;
}

$('editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fields = formFields();
  if (!fields.title || !fields.company) {
    $('dialogError').textContent = 'Title and company are required.';
    return;
  }
  $('saveJobBtn').disabled = true;
  try {
    if (editing) {
      if (await update(editing, fields)) $('editDialog').close();
      else $('dialogError').textContent = $('message').textContent;
    } else {
      const index = await create(fields, $('fDescription').value.trim());
      $('editDialog').close();
      message(`Added #${pad(index)} ✓`, 'ok');
      await load();
    }
  } catch (err) {
    $('dialogError').textContent = explain(err);
  } finally {
    $('saveJobBtn').disabled = false;
  }
});

// ---------- Init ----------

async function init() {
  $('cancelBtn').onclick = () => $('editDialog').close();
  $('addBtn').onclick = () => openDialog();
  $('tailorMissingBtn').onclick = tailorMissing;
  $('refreshBtn').onclick = start;
  $('openDirBtn').onclick = () => openFolder(null);
  for (const id of ['searchBox', 'statusFilter', 'sortBy']) $(id).addEventListener('input', render);

  $('folderForm').addEventListener('submit', useFolder);
  await start();
}

// Reads the save folder from storage; without one, asks for it on this page.
async function start() {
  ({ saveDir = '' } = await chrome.storage.local.get('saveDir'));
  $('folderSetup').hidden = Boolean(saveDir);
  for (const id of ['addBtn', 'openDirBtn', 'refreshBtn', 'tailorMissingBtn']) $(id).disabled = !saveDir;
  if (!saveDir) {
    message('No save folder set yet.', 'bad');
    render();
    $('folderInput').focus();
    return;
  }
  await load();
}

// Checks the folder with the helper, then stores it (same setting as in Settings).
async function useFolder(e) {
  e.preventDefault();
  const dir = $('folderInput').value.trim();
  if (!dir) return;
  message('Checking folder…');
  try {
    const { res } = await callBridge({ type: 'checkDir', dir });
    if (res?.error) throw new Error(res.error);
    await chrome.storage.local.set({ saveDir: res.path });
  } catch (err) {
    message(explain(err), 'bad');
  }
}

// The folder set here or in Settings (in any tab): reload with it.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.saveDir && changes.saveDir.newValue !== saveDir) start();
});

// Coming back to this tab (e.g. after tailoring a resume elsewhere): show the latest list.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('editDialog').open) start();
});

init();
