// Talks to the helper on this PC (bridge/handlers.js). Two routes, tried in order:
// 1. Native messaging (bridge/native-host.js): the browser starts the helper itself. No network,
//    so browser proxies (e.g. ixBrowser profiles) don't matter. One-time setup.
// 2. The HTTP bridge (bridge/server.js) on 127.0.0.1, which must be running.
// Used by tailor.js and options.js.

const NATIVE_HOST = 'com.jobfinder.claude';
const BRIDGE_URL = 'http://127.0.0.1:47823';

class ConnectionError extends Error {}

// Resolves to { via: 'native' | 'http', res }, where res may carry { error } from the helper.
// Throws ConnectionError when neither route is reachable.
async function callBridge(message) {
  try {
    return { via: 'native', res: await chrome.runtime.sendNativeMessage(NATIVE_HOST, message) };
  } catch (nativeErr) {
    console.warn('Native messaging unavailable:', nativeErr.message);
    try {
      const r = await fetch(`${BRIDGE_URL}/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      });
      const data = await r.json().catch(() => ({}));
      return { via: 'http', res: r.ok ? data : { error: data.error || `Bridge error (HTTP ${r.status}).` } };
    } catch {
      // fetch() throws when nothing is listening (or a proxy refuses the connection).
      throw new ConnectionError(nativeErr.message);
    }
  }
}

// The one-time setup command, with this extension's own ID filled in.
function setupCommand() {
  return `node bridge/install-native-host.js ${chrome.runtime.id}`;
}

// Same posting seen again (even from another job board): same company, title and location.
// Must match jobKey() in bridge/save.js.
function jobKey(job) {
  const clean = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return [job.company, job.title, job.location].map(clean).join('|');
}

// The numbered list of saved jobs lives in jobs.json in your save folder. A copy is kept in
// the extension (savedJobs) so the popup can still skip saved jobs when the helper is offline.
async function refreshSavedJobs() {
  const { saveDir = '' } = await chrome.storage.local.get('saveDir');
  if (!saveDir) return null;
  try {
    const { res } = await callBridge({ type: 'listJobs', dir: saveDir });
    if (res?.error) throw new Error(res.error);
    const savedJobs = { total: res.total, ready: res.ready, notReady: res.notReady, jobs: res.jobs };
    await chrome.storage.local.set({ savedJobs });
    return savedJobs;
  } catch (err) {
    console.warn('Could not read the saved job list:', err.message);
    return null;
  }
}

// Adds jobs to the "Tailor all" queue and opens it. The queue page (queue.js) picks them up
// from queueInbox. force: regenerate even if the job already has a resume.
async function addToQueue(jobs, { force = false } = {}) {
  if (!jobs.length) return;
  const { queueInbox = [] } = await chrome.storage.local.get('queueInbox');
  const data = { queueInbox: [...queueInbox, ...jobs.map((j) => ({ id: j.id, title: j.title, company: j.company, force }))] };
  for (const j of jobs) data[`job:${j.id}`] = j;
  await chrome.storage.local.set(data);
  await chrome.tabs.create({ url: 'queue.html' });
}
