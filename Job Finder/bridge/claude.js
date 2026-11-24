// Shared by server.js (HTTP bridge) and native-host.js (Chrome native messaging):
// finds Claude Code and runs one prompt through it.
//
// Claude Code runs with every tool disabled (--tools ""): it can only write text, never read
// or change files or run commands. It runs in a scratch folder, not in your project.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const TIMEOUT_MS = 5 * 60 * 1000;
const MAX_PROMPT_CHARS = 200_000;
const WORK_DIR = path.join(os.tmpdir(), 'job-finder-bridge');

function findClaude() {
  if (process.env.CLAUDE_PATH) return process.env.CLAUDE_PATH;

  // 1. `claude` on PATH (standalone install). Run `where` from a neutral folder: on Windows it
  //    also searches the current folder and counts .js as runnable, so from bridge/ it would
  //    "find" this very file. Only a real .exe can be spawned directly.
  try {
    const isWin = process.platform === 'win32';
    const found = execFileSync(isWin ? 'where' : 'which', ['claude'], {
      encoding: 'utf8',
      cwd: os.tmpdir(),
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && (!isWin || line.toLowerCase().endsWith('.exe')));
    if (found) return found;
  } catch {
    // not on PATH
  }

  // 2. The binary bundled with the VS Code extension (newest version wins).
  const extDir = path.join(os.homedir(), '.vscode', 'extensions');
  const exe = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const candidates = (fs.existsSync(extDir) ? fs.readdirSync(extDir) : [])
    .filter((d) => d.startsWith('anthropic.claude-code-'))
    .map((d) => path.join(extDir, d, 'resources', 'native-binary', exe))
    .filter((p) => fs.existsSync(p))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return candidates[0] || null;
}

function runClaude(claudePath, prompt) {
  return new Promise((resolve, reject) => {
    if (!claudePath) return reject(new Error('Claude Code was not found. Set CLAUDE_PATH and try again.'));
    if (typeof prompt !== 'string' || !prompt.trim()) return reject(new Error('Missing prompt.'));
    if (prompt.length > MAX_PROMPT_CHARS) return reject(new Error('Prompt too long.'));

    fs.mkdirSync(WORK_DIR, { recursive: true });
    const args = ['-p', '--output-format', 'json', '--tools', '', '--no-session-persistence', '--strict-mcp-config'];
    if (process.env.CLAUDE_MODEL) args.push('--model', process.env.CLAUDE_MODEL);

    const child = spawn(claudePath, args, { cwd: WORK_DIR, windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Claude Code took longer than 5 minutes.'));
    }, TIMEOUT_MS);

    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      let result;
      try {
        result = JSON.parse(out);
      } catch {
        return reject(new Error(err.trim() || out.trim() || `Claude Code exited with code ${code}.`));
      }
      if (result.is_error) return reject(new Error(result.result || 'Claude Code reported an error.'));
      resolve({ text: result.result || '', durationMs: result.duration_ms });
    });
    child.stdin.end(prompt);
  });
}

module.exports = { findClaude, runClaude, MAX_PROMPT_CHARS };
