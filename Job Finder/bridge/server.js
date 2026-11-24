// Job Finder bridge: lets the Chrome extension use Claude Code (the CLI that ships with the
// VS Code extension) for resume tailoring. It uses your existing Claude Code login; no API key.
//
// Run:  node bridge/server.js     (or the "Job Finder bridge" task in VS Code)
//
// Safety: listens on 127.0.0.1 only, and only answers requests from Chrome extensions.
// Claude Code itself runs without tools (see claude.js).
//
// Prefer native messaging (native-host.js) where it is set up: it needs no running server
// and is not affected by browser proxies. This HTTP bridge is the fallback.
const http = require('http');
const { findClaude, runClaude, MAX_PROMPT_CHARS } = require('./claude');
const { handle } = require('./handlers');

const PORT = Number(process.env.JOB_FINDER_PORT) || 47823;
const MAX_PARALLEL = Number(process.env.JOB_FINDER_PARALLEL) || 3;

const claudePath = findClaude();
let running = 0;
const queue = [];

// Runs at most MAX_PARALLEL Claude Code processes; the rest wait their turn.
function enqueue(prompt) {
  if (!claudePath) return Promise.reject(new Error('Claude Code was not found. Set CLAUDE_PATH and restart the bridge.'));
  return new Promise((resolve, reject) => {
    queue.push({ prompt, resolve, reject });
    pump();
  });
}

function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    const job = queue.shift();
    running++;
    runClaude(claudePath, job.prompt)
      .then(job.resolve, job.reject)
      .finally(() => {
        running--;
        pump();
      });
  }
}

// ---------- HTTP ----------

function send(res, status, body, origin) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...(origin && { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }),
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > MAX_PROMPT_CHARS * 2) {
        reject(new Error('Request too large.'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  // Opening the bridge address in a browser tab: just confirm it's running (no data exposed).
  if (req.method === 'GET' && req.url === '/' && !origin) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Job Finder bridge is running. Keep this running while you tailor resumes in the extension.');
  }
  // Web pages can't fake their Origin, so this keeps websites from using your Claude account.
  if (!origin.startsWith('chrome-extension://')) return send(res, 403, { error: 'Only the Job Finder extension may use this bridge.' });

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // One endpoint for every request type (see handlers.js), same as the native helper.
  if (req.method === 'POST' && req.url === '/rpc') {
    let msg;
    try {
      msg = JSON.parse(await readBody(req));
    } catch (e) {
      return send(res, 400, { error: e.message }, origin);
    }
    const started = Date.now();
    if (msg.type === 'tailor') console.log(`[${new Date().toLocaleTimeString()}] tailoring request (${running} running, ${queue.length} queued)`);
    try {
      const result = await handle(msg, { run: (_path, prompt) => enqueue(prompt) });
      if (msg.type === 'tailor') console.log(`[${new Date().toLocaleTimeString()}] done in ${Math.round((Date.now() - started) / 1000)}s`);
      if (msg.type === 'save') console.log(`[${new Date().toLocaleTimeString()}] saved to ${result.path}`);
      return send(res, 200, result, origin);
    } catch (e) {
      console.error(`${msg.type} failed:`, e.message);
      return send(res, 500, { error: e.message }, origin);
    }
  }

  send(res, 404, { error: 'Not found.' }, origin);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`Job Finder bridge is already running on port ${PORT}.`);
    process.exit(0);
  }
  throw e;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Job Finder bridge listening on http://127.0.0.1:${PORT}`);
  console.log(claudePath ? `Using Claude Code: ${claudePath}` : 'WARNING: Claude Code not found. Set CLAUDE_PATH.');
  console.log(`Up to ${MAX_PARALLEL} resumes are tailored in parallel. Leave this terminal open.`);
});
