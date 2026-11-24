// "Tailor all" queue. Other pages add jobs with addToQueue() (bridge-client.js), which puts
// them in storage as `queueInbox`; this page owns the queue (`queue` in storage), runs each
// job through tailor.html?queue=1 in a hidden frame, and saves its progress, so closing and
// reopening the page continues where it stopped.
//
// Pause: finish the resumes in progress, start no new ones. Stop: cancel them right away
// (they go back to waiting). Continue / Start: carry on.

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(4, '0');
const TIMEOUT_MS = 8 * 60 * 1000; // per resume

let queue = { items: [], paused: true, parallel: 2 };
const workers = new Map(); // job id -> { frame, timer }

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
}

function message(text, kind = '') {
  $('message').textContent = text;
  $('message').className = `s-message ${kind}`;
}

const save = () => chrome.storage.local.set({ queue });
const count = (state) => queue.items.filter((i) => i.state === state).length;

// ---------- Inbox: jobs added from the popup / Saved jobs page ----------

async function takeInbox() {
  const { queueInbox = [] } = await chrome.storage.local.get('queueInbox');
  if (!queueInbox.length) return;
  await chrome.storage.local.set({ queueInbox: [] });
  let added = 0;
  for (const add of queueInbox) {
    const existing = queue.items.find((i) => i.id === add.id);
    if (existing && ['waiting', 'running'].includes(existing.state)) continue;
    const item = { id: add.id, title: add.title, company: add.company, force: Boolean(add.force), state: 'waiting', error: '', index: null };
    if (existing) Object.assign(existing, item);
    else queue.items.push(item);
    added++;
  }
  if (added) {
    queue.paused = false;
    message(`Added ${added} job${added === 1 ? '' : 's'}.`, 'ok');
  }
  await save();
  render();
  pump();
}

// ---------- Running ----------

function pump() {
  if (queue.paused) return;
  while (workers.size < queue.parallel) {
    const next = queue.items.find((i) => i.state === 'waiting');
    if (!next) break;
    start(next);
  }
  if (!workers.size && !count('waiting') && queue.items.length) finished();
  render();
}

function start(item) {
  item.state = 'running';
  item.error = '';
  item.started = Date.now();
  const params = new URLSearchParams({ id: item.id, auto: '1', queue: '1' });
  if (item.force) params.set('force', '1');
  const frame = el('iframe', { src: `tailor.html?${params}`, title: item.title });
  const timer = setTimeout(() => finish(item.id, { ok: false, error: 'Took longer than 8 minutes.' }), TIMEOUT_MS);
  workers.set(item.id, { frame, timer });
  $('workers').append(frame);
  save();
}

function cancelWorker(id) {
  const w = workers.get(id);
  if (!w) return;
  clearTimeout(w.timer);
  w.frame.remove();
  workers.delete(id);
}

function finish(id, { ok, error, skipped, index }) {
  const item = queue.items.find((i) => i.id === id);
  cancelWorker(id);
  if (!item || item.state !== 'running') return;
  item.state = ok ? (skipped ? 'skipped' : 'done') : 'failed';
  item.error = ok ? '' : error || 'Failed.';
  item.index = index ?? item.index;
  item.seconds = Math.round((Date.now() - item.started) / 1000);
  save();
  pump();
}

function finished() {
  const failed = count('failed');
  message(failed ? `Finished with ${failed} failed. Click "Retry failed" to try them again.` : 'All done ✓', failed ? 'bad' : 'ok');
}

// Results from the tailor.html frames.
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.data?.type !== 'tailorResult') return;
  finish(e.data.jobId, e.data);
});

// ---------- Controls ----------

function setPaused(paused) {
  queue.paused = paused;
  save();
  if (!paused) message('');
  pump();
  render();
}

function stopAll() {
  for (const id of [...workers.keys()]) {
    cancelWorker(id);
    const item = queue.items.find((i) => i.id === id);
    if (item) item.state = 'waiting';
  }
  queue.paused = true;
  message('Stopped. Resumes that were in progress will start again when you continue.');
  save();
  render();
}

function retry(item) {
  item.state = 'waiting';
  item.error = '';
  save();
  pump();
}

function remove(item) {
  cancelWorker(item.id);
  queue.items = queue.items.filter((i) => i !== item);
  save();
  pump();
}

function openResult(item) {
  chrome.tabs.create({ url: `tailor.html?id=${encodeURIComponent(item.id)}` });
}

// ---------- Rendering ----------

const LABELS = { waiting: 'Waiting', running: 'Working…', done: '✓ Done', failed: '✗ Failed', skipped: 'Already had one' };

function render() {
  const total = queue.items.length;
  const done = count('done') + count('skipped');
  const failed = count('failed');
  const running = workers.size;
  const waiting = count('waiting');
  $('statTotal').textContent = total;
  $('statWaiting').textContent = waiting;
  $('statRunning').textContent = running;
  $('statDone').textContent = done;
  $('statFailed').textContent = failed;
  $('bar').style.width = total ? `${((done + failed) / total) * 100}%` : '0';

  const active = running || (waiting && !queue.paused);
  const timed = queue.items.filter((i) => i.state === 'done' && i.seconds);
  const avg = timed.length ? timed.reduce((a, i) => a + i.seconds, 0) / timed.length : 60;
  const left = Math.ceil(((waiting + running) * avg) / queue.parallel / 60);
  $('stateText').textContent = !total ? ''
    : active ? `${done + failed} of ${total} finished · about ${left} min left`
    : waiting ? `Paused · ${waiting} waiting` : `${done + failed} of ${total} finished`;

  $('startBtn').textContent = queue.paused && done + failed > 0 && waiting ? '▶ Continue' : '▶ Start';
  $('startBtn').disabled = !queue.paused || !waiting;
  $('pauseBtn').disabled = queue.paused || !active;
  $('stopBtn').disabled = !running && queue.paused;
  $('retryBtn').disabled = !failed;
  $('clearBtn').disabled = !(done + failed);
  $('clearAllBtn').disabled = !total || running > 0;

  $('empty').hidden = total > 0;
  $('rows').replaceChildren(...queue.items.map((item, n) => {
    const btn = (text, onclick, extra = {}) => Object.assign(el('button', { type: 'button', className: 'secondary', textContent: text, ...extra }), { onclick });
    const details = item.state === 'failed' ? el('span', { className: 'q-err' }, item.error)
      : item.state === 'running' ? el('span', {}, el('span', { className: 'q-dot' }), 'Claude Code is writing this resume…')
      : item.index ? `Saved as #${pad(item.index)}${item.seconds ? ` · ${item.seconds}s` : ''}`
      : item.state === 'skipped' ? 'Kept the existing resume' : '';
    return el('tr', {},
      el('td', { className: 'num' }, String(n + 1)),
      el('td', {}, el('span', { className: `q-pill ${item.state}` }, LABELS[item.state] || item.state)),
      el('td', { className: 'title-cell' }, item.title),
      el('td', {}, item.company),
      el('td', { className: 'muted' }, details),
      el('td', {}, el('div', { className: 'row-actions' },
        ['done', 'skipped'].includes(item.state) && btn('Open', () => openResult(item)),
        item.state === 'failed' && btn('Retry', () => retry(item)),
        item.state !== 'running' && btn('Remove', () => remove(item)),
        item.state === 'running' && btn('Cancel', () => { cancelWorker(item.id); item.state = 'waiting'; queue.paused = true; save(); render(); message('Cancelled. Click Continue to go on.'); }),
      )),
    );
  }));
}

// ---------- Init ----------

async function init() {
  // Only one queue page should run the queue: if another is open, switch to it.
  const me = await chrome.tabs.getCurrent();
  const channel = new BroadcastChannel('job-finder-queue');
  let otherTab = null;
  channel.onmessage = (e) => {
    if (e.data.type === 'hello' && e.data.tabId !== me?.id) channel.postMessage({ type: 'here', tabId: me?.id });
    if (e.data.type === 'here') otherTab = e.data.tabId;
  };
  channel.postMessage({ type: 'hello', tabId: me?.id });
  await new Promise((r) => setTimeout(r, 250));
  if (otherTab != null) {
    await chrome.tabs.update(otherTab, { active: true });
    window.close();
    return;
  }

  const stored = await chrome.storage.local.get(['queue', 'tailorMode']);
  if (stored.queue) queue = { parallel: 2, ...stored.queue };
  // Resumes that were in progress when the page closed start over.
  for (const item of queue.items) if (item.state === 'running') item.state = 'waiting';
  await save();

  $('parallel').value = String(queue.parallel);
  $('parallel').onchange = () => {
    queue.parallel = Number($('parallel').value);
    save();
    pump();
  };
  for (const radio of document.querySelectorAll('input[name="mode"]')) {
    radio.checked = radio.value === (stored.tailorMode === 'demo' ? 'demo' : 'honest');
    radio.onchange = () => chrome.storage.local.set({ tailorMode: radio.value });
  }
  $('startBtn').onclick = () => setPaused(false);
  $('pauseBtn').onclick = () => {
    setPaused(true);
    message(workers.size ? 'Pausing: the resumes in progress will finish first.' : 'Paused.');
  };
  $('stopBtn').onclick = stopAll;
  $('retryBtn').onclick = () => {
    for (const item of queue.items) if (item.state === 'failed') Object.assign(item, { state: 'waiting', error: '' });
    queue.paused = false;
    save();
    pump();
  };
  $('clearBtn').onclick = () => {
    queue.items = queue.items.filter((i) => !['done', 'skipped', 'failed'].includes(i.state));
    save();
    render();
  };
  $('clearAllBtn').onclick = () => {
    if (!confirm('Remove every job from the queue? Resumes already made stay saved.')) return;
    queue.items = [];
    save();
    render();
  };

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.queueInbox?.newValue?.length) takeInbox();
  });
  window.addEventListener('beforeunload', (e) => {
    if (workers.size) e.preventDefault(); // ask before closing mid-run
  });

  const { saveDir = '' } = await chrome.storage.local.get('saveDir');
  if (!saveDir) message('Set a save folder in Settings, or the resumes will not be saved to your folder.', 'bad');
  render();
  await takeInbox();
  if (queue.paused && count('waiting')) message(`${count('waiting')} jobs waiting. Click Start or Continue.`);
  pump();
}

init();
