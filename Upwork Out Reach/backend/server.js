import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

// Packaged as a single executable (npm run build)? Then the app files are embedded assets
// and settings come from a .env next to the .exe.
const sea = process.getBuiltinModule("node:sea");
const IS_APP = sea?.isSea?.() ?? false;
const APP_ENV = path.join(path.dirname(process.execPath), ".env");
if (IS_APP && fs.existsSync(APP_ENV)) process.loadEnvFile(APP_ENV);

const PORT = Number(process.env.PORT) || 8787;
const ALLOWED_EXTENSION_ID = process.env.ALLOWED_EXTENSION_ID || "";
// ---------- contact store (synced from the extension, used by the Contacts app) ----------
// One data folder for both `npm start` and the packaged app, so they see the same contacts.
const DATA_DIR =
  process.env.DATA_DIR ||
  (process.platform === "win32"
    ? path.join(process.env.APPDATA || os.homedir(), "Upwork Outreach")
    : path.join(os.homedir(), ".upwork-outreach"));
const APP_DIR = path.join(import.meta.dirname, "app");
const APP_FILES = ["index.html", "app.css", "app.js"]; // embedded in the packaged app
// Contacts synced before the data folder moved out of backend/data.
const OLD_DATA_DIR = path.join(import.meta.dirname, "data");
if (!IS_APP && !fs.existsSync(DATA_DIR) && fs.existsSync(OLD_DATA_DIR)) fs.cpSync(OLD_DATA_DIR, DATA_DIR, { recursive: true });
const CONTACTS_FILE = path.join(DATA_DIR, "contacts.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const BACKGROUND = process.argv.includes("--background"); // started with Windows: no window, no balloon

// The packaged app has no console, so everything it would print goes to app.log, including why it stopped.
const LOG_FILE = path.join(DATA_DIR, "app.log");
function logToFile(...parts) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 1_000_000) fs.renameSync(LOG_FILE, LOG_FILE + ".old");
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${parts.map((p) => p?.stack || String(p)).join(" ")}\n`);
  } catch {}
}
// Run inside the desktop app (desktop/main.cjs): it owns the window and tray icon; we only log to app.log.
const EMBEDDED = process.env.OUTREACH_EMBEDDED === "1";
if (EMBEDDED) console.log = console.error = logToFile;
if (IS_APP) {
  console.log = console.error = logToFile;
  process.on("uncaughtException", (err) => {
    logToFile("CRASH", err);
    process.exit(1);
  });
  // A failed request must not take sync down with it.
  process.on("unhandledRejection", (err) => logToFile("Unhandled rejection", err));
  process.on("exit", (code) => logToFile("Stopped, exit code", code));
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"])
    process.on(signal, () => {
      logToFile("Received", signal);
      process.exit(0);
    });
}
// The email is this template, word for word; only the {placeholders} are filled in.
const DEFAULT_SETTINGS = {
  sender: "",
  subjectTemplate: "Working together on more projects?",
  bodyTemplate: `Hi {first_name},

I came across your profile and wanted to reach out.

I'd like to talk about whether we could work together as a team. Combining our strengths could give us both better chances at winning good projects and clients. I don't have anything specific in mind yet. I'd just like to compare notes and see if there's a good fit.

Would you be open to a short chat sometime soon?

Best,
{sender}`,
  // Optional GitHub token for GitHub lookups: 5,000 requests an hour instead of 60.
  githubToken: "",
};
const getSettings = () => ({ ...DEFAULT_SETTINGS, ...readFile(SETTINGS_FILE, {}) });

const readFile = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};
const writeFile = (file, data) => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file + ".tmp", JSON.stringify(data, null, 2));
  fs.renameSync(file + ".tmp", file);
};
// { contacts: {id: contact}, deleted: [id] } — deleted ids stop a later sync from bringing them back.
const loadStore = () => ({ contacts: {}, deleted: [], ...readFile(CONTACTS_FILE, {}) });

function upsertContacts(list) {
  const store = loadStore();
  let added = 0;
  let updated = 0;
  for (const c of list) {
    if (!c?.id || typeof c.id !== "string" || store.deleted.includes(c.id)) continue;
    const old = store.contacts[c.id];
    // Newest edit wins, so a stale copy never overwrites changes made in the app.
    if (old && String(old.updatedAt || "") >= String(c.updatedAt || "")) continue;
    store.contacts[c.id] = c;
    old ? updated++ : added++;
  }
  if (added || updated) writeFile(CONTACTS_FILE, store); // the extension syncs every 30 s, usually with no changes
  return { added, updated, total: Object.keys(store.contacts).length, deleted: store.deleted };
}

const sortedContacts = () =>
  Object.values(loadStore().contacts).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

// Last sync from the extension, shown in the Contacts app.
let extensionSync = null;

// ---------- HTTP helpers ----------
const LOCAL_HOST = /^(localhost|127\.0\.0\.1)(:\d+)?$/;
const isAppOrigin = (origin) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) && origin.endsWith(":" + PORT);

function cors(req, res) {
  const origin = req.headers.origin || "";
  const ext = ALLOWED_EXTENSION_ID
    ? origin === `chrome-extension://${ALLOWED_EXTENSION_ID}`
    : origin.startsWith("chrome-extension://");
  if (ext) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  // The Contacts app is served from this server, so its requests are same-origin
  // (no Origin header on GETs). Anything else — other websites — is refused.
  return ext || !origin || isAppOrigin(origin);
}

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
function serveStatic(req, res) {
  const rel = req.url.split("?")[0] === "/" ? "index.html" : req.url.split("?")[0].slice(1);
  if (IS_APP) {
    if (!APP_FILES.includes(rel)) return false;
    res.writeHead(200, { "Content-Type": MIME[path.extname(rel)], "Cache-Control": "no-cache" });
    res.end(sea.getAsset(rel, "utf8"));
    return true;
  }
  const file = path.join(APP_DIR, path.normalize(rel));
  if (!file.startsWith(APP_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
  fs.createReadStream(file).pipe(res);
  return true;
}

async function readJson(req, limit = 200_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Request too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

// Fills the saved template: {first_name} {name} {title} {sender}. Unknown placeholders stay as typed.
function draft(input) {
  const s = getSettings();
  const name = String(input.profile?.name || "").trim();
  const values = {
    name,
    first_name: name.split(/\s+/)[0] || "there",
    title: String(input.profile?.title || "").trim(),
    sender: String(input.sender || s.sender || "").trim(),
  };
  const fill = (t) => String(t).replace(/\{(\w+)\}/g, (m, k) => (k in values ? values[k] : m));
  return { subject: fill(s.subjectTemplate).trim(), body: fill(s.bodyTemplate).trimEnd() };
}

// ---------- GitHub lookup ----------
// The extension's own lookup code (extension/insights.js), so a GitHub link pasted in the app is
// researched exactly like a GitHub account found on an Upwork profile.
vm.runInThisContext(
  IS_APP ? sea.getAsset("insights.js", "utf8") : fs.readFileSync(path.join(import.meta.dirname, "..", "extension", "insights.js"), "utf8"),
  { filename: "insights.js" }
);
const httpError = (status, message) => Object.assign(new Error(message), { status });
// Big platforms aren't personal pages (and mostly block fetching). Same list as the extension.
const SKIP_SITES =
  /(^https?:\/\/)?([^/]+\.)?(github\.com|stackoverflow\.com|stackexchange\.com|linkedin\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|youtu\.be|google\.[a-z.]+|apple\.com|microsoft\.com|play\.google\.com|apps\.apple\.com|medium\.com|behance\.net|dribbble\.com|upwork\.com|vimeo\.com|tiktok\.com|wa\.me|t\.me)(\/|$)/i;
const siteHost = (u) => {
  try {
    return new URL(/^https?:/i.test(u) ? u : "https://" + u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

// Mirrors enrichAccounts() in extension/background.js for the GitHub part.
async function lookupGithub(input) {
  const { githubInsights, githubLoginFromUrl, websiteContacts, extractContacts } = globalThis;
  const raw = String(input || "").trim();
  const login = githubLoginFromUrl(raw) || (/^@?[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(raw) ? raw.replace(/^@/, "") : null);
  if (!login) throw httpError(400, "That isn't a GitHub profile link (e.g. https://github.com/username).");

  let gh;
  try {
    gh = await githubInsights(login, getSettings().githubToken);
  } catch (e) {
    if (/ 404 /.test(e.message)) throw httpError(404, `There's no GitHub user called "${login}".`);
    if (/ 401 /.test(e.message)) throw httpError(401, "GitHub rejected the token in Settings. Check or remove it.");
    throw httpError(502, e.message);
  }

  const contacts = [];
  const add = (c) => {
    if (!c.value) return;
    const prev = contacts.find((x) => x.type === c.type && x.value.toLowerCase() === c.value.toLowerCase());
    if (!prev) contacts.push({ confidence: "likely", ...c });
    else if (prev.confidence === "check" && c.confidence !== "check") Object.assign(prev, c); // keep the stronger source
  };
  gh.profileEmails.forEach((e) => add({ type: "email", ...e }));
  gh.commitEmails.forEach((e) => add({ type: "email", value: e.value, source: e.source, sourceUrl: e.sourceUrl }));
  // Telegram / phone written in their bio, profile README or commit messages.
  for (const t of gh.profileTexts) {
    const found = extractContacts(t.text);
    const conf = t.confidence ? { confidence: t.confidence } : {};
    found.telegrams.forEach((v) => add({ type: "telegram", value: v, source: t.source, sourceUrl: t.sourceUrl, ...conf }));
    found.phones.forEach((p) => add({ type: p.kind, value: p.value, source: t.source, sourceUrl: t.sourceUrl, ...conf }));
  }
  if (gh.blog) add({ type: "website", value: gh.blog, source: "Website on GitHub profile", sourceUrl: gh.url });
  if (gh.twitter) add({ type: "x", value: "@" + gh.twitter, source: "X/Twitter on GitHub profile", sourceUrl: gh.url });
  for (const s of gh.socialAccounts) {
    const tg = /(?:^|\/\/)(?:www\.)?(?:t\.me|telegram\.me)\/([A-Za-z0-9_]{5,32})/i.exec(s.url);
    const x = /(?:^|\/\/)(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i.exec(s.url);
    const src = { source: `${s.provider && s.provider !== "generic" ? s.provider[0].toUpperCase() + s.provider.slice(1) : "Link"} on GitHub profile`, sourceUrl: gh.url };
    if (tg) add({ type: "telegram", value: "@" + tg[1], ...src });
    else if (x) add({ type: "x", value: "@" + x[1], ...src });
    else add({ type: "website", value: s.url, ...src });
  }

  // Their own website first, then pages linked from the profile README: searched for email / Telegram / phone.
  const seen = new Set();
  const sites = [
    ...(gh.blog ? [{ url: gh.blog, label: "Their website", trusted: true }] : []),
    ...gh.socialAccounts.filter((s) => s.provider === "generic").map((s) => ({ url: s.url, label: "Their website", trusted: true })),
    ...gh.readmeLinks.map((u) => ({ url: u, label: "Linked from GitHub README", trusted: false })),
  ].filter((s) => {
    const host = siteHost(s.url);
    return host && !SKIP_SITES.test(s.url) && !seen.has(host) && seen.add(host);
  });
  const names = [...new Set([...String(gh.name || "").split(/[\s.]+/), gh.login].filter((n) => n && n.length >= 3))];
  const results = await Promise.all(
    sites.slice(0, 9).map((s) => websiteContacts(s.url, { names, sourceLabel: s.label, trusted: s.trusted }).catch(() => ({ contacts: [] })))
  );
  results.forEach((r) => r.contacts.forEach(add));

  const { profileTexts, profileEmails, commitEmails, ...github } = gh;
  return { github, contacts, sitesChecked: sites.slice(0, 9).map((s) => siteHost(s.url)) };
}

// ---------- Find missing emails (bulk) ----------
// For every contact without an email: run the GitHub lookup on their GitHub account, or, when they
// have none, find their account by name (accepted only when exactly one GitHub user matches).
// Found details are saved as they come in; ones from a name match are marked "check".
let emailJob = null;
const RECHECK_DAYS = 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hasEmailMethod = (c) => (c.methods || []).some((m) => m.type === "email" || m.type === "outlook");
const recentlyChecked = (c) => c.emailLookup?.at && Date.now() - new Date(c.emailLookup.at) < RECHECK_DAYS * 86_400_000;
const missingEmail = () => Object.values(loadStore().contacts).filter((c) => !hasEmailMethod(c));

function githubHeaders() {
  const h = { Accept: "application/vnd.github+json", "User-Agent": "upwork-outreach" };
  const token = getSettings().githubToken;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}
// When GitHub's hourly (or per-minute search) limit runs out: the time it resets.
async function githubResetAt(kind = "core") {
  try {
    const r = await (await fetch("https://api.github.com/rate_limit", { headers: githubHeaders() })).json();
    const l = r.resources?.[kind];
    return l && l.remaining === 0 ? l.reset * 1000 : 0;
  } catch {
    return 0;
  }
}
async function waitForGithub(kind) {
  const until = (await githubResetAt(kind)) || Date.now() + 60_000;
  emailJob.waitingUntil = new Date(until + 2000).toISOString();
  while (Date.now() < until + 2000 && !emailJob.stop) await sleep(1000);
  emailJob.waitingUntil = null;
}

async function findGithubByName(c) {
  const name = String(c.name || "").replace(/[^\p{L}\s.'-]/gu, " ").replace(/\s+/g, " ").trim();
  if (name.split(" ").filter((w) => w.length > 1).length < 2 || /unknown/i.test(name)) return null;
  const loc = String(c.upwork?.location || "").split(",").pop().trim();
  const tries = [...(loc ? [`fullname:"${name}" location:"${loc}" type:user`] : []), `fullname:"${name}" type:user`];
  for (const q of tries) {
    for (let attempt = 0; attempt < 3 && !emailJob.stop; attempt++) {
      const r = await fetch(`https://api.github.com/search/users?q=${encodeURIComponent(q)}&per_page=3`, { headers: githubHeaders() }).catch(() => null);
      if (r && (r.status === 403 || r.status === 429)) {
        await waitForGithub("search");
        continue;
      }
      const items = r?.ok ? (await r.json()).items || [] : [];
      if (items.length === 1) return { url: items[0].html_url, how: q.includes("location:") ? "name + location" : "name" };
      if (items.length > 1 && q.includes("location:")) return null; // several people even with location: don't guess
      break;
    }
  }
  return null;
}

function saveLookupResult(id, { url, foundBy, result }) {
  const store = loadStore();
  const c = store.contacts[id];
  if (!c) return 0;
  const now = new Date().toISOString();
  c.methods = c.methods || [];
  c.accounts = c.accounts || [];
  let added = 0;
  for (const x of result?.contacts || []) {
    if (c.methods.some((m) => String(m.value).toLowerCase() === x.value.toLowerCase())) continue;
    c.methods.push({
      type: x.type, value: x.value, sourceUrl: x.sourceUrl || "", verified: false, addedAt: now,
      source: foundBy ? `${x.source} — GitHub account found by ${foundBy} search` : x.source,
      confidence: foundBy ? "check" : x.confidence,
    });
    added++;
  }
  const g = result?.github;
  if (g) {
    const fields = { bio: g.bio, topLanguages: g.topLanguages, projects: g.projects, activity: g.activity, lastVerified: now };
    const i = c.accounts.findIndex((a) => a.type === "github");
    if (i >= 0) c.accounts[i] = { ...c.accounts[i], ...fields };
    else c.accounts.push({ type: "github", url: g.url || url, source: `Found by ${foundBy} search`, confidence: "check", verified: false, ...fields });
  }
  c.emailLookup = { at: now, emails: (result?.contacts || []).filter((x) => x.type === "email").length, foundBy: foundBy || null };
  c.updatedAt = now;
  writeFile(CONTACTS_FILE, store);
  return added;
}

async function runEmailJob({ recheck = false } = {}) {
  const todo = missingEmail().filter((c) => recheck || !recentlyChecked(c));
  emailJob = { running: true, stop: false, total: todo.length, done: 0, withEmail: 0, details: 0, byName: 0, noGithub: 0, current: "", waitingUntil: null, startedAt: new Date().toISOString(), finishedAt: null, error: "" };
  console.log(`Find emails: started, ${todo.length} contacts`);
  try {
    for (const c of todo) {
      if (emailJob.stop) break;
      emailJob.current = c.name || "";
      let url = (c.accounts || []).find((a) => a.type === "github" && a.url)?.url;
      let foundBy = null;
      if (!url) {
        const hit = await findGithubByName(c);
        if (hit) (url = hit.url), (foundBy = hit.how), emailJob.byName++;
      }
      let result = null;
      if (url) {
        for (let attempt = 0; attempt < 4 && !emailJob.stop; attempt++) {
          try {
            result = await lookupGithub(url);
            break;
          } catch (e) {
            if (/rate limit/i.test(e.message)) await waitForGithub("core");
            else break; // deleted account etc.
          }
        }
      } else emailJob.noGithub++;
      if (emailJob.stop) break;
      emailJob.details += saveLookupResult(c.id, { url, foundBy, result });
      if (result?.contacts.some((x) => x.type === "email")) emailJob.withEmail++;
      emailJob.done++;
    }
  } catch (e) {
    emailJob.error = e.message;
    console.error("Find emails failed:", e);
  }
  Object.assign(emailJob, { running: false, current: "", waitingUntil: null, finishedAt: new Date().toISOString() });
  console.log(`Find emails: ${emailJob.stop ? "stopped" : "finished"}, ${emailJob.done} checked, ${emailJob.withEmail} with email`);
}

function emailJobStatus() {
  const missing = missingEmail();
  const { stop, ...job } = emailJob || {};
  return {
    job: emailJob ? { ...job, stopped: !!stop } : null,
    missing: missing.length,
    withGithub: missing.filter((c) => (c.accounts || []).some((a) => a.type === "github")).length,
    checkedRecently: missing.filter(recentlyChecked).length,
    hasToken: !!getSettings().githubToken,
  };
}

const server = http.createServer(async (req, res) => {
  // Only answer to localhost names (blocks DNS-rebinding pages from reading contacts).
  if (!LOCAL_HOST.test(req.headers.host || "")) return send(res, 403, { error: "Host not allowed" });
  if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true });
  const allowed = cors(req, res);
  if (req.method === "OPTIONS") return res.writeHead(allowed ? 204 : 403).end();
  if (!allowed) return send(res, 403, { error: "Origin not allowed" });

  const url = req.url.split("?")[0];
  const contactId = /^\/api\/contacts\/([\w-]{1,80})$/.exec(url)?.[1];
  try {
    if (req.method === "POST" && url === "/draft") return send(res, 200, await draft(await readJson(req)));

    if (req.method === "GET" && url === "/api/contacts") return send(res, 200, sortedContacts());
    // Extension sync and JSON import: upsert by id, newest updatedAt wins.
    if (req.method === "POST" && url === "/api/contacts/sync") {
      const body = await readJson(req, 20_000_000);
      const list = Array.isArray(body) ? body : body.contacts;
      if (!Array.isArray(list)) throw new Error("Expected a list of contacts");
      const result = upsertContacts(list);
      if (String(req.headers.origin).startsWith("chrome-extension://")) {
        if (!extensionSync || result.added || result.updated)
          console.log(`Extension sync: sent ${list.length}, ${result.added} new, ${result.updated} updated, ${result.total} total`);
        extensionSync = { at: new Date().toISOString(), count: list.length };
      }
      return send(res, 200, result);
    }
    if (req.method === "GET" && url === "/api/status") return send(res, 200, { extensionSync });
    if (req.method === "PUT" && contactId) {
      const c = await readJson(req, 2_000_000);
      const store = loadStore();
      // Saved from a stale page after the extension deleted it: don't bring it back.
      if (store.deleted.includes(contactId)) return send(res, 410, { error: "This contact was deleted" });
      store.contacts[contactId] = { ...c, id: contactId, updatedAt: new Date().toISOString() };
      writeFile(CONTACTS_FILE, store);
      return send(res, 200, store.contacts[contactId]);
    }
    if (req.method === "DELETE" && contactId) {
      const store = loadStore();
      delete store.contacts[contactId];
      if (!store.deleted.includes(contactId)) store.deleted.push(contactId);
      writeFile(CONTACTS_FILE, store);
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && url === "/api/lookup/github") return send(res, 200, await lookupGithub((await readJson(req)).url));
    if (req.method === "GET" && url === "/api/find-emails") return send(res, 200, emailJobStatus());
    if (req.method === "POST" && url === "/api/find-emails") {
      const body = await readJson(req).catch(() => ({}));
      if (!emailJob?.running) runEmailJob({ recheck: !!body.recheck });
      return send(res, 200, emailJobStatus());
    }
    if (req.method === "POST" && url === "/api/find-emails/stop") {
      if (emailJob?.running) emailJob.stop = true;
      return send(res, 200, emailJobStatus());
    }

    if (req.method === "POST" && url === "/api/open-gmail") return send(res, 200, await openGmail((await readJson(req)).url));

    if (req.method === "GET" && url === "/api/settings") return send(res, 200, { ...getSettings(), defaults: DEFAULT_SETTINGS });
    if (req.method === "PUT" && url === "/api/settings") {
      const s = await readJson(req);
      const settings = Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((k) => [k, String(s[k] ?? "").slice(0, 5000)]));
      writeFile(SETTINGS_FILE, settings);
      return send(res, 200, settings);
    }

    if (req.method === "GET" && serveStatic(req, res)) return;
  } catch (err) {
    console.error(err);
    return send(res, err.status || 400, { error: err.message });
  }
  send(res, 404, { error: "Not found" });
});

// ---------- Google Chrome ----------
const CHROME = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA]
  .filter(Boolean)
  .map((d) => path.join(d, "Google", "Chrome", "Application", "chrome.exe"))
  .find((p) => fs.existsSync(p));
const CHROME_LOCAL_STATE = path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "User Data", "Local State");

// Lists visible Chrome windows topmost first as "minimized<TAB>taskbar id<TAB>title". Chrome gives
// each profile's windows their own taskbar id (Chrome.UserData.Profile29 = "Profile 29").
const LIST_CHROME_WINDOWS = String.raw`
Add-Type -TypeDefinition @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public static class ChromeWins {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr h, ref Guid iid, out IPropertyStore store);
  [StructLayout(LayoutKind.Sequential, Pack = 4)] struct PROPERTYKEY { public Guid fmtid; public uint pid; }
  [StructLayout(LayoutKind.Explicit)] struct PROPVARIANT { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public IntPtr p; [FieldOffset(16)] public IntPtr p2; }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore {
    int GetCount(out uint c); int GetAt(uint i, out PROPERTYKEY k);
    int GetValue(ref PROPERTYKEY k, out PROPVARIANT v); int SetValue(ref PROPERTYKEY k, ref PROPVARIANT v); int Commit();
  }
  static string AppId(IntPtr h) {
    try {
      Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"); IPropertyStore s;
      if (SHGetPropertyStoreForWindow(h, ref iid, out s) != 0) return "";
      PROPERTYKEY k = new PROPERTYKEY { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
      PROPVARIANT v; s.GetValue(ref k, out v); Marshal.ReleaseComObject(s);
      return v.vt == 31 ? Marshal.PtrToStringUni(v.p) : "";
    } catch { return ""; }
  }
  public static List<string> List() {
    var r = new List<string>();
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      var c = new StringBuilder(64); GetClassName(h, c, 64);
      if (c.ToString() != "Chrome_WidgetWin_1") return true;
      var t = new StringBuilder(512); GetWindowText(h, t, 512);
      if (t.Length == 0) return true;
      r.Add((IsIconic(h) ? 1 : 0) + "\t" + AppId(h) + "\t" + t);
      return true;
    }, IntPtr.Zero);
    return r;
  }
}
"@
[ChromeWins]::List()
`;

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited with ${code}`))));
  });
}

// Profile folder of the topmost normal Google Chrome window (not the app window, not other
// Chromium browsers). Prefers a window that isn't minimized.
async function topChromeProfile() {
  if (process.platform !== "win32") return null;
  const encoded = Buffer.from(LIST_CHROME_WINDOWS, "utf16le").toString("base64");
  const out = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded]);
  const wins = out
    .split(/\r?\n/)
    .map((l) => l.split("\t"))
    .map(([min, appId]) => ({ min: min === "1", id: /^Chrome(?:\.UserData(?:\.(\w+))?)?$/.exec(appId || "") }))
    .filter((w) => w.id);
  const top = wins.find((w) => !w.min) || wins[0];
  if (!top) return null;
  const sanitized = top.id[1];
  if (!sanitized) return { dir: "Default" };
  // The taskbar id drops spaces from the folder name: match it back against Chrome's profile list.
  const cache = readFile(CHROME_LOCAL_STATE, {}).profile?.info_cache || {};
  const dir = Object.keys(cache).find((k) => k.replace(/[^A-Za-z0-9.]/g, "") === sanitized) || sanitized;
  return { dir, name: cache[dir]?.name, email: cache[dir]?.user_name };
}

// Opens Gmail compose as a tab in the topmost Chrome window, signed in with that window's profile.
async function openGmail(url) {
  if (!/^https:\/\/mail\.google\.com\//.test(url || "")) throw new Error("Only Gmail links can be opened");
  if (!CHROME) throw new Error("Google Chrome not found");
  let profile = null;
  try {
    profile = await topChromeProfile();
  } catch (e) {
    console.error("Couldn't read Chrome windows:", e.message);
  }
  const args = profile ? [`--profile-directory=${profile.dir}`, url] : [url];
  launch(CHROME, args);
  return { ok: true, profile };
}

// Starts a program and lets it outlive us. A failed launch is logged, not fatal.
function launch(cmd, args) {
  const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", (err) => console.error(`Couldn't start ${cmd}:`, err));
  child.unref();
}

// Packaged app: show the Contacts page in its own Chrome app window.
function openWindow() {
  const url = `http://localhost:${PORT}/`;
  const [cmd, args] = CHROME
    ? [CHROME, [`--app=${url}`, "--window-size=1200,820"]]
    : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : [process.platform === "darwin" ? "open" : "xdg-open", [url]];
  launch(cmd, args);
}

// ---------- tray icon (packaged app on Windows) ----------
// A small hidden PowerShell process owns the icon and prints the menu choices for us to act on.
const TRAY_SCRIPT = String.raw`
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$parent = Get-Process -Id $env:OUTREACH_PID
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
function Say($m) { [Console]::Out.WriteLine($m); [Console]::Out.Flush() }

$bmp = New-Object Drawing.Bitmap 32, 32
$g = [Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'AntiAliasGridFit'
$g.FillEllipse((New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(61, 220, 132))), 0, 0, 31, 31)
$font = New-Object Drawing.Font 'Segoe UI', 15, ([Drawing.FontStyle]::Bold)
$g.DrawString('U', $font, [Drawing.Brushes]::Black, 5, 1)
$g.Dispose()

$tray = New-Object Windows.Forms.NotifyIcon
$tray.Icon = [Drawing.Icon]::FromHandle($bmp.GetHicon())
$tray.Text = 'Upwork Outreach is running'
$menu = New-Object Windows.Forms.ContextMenuStrip

$open = New-Object Windows.Forms.ToolStripMenuItem 'Open Contacts app'
$open.add_Click({ Say 'open' })
[void]$menu.Items.Add($open)

$auto = New-Object Windows.Forms.ToolStripMenuItem 'Start with Windows'
$auto.Checked = [bool](Get-ItemProperty $runKey -Name UpworkOutreach -ErrorAction SilentlyContinue)
$auto.add_Click({
  if ($auto.Checked) { Remove-ItemProperty $runKey -Name UpworkOutreach -ErrorAction SilentlyContinue }
  else { Set-ItemProperty $runKey -Name UpworkOutreach -Value ('"' + $env:OUTREACH_EXE + '" --background') }
  $auto.Checked = -not $auto.Checked
})
[void]$menu.Items.Add($auto)

[void]$menu.Items.Add((New-Object Windows.Forms.ToolStripSeparator))
$quit = New-Object Windows.Forms.ToolStripMenuItem 'Quit (stops syncing)'
$quit.add_Click({ Say 'quit' })
[void]$menu.Items.Add($quit)

$tray.ContextMenuStrip = $menu
$tray.add_MouseClick({ param($s, $e) if ($e.Button -eq 'Left') { Say 'open' } })
$tray.Visible = $true
if (-not $env:OUTREACH_QUIET) {
  $tray.ShowBalloonTip(5000, 'Upwork Outreach is running', 'It stays here in the tray and keeps your contacts in sync. Right-click the icon to quit.', 'Info')
}

# Remove the icon as soon as the backend is gone.
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 1000
$timer.add_Tick({ if ($parent.HasExited) { [Windows.Forms.Application]::Exit() } })
$timer.Start()
[Windows.Forms.Application]::Run()
$tray.Visible = $false
$tray.Dispose()
`;

function startTray() {
  if (process.platform !== "win32") return;
  const encoded = Buffer.from(TRAY_SCRIPT, "utf16le").toString("base64");
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, OUTREACH_PID: String(process.pid), OUTREACH_EXE: process.execPath, OUTREACH_QUIET: BACKGROUND ? "1" : "" },
  });
  child.on("error", (err) => console.error("Tray icon failed to start:", err));
  child.on("close", (code) => console.log("Tray icon closed, code", code));
  child.stderr.on("data", (d) => console.error("Tray:", String(d).trim()));
  child.stdout.on("data", (d) => {
    const lines = String(d).split(/\r?\n/);
    if (lines.includes("open")) openWindow();
    if (lines.includes("quit")) {
      console.log("Quit from the tray menu");
      process.exit(0);
    }
  });
}

server.on("error", (err) => {
  // Already running (another copy, or `npm start`): just show the window.
  if (IS_APP && err.code === "EADDRINUSE") {
    console.log("Already running on port", PORT);
    if (!BACKGROUND) openWindow();
    setTimeout(() => process.exit(0), 500);
    return;
  }
  throw err;
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Outreach backend on http://localhost:${PORT}`);
  console.log(`Contacts app on http://localhost:${PORT}/  ·  data in ${DATA_DIR}`);
  if (IS_APP) {
    startTray();
    if (process.env.OPEN_WINDOW !== "0" && !BACKGROUND) openWindow();
  }
});
