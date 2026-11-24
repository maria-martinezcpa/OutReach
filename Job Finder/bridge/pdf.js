// Turns a saved resume .html into a .pdf next to it, using Chrome or Edge in headless mode
// (no print dialog, so it works even where the browser's "Save as PDF" is unavailable).
// Override the browser with the CHROME_PATH environment variable.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

function findBrowser() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const candidates = process.platform === 'win32'
    ? [
        path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ]
    : ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

// Returns the PDF's path. Throws with a readable message on failure.
function htmlToPdf(htmlPath) {
  const browser = findBrowser();
  if (!browser) throw new Error('No Chrome or Edge found to make the PDF. Install Chrome, or set CHROME_PATH.');
  const pdfPath = htmlPath.replace(/\.html$/i, '.pdf');
  // A throwaway profile, so this never touches (or waits on) a browser you have open.
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'job-finder-pdf-'));
  try {
    const result = spawnSync(browser, [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--no-pdf-header-footer',
      `--user-data-dir=${profile}`,
      `--print-to-pdf=${pdfPath}`,
      pathToFileURL(htmlPath).href,
    ], { timeout: 60_000, windowsHide: true, encoding: 'utf8' });
    if (result.error) throw new Error(`Could not run ${path.basename(browser)}: ${result.error.message}`);
    if (!fs.existsSync(pdfPath)) throw new Error(`The PDF was not created. ${(result.stderr || '').trim().split('\n').pop() || ''}`.trim());
    return pdfPath;
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

module.exports = { htmlToPdf, findBrowser };
