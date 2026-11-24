const DEFAULT_SETTINGS = { apiKey: '', gl: 'us', hl: 'en' };
// AI API keys from earlier versions; tailoring now goes through Claude Code instead.
const OBSOLETE_KEYS = ['geminiKey', 'geminiModel', 'claudeKey', 'claudeModel'];
const $ = (id) => document.getElementById(id);

async function load() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  // The resume lives in local storage: sync storage caps each item at 8 KB.
  const { resume = '', saveDir = '', autoSave = true, experienceYears = '' } = await chrome.storage.local.get(['resume', 'saveDir', 'autoSave', 'experienceYears']);
  $('experienceYears').value = experienceYears;
  $('saveDir').value = saveDir;
  $('autoSave').checked = autoSave;
  $('apiKey').value = settings.apiKey;
  $('gl').value = settings.gl;
  $('hl').value = settings.hl;
  $('resume').value = resume;
}

$('form').addEventListener('submit', async (event) => {
  event.preventDefault();
  await chrome.storage.sync.set({
    apiKey: $('apiKey').value.trim(),
    gl: $('gl').value.trim().toLowerCase() || DEFAULT_SETTINGS.gl,
    hl: $('hl').value.trim().toLowerCase() || DEFAULT_SETTINGS.hl,
  });
  await chrome.storage.sync.remove(OBSOLETE_KEYS);
  await chrome.storage.local.set({
    resume: $('resume').value.trim(),
    saveDir: $('saveDir').value.trim(),
    autoSave: $('autoSave').checked,
    experienceYears: $('experienceYears').value.trim().replace(/\s*years?$/i, ''),
  });
  $('status').textContent = 'Saved ✓';
  setTimeout(() => ($('status').textContent = ''), 2000);
});

$('show').addEventListener('change', (e) => {
  $('apiKey').type = e.target.checked ? 'text' : 'password';
});

$('loadFile').addEventListener('click', (e) => {
  e.preventDefault();
  $('resumeFile').click();
});

$('resumeFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) $('resume').value = await file.text();
  e.target.value = '';
});

// Asks the Claude Code helper to create the folder and write a test file there.
$('testDirBtn').addEventListener('click', async () => {
  const status = $('dirStatus');
  const dir = $('saveDir').value.trim();
  status.className = 'dir-status';
  status.textContent = 'Checking…';
  try {
    const { res } = await callBridge({ type: 'checkDir', dir });
    if (res?.error) throw new Error(res.error);
    status.className = 'dir-status ok';
    await chrome.storage.local.set({ saveDir: res.path });
    status.textContent = `✓ Saved as your save folder: ${res.path}`;
  } catch (err) {
    status.className = 'dir-status bad';
    status.textContent = err instanceof ConnectionError
      ? `The Claude Code helper isn't reachable. Run once in VS Code's terminal, then restart the browser: ${setupCommand()}`
      : err.message;
  }
});

load();
