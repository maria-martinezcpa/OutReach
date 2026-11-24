// One-time setup for Chrome native messaging (Windows): registers bridge/native-host.js so the
// extension can run Claude Code without the HTTP bridge, and without being affected by proxies.
//
//   node bridge/install-native-host.js                 finds the extension ID automatically
//   node bridge/install-native-host.js <extension-id>  or give it (see chrome://extensions)
//   node bridge/install-native-host.js --uninstall
//
// It writes two files next to this script and adds per-user registry keys (HKCU) that point
// Chrome, Chromium-based browsers (e.g. ixBrowser) and Edge at them. No admin rights needed.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HOST_NAME = 'com.jobfinder.claude';
const PROJECT_DIR = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(__dirname, `${HOST_NAME}.json`);
const LAUNCHER_PATH = path.join(__dirname, 'native-host.bat');
const REGISTRY_KEYS = [
  `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`,
  `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${HOST_NAME}`, // Chromium builds such as ixBrowser
  `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HOST_NAME}`,
];

if (process.platform !== 'win32') {
  console.error('This installer is for Windows. On macOS/Linux, put the host manifest in the browser\'s NativeMessagingHosts folder.');
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes('--uninstall')) {
  for (const key of REGISTRY_KEYS) {
    try {
      execFileSync('reg', ['delete', key, '/f'], { stdio: 'ignore' });
      console.log(`Removed ${key}`);
    } catch {
      // wasn't registered
    }
  }
  for (const file of [MANIFEST_PATH, LAUNCHER_PATH]) fs.rmSync(file, { force: true });
  console.log('Native messaging host removed.');
  process.exit(0);
}

const ids = new Set(args.filter((a) => /^[a-p]{32}$/.test(a)));
for (const bad of args.filter((a) => !/^[a-p]{32}$/.test(a))) console.warn(`Ignoring "${bad}": not an extension ID.`);
if (!ids.size) for (const id of findExtensionIds()) ids.add(id);
if (!ids.size) {
  console.error('Could not find the Job Finder extension in any browser profile.');
  console.error('Open chrome://extensions, copy the extension ID, and run:');
  console.error('  node bridge/install-native-host.js <extension-id>');
  process.exit(1);
}

// Chrome starts the host with a minimal environment, so use node's absolute path.
fs.writeFileSync(LAUNCHER_PATH, `@echo off\r\n"${process.execPath}" "%~dp0native-host.js" %*\r\n`);
fs.writeFileSync(MANIFEST_PATH, JSON.stringify({
  name: HOST_NAME,
  description: 'Job Finder: tailor resumes with Claude Code',
  path: LAUNCHER_PATH,
  type: 'stdio',
  allowed_origins: [...ids].map((id) => `chrome-extension://${id}/`),
}, null, 2) + '\n');

for (const key of REGISTRY_KEYS) {
  execFileSync('reg', ['add', key, '/ve', '/t', 'REG_SZ', '/d', MANIFEST_PATH, '/f'], { stdio: 'ignore' });
}

console.log('Native messaging host installed.');
console.log(`  Allowed extension ID(s): ${[...ids].join(', ')}`);
console.log(`  Host manifest: ${MANIFEST_PATH}`);
console.log('Restart the browser, then click "Generate with Claude Code". The HTTP bridge is no longer needed.');

// ---------- Finding the extension ----------

// Looks through browser profiles for an unpacked extension loaded from this project folder.
function findExtensionIds() {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const roaming = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const roots = [
    path.join(local, 'Google', 'Chrome', 'User Data'),
    path.join(local, 'Chromium', 'User Data'),
    path.join(local, 'Microsoft', 'Edge', 'User Data'),
    path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data'),
    path.join(roaming, 'ixBrowser', 'Browser Data'),
  ];
  const found = new Set();
  for (const root of roots) {
    for (const file of findPreferenceFiles(root, 3)) {
      try {
        const settings = JSON.parse(fs.readFileSync(file, 'utf8')).extensions?.settings || {};
        for (const [id, ext] of Object.entries(settings)) {
          if (ext.path && path.resolve(ext.path).toLowerCase() === PROJECT_DIR.toLowerCase()) {
            found.add(id);
            console.log(`Found the extension (${id}) in ${path.dirname(file)}`);
          }
        }
      } catch {
        // unreadable or locked profile file
      }
    }
  }
  return found;
}

function findPreferenceFiles(dir, depth) {
  if (depth < 0 || !fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && (entry.name === 'Preferences' || entry.name === 'Secure Preferences')) out.push(full);
    else if (entry.isDirectory() && !/cache|crashpad|extensions|indexeddb|storage/i.test(entry.name)) out.push(...findPreferenceFiles(full, depth - 1));
  }
  return out;
}
