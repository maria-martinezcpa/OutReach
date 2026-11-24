import "./capture.js";
import "./insights.js";
import { listContacts, putContact, normalizeUrl, syncContacts } from "./db.js";

// Clicking the toolbar icon opens the side panel.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
// Let the Upwork content script read run progress.
chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" });

const DEFAULT_SETTINGS = {
  backend: "http://localhost:8787",
  sender: "",
  githubToken: "",
  concurrency: 2,
};
const MAX_PER_RUN = 50;
// Human-like pace so Upwork's "verify you're human" check comes up less often.
const MAX_PARALLEL = 3;
const BREAK_EVERY_PAGES = 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const itemKey = (r) => r.url || `${r.name}|${r.title}`;

// ---------- run state (chrome.storage.session) ----------
async function getRun() {
  return (await chrome.storage.session.get("run")).run || null;
}

// Serialize read-modify-write so the queue and Send clicks don't clobber each other.
let lock = Promise.resolve();
function mutate(fn) {
  const p = lock.then(async () => {
    const run = await getRun();
    if (!run) return null;
    fn(run);
    await chrome.storage.session.set({ run });
    return run;
  });
  lock = p.catch(() => {});
  return p;
}
const patchItem = (key, patch) =>
  mutate((run) => {
    const it = run.items.find((i) => i.key === key);
    if (it) Object.assign(it, patch);
  });

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...settings };
}

// ---------- start / process ----------
async function capture(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: captureProfile });
  return result;
}

async function start(tabId, auto) {
  const result = await capture(tabId);
  const cards = result.kind === "search" ? result.results : [result.profile];
  if (!cards.length) throw new Error("No freelancers found on this page yet — wait for results to load.");
  const { url } = await chrome.tabs.get(tabId);
  const items = await itemsFor(result);
  await chrome.storage.session.set({
    run: {
      tabId, status: "running", startedAt: Date.now(), items,
      // Search pages only: when this page is done, load the next one (?page=N+1) and keep going.
      auto: !!auto && result.kind === "search", url, page: pageOf(url), pages: 1, totals: emptyTotals(),
    },
  });
  processQueue();
  getSettings().then((s) => syncContacts(s.backend)); // fresh used/not-used marks
  return items.length;
}

async function itemsFor(result) {
  const cards = result.kind === "search" ? result.results : [result.profile];
  const items = cards.slice(0, MAX_PER_RUN).map((card) => ({
    key: itemKey(card),
    card,
    profile: result.kind === "profile" ? card : null,
    state: card.url ? "queued" : "no_link",
  }));
  // Freelancers researched before (or already saved) aren't searched again.
  const researched = await getResearched();
  const contacts = await listContacts();
  for (const it of items) {
    if (!it.card.url) continue;
    const n = normalizeUrl(it.card.url);
    const prev = researched[n] || fromContact(contacts.find((c) => c.upwork?.url && normalizeUrl(c.upwork.url) === n));
    if (prev) Object.assign(it, { state: "done", cached: true, profile: prev.profile, accounts: prev.accounts, saved: prev.saved, savedAs: prev.savedAs });
  }
  return items;
}

// ---------- automatic next pages ----------
const pageOf = (url) => Number(new URL(url).searchParams.get("page")) || 1;
function pageUrl(url, page) {
  const u = new URL(url);
  u.searchParams.set("page", page);
  return u.toString();
}
const emptyTotals = () => ({ checked: 0, github: 0, stackoverflow: 0, saved: 0 });
function addTotals(t, items) {
  return {
    checked: t.checked + items.filter((i) => i.state === "done").length,
    github: t.github + items.filter((i) => i.accounts?.github?.url).length,
    stackoverflow: t.stackoverflow + items.filter((i) => i.accounts?.stackoverflow?.url).length,
    saved: t.saved + items.filter((i) => i.saved).length,
  };
}
const halt = (notice) => mutate((r) => Object.assign(r, { status: "stopped", loading: null, notice }));

// Is the tab showing Cloudflare's "Just a moment… / Verify you are human" page?
async function isHumanCheck(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () =>
        /just a moment/i.test(document.title) ||
        !!document.querySelector("iframe[src*='challenges.cloudflare.com'], [name='cf-turnstile-response'], #challenge-form"),
    });
    return result;
  } catch {
    return false;
  }
}

// Upwork's "Verify you are human" check. The extension never clicks it: it brings that tab to
// the front and waits for you. Only one tab is shown at a time; other workers wait on the same
// check, since solving it once clears Upwork for every tab.
let humanWait = null;
function waitForHuman(tabId, where) {
  humanWait ||= (async () => {
    await mutate((r) => (r.notice = `Upwork wants you to verify you're human (${where}). Click the checkbox in that tab — searching continues by itself.`));
    const t = await chrome.tabs.update(tabId, { active: true }).catch(() => null);
    if (t) chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
    chrome.action.setBadgeText({ text: "!" });
    for (const deadline = Date.now() + 15 * 60_000; Date.now() < deadline; await sleep(3000)) {
      if ((await getRun())?.status !== "running" || !(await isHumanCheck(tabId))) break;
    }
    chrome.action.setBadgeText({ text: "" });
    await mutate((r) => (r.notice = ""));
  })().finally(() => (humanWait = null));
  return humanWait;
}

// Reload the search tab on the next page, wait for its freelancers, and queue them.
async function nextPage() {
  const run = await getRun();
  const page = run.page + 1;
  const url = pageUrl(run.url, page);
  // 20–40 s between pages, and a 3–5 min break every few pages.
  const rest = run.pages % BREAK_EVERY_PAGES === 0;
  const wait = rest ? 180_000 + Math.random() * 120_000 : 20_000 + Math.random() * 20_000;
  await mutate((r) =>
    Object.assign(r, { loading: page, notice: rest ? `Short break after ${r.pages} pages — page ${page} opens in about ${Math.round(wait / 60_000)} min.` : "" })
  );
  for (const until = Date.now() + wait; Date.now() < until; await sleep(5000)) {
    if ((await getRun())?.status !== "running") break; // Stop works during the pause
  }
  await mutate((r) => (r.notice = ""));
  if ((await getRun())?.status !== "running") return mutate((r) => (r.loading = null));
  try {
    await chrome.tabs.update(run.tabId, { url });
  } catch {
    return halt("The Upwork tab was closed.");
  }
  await sleep(1500);
  await waitForTabComplete(run.tabId, 45_000);

  // Results render after the page loads: wait until freelancer cards show up, then let them settle.
  let result = null;
  for (const deadline = Date.now() + 30_000; Date.now() < deadline; await sleep(1500)) {
    try {
      result = await capture(run.tabId);
    } catch {
      result = null;
    }
    if (result?.kind === "search" && result.results.length) break;
  }
  if (result?.kind === "search" && result.results.length) {
    await sleep(2000);
    result = (await capture(run.tabId).catch(() => null)) || result;
  }
  if (!(result?.kind === "search" && result.results.length) && (await isHumanCheck(run.tabId))) {
    await waitForHuman(run.tabId, `search page ${page}`);
    if ((await getRun())?.status !== "running") return mutate((r) => (r.loading = null));
    for (const deadline = Date.now() + 30_000; Date.now() < deadline; await sleep(1500)) {
      result = await capture(run.tabId).catch(() => null);
      if (result?.kind === "search" && result.results.length) break;
    }
    if (result?.results?.length) {
      await sleep(2000);
      result = (await capture(run.tabId).catch(() => null)) || result;
    }
  }
  if (!(result?.kind === "search" && result.results.length))
    return halt(`Page ${page} showed no freelancers — the end of the results, or the check wasn't finished. Check the tab, then press Resume.`);
  if ((await getRun())?.status !== "running") return mutate((r) => (r.loading = null));

  const items = await itemsFor(result);
  await mutate((r) =>
    Object.assign(r, { totals: addTotals(r.totals || emptyTotals(), r.items), items, url, page, pages: (r.pages || 1) + 1, loading: null })
  );
  processQueue();
}

// Several workers pull from the same queue, so profiles are processed in parallel.
let processing = false;
async function processQueue() {
  if (processing) return;
  processing = true;
  let pageDone = false;
  try {
    const { concurrency } = await getSettings();
    const n = Math.min(Math.max(Number(concurrency) || 2, 1), MAX_PARALLEL);
    await Promise.all(Array.from({ length: n }, (_, w) => worker(w)));
    const run = await getRun();
    pageDone = run?.status === "running" && !run.items.some((i) => i.state === "queued" || i.state === "checking");
    if (pageDone && !run.auto) await mutate((r) => (r.status = "done"));
  } finally {
    processing = false;
  }
  if (pageDone && (await getRun())?.auto) await nextPage();
}

// Atomically claim the next queued item so two workers never take the same one.
async function claimNext() {
  let claimed = null;
  await mutate((run) => {
    if (run.status !== "running") return;
    const it = run.items.find((i) => i.state === "queued");
    if (it) {
      it.state = "checking";
      claimed = it;
    }
  });
  return claimed;
}

async function worker(index) {
  await sleep(index * 3000); // stagger tab opens
  while (true) {
    const item = await claimNext();
    if (!item) return;
    try {
      const full = item.profile || (await readProfile(item.card.url));
      const profile = mergeProfiles(item.card, full);
      const accounts = await enrichAccounts(profile);
      // Contact info found on their GitHub (profile, README, commits, linked pages): save the
      // account right away, without waiting for Send email.
      const fromGithub = (accounts.contacts || []).some((c) => /github/i.test(c.source || ""));
      let saved = {};
      if (fromGithub) {
        const done = { ...item, profile, accounts };
        await saveContact(done, null, await findContact(done));
        saved = { saved: true, savedAs: accounts.emailCandidates?.length ? "email" : "github" };
      }
      await patchItem(item.key, { state: "done", profile, accounts, ...saved });
      await remember(item.card.url, { profile, accounts, ...saved });
    } catch (e) {
      // Stopped mid-way (e.g. during the human check): leave it for Resume instead of failing it.
      const stopped = (await getRun())?.status !== "running";
      await patchItem(item.key, stopped ? { state: "queued" } : { state: "error", error: e.message });
    }
    await sleep(4000 + Math.random() * 5000); // human-like pace between profiles
  }
}

// ---------- researched freelancers (chrome.storage.local, kept across runs) ----------
const MAX_RESEARCHED = 2000;
async function getResearched() {
  return (await chrome.storage.local.get("researched")).researched || {};
}
let rememberLock = Promise.resolve();
function remember(url, data) {
  if (!url) return Promise.resolve();
  const p = rememberLock.then(async () => {
    const all = await getResearched();
    const n = normalizeUrl(url);
    all[n] = { ...all[n], ...data, at: Date.now() };
    const keys = Object.keys(all);
    if (keys.length > MAX_RESEARCHED)
      keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - MAX_RESEARCHED).forEach((k) => delete all[k]);
    await chrome.storage.local.set({ researched: all });
  });
  rememberLock = p.catch(() => {});
  return p;
}
// Saved before this record existed: rebuild what the panel needs from the contact.
function fromContact(c) {
  if (!c) return null;
  const gh = c.accounts?.find((x) => x.type === "github");
  const so = c.accounts?.find((x) => x.type === "stackoverflow");
  const contacts = (c.methods || []).map((m) => ({ type: m.type, value: m.value, source: m.source, sourceUrl: m.sourceUrl }));
  const emails = contacts.filter((m) => m.type === "email" || m.type === "outlook");
  return {
    profile: { ...c.upwork, name: c.name },
    accounts: { github: gh || null, stackoverflow: so || null, contacts, emailCandidates: emails },
    saved: true,
    savedAs: emails.length ? "email" : "github",
  };
}

// Opens one profile in a background tab and keeps it open until the page is fully
// loaded and its content has stopped changing; only then reads everything and closes it.
async function readProfile(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForTabComplete(tab.id, 45_000);
    if (humanWait || (await isHumanCheck(tab.id))) {
      await (humanWait || waitForHuman(tab.id, "a freelancer's profile"));
      if ((await getRun())?.status !== "running") throw new Error("Stopped while waiting for the human check.");
      await chrome.tabs.reload(tab.id).catch(() => {});
      await sleep(1000);
      await waitForTabComplete(tab.id, 45_000);
    }

    let last = null;
    let stableCount = 0;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      // Scroll through the page so lazy sections (work history, portfolio…) render.
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scrollThroughPage }).catch(() => {});
      await sleep(1500);

      let p = null;
      try {
        const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: captureProfile });
        p = result?.kind === "profile" ? result.profile : null;
      } catch {} // navigation still settling

      if (p && (p.overview || p.skills.length)) {
        const sig = [p.textLength, p.skills.length, p.links.length, Object.keys(p.sections || {}).length].join("|");
        stableCount = sig === last?.sig ? stableCount + 1 : 0;
        last = { sig, profile: p };
        // Same content on 2 consecutive reads after a full scroll = fully loaded.
        if (stableCount >= 2) return await addRevealedLinks(tab.id, p);
      }
    }
    if (last) return last.profile; // best effort if the page never fully settled
    throw new Error("Couldn't read the profile (slow load or login wall).");
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

const ACCOUNT_URL = /^https?:\/\/(www\.)?(github\.com\/[A-Za-z0-9-]+|stackoverflow\.com\/users\/\d+)/i;

// "Linked accounts" card whose "View profile" is a JS button: click it in the page and
// capture where it goes (window.open, link click, or a tab it opens).
async function addRevealedLinks(tabId, p) {
  const hasAccountLink = (p.links || []).some((l) => ACCOUNT_URL.test(l.url));
  if (!p.linkedAccounts?.length || hasAccountLink) return p;

  const opened = [];
  const onCreated = (t) => t.openerTabId === tabId && opened.push(t.id);
  chrome.tabs.onCreated.addListener(onCreated);
  let found = [];
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: clickViewProfiles });
    found = result || [];
    await sleep(1500);
  } catch (e) {
    console.warn("View profile click failed", e);
  } finally {
    chrome.tabs.onCreated.removeListener(onCreated);
  }
  // Tabs the click managed to open anyway: read their URL, then close them.
  for (const id of opened) {
    found.push(await finalUrl(id));
    chrome.tabs.remove(id).catch(() => {});
  }

  const urls = [];
  for (let u of found.filter(Boolean)) {
    if (!ACCOUNT_URL.test(u) && /upwork\.com/i.test(u)) u = unwrapRedirect(u) || (await resolveViaTab(u));
    const m = u && ACCOUNT_URL.exec(u);
    if (m && !urls.includes(m[0])) urls.push(m[0].replace(/^http:/, "https:"));
  }
  const links = [...(p.links || [])];
  for (const url of urls) links.push({ url, via: "Upwork linked accounts (View profile)" });
  return { ...p, links };
}

function unwrapRedirect(u) {
  try {
    return [...new URL(u).searchParams.values()].find((v) => /^https?:\/\//i.test(v)) || "";
  } catch {
    return "";
  }
}

// Wait until a tab has navigated away from about:blank / Upwork and report its URL.
async function finalUrl(tabId, timeout = 10_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    const u = t?.url || t?.pendingUrl || "";
    if (u && !/^about:|^chrome:|upwork\.com/i.test(u)) return u;
    await sleep(300);
  }
  return "";
}

// Follow an Upwork redirect URL in a background tab to see where it lands.
async function resolveViaTab(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    return await finalUrl(tab.id);
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// Runs in the page's own JS world so it can intercept window.open used by Upwork's handlers.
async function clickViewProfiles() {
  const found = [];
  const realOpen = window.open;
  window.open = function (url) {
    if (url) found.push(new URL(String(url), location.href).href);
    return null;
  };
  const onClick = (e) => {
    const a = e.target.closest?.("a[href]");
    if (a && !a.href.startsWith("javascript:")) {
      found.push(a.href);
      e.preventDefault(); // stay on the profile; Upwork's own handler still runs
    }
  };
  document.addEventListener("click", onClick, true);
  try {
    const heading = [...document.body.querySelectorAll("*")].find(
      (el) => el.children.length === 0 && /^linked accounts$/i.test(el.textContent.trim())
    );
    let box = heading?.parentElement;
    while (box && box !== document.body && box.innerText.trim().length <= 20) box = box.parentElement;
    if (!box) return found;
    const matches = [...box.querySelectorAll("a, button, [role='button'], span, div")].filter((el) =>
      /^view profile$/i.test(el.textContent.trim())
    );
    // Click the innermost element of each "View profile" control; the click bubbles up
    // to whichever wrapper (a / button / div) carries Upwork's handler.
    const targets = matches.filter((el) => !matches.some((o) => o !== el && el.contains(o)));
    for (const el of targets) {
      el.scrollIntoView({ block: "center" });
      el.click();
      await new Promise((r) => setTimeout(r, 1500));
    }
    // Some layouts reveal the link in a popover instead of navigating.
    document.querySelectorAll("a[href*='github.com'], a[href*='stackoverflow.com/users']").forEach((a) => found.push(a.href));
  } finally {
    document.removeEventListener("click", onClick, true);
    window.open = realOpen;
  }
  return [...new Set(found)];
}

function waitForTabComplete(tabId, timeout) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    const onUpdated = (id, info) => id === tabId && info.status === "complete" && done();
    const timer = setTimeout(done, timeout);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((t) => t.status === "complete" && done(), done);
  });
}

// Runs in the profile tab: step down to the bottom (triggers lazy loading), then back to top.
async function scrollThroughPage() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight * 0.8) {
    window.scrollTo(0, y);
    await wait(250);
  }
  window.scrollTo(0, document.body.scrollHeight);
  await wait(400);
  window.scrollTo(0, 0);
}

// Full-profile values win, but empty ones don't erase search-card data (rate, JSS…).
function mergeProfiles(card, full) {
  const out = { ...card };
  for (const [k, v] of Object.entries(full)) if (Array.isArray(v) ? v.length : v) out[k] = v;
  return out;
}

// GitHub / Stack Overflow accounts the freelancer links on their own profile.
// If only Stack Overflow is linked, follow the GitHub link on their SO profile.
async function enrichAccounts(profile) {
  const links = profile.links || [];
  let ghUrl = links.find((l) => githubLoginFromUrl(l.url))?.url;
  const soUrl = links.find((l) => stackoverflowIdFromUrl(l.url))?.url;
  const { githubToken } = await getSettings();
  const out = { github: null, stackoverflow: null, contacts: [], mentions: profile.mentions || {} };

  if (soUrl) {
    try {
      out.stackoverflow = { url: soUrl, ...(await stackoverflowInsights(stackoverflowIdFromUrl(soUrl))) };
    } catch (e) {
      out.stackoverflow = { url: soUrl, error: e.message };
    }
  }
  let ghSource = "Linked on Upwork profile";
  if (!ghUrl && out.stackoverflow?.githubUrl) {
    ghUrl = out.stackoverflow.githubUrl;
    ghSource = "Linked on Stack Overflow profile";
  }
  // Upwork "Linked accounts" card without a readable URL: match name + join year + followers.
  const laGithub = (profile.linkedAccounts || []).find((a) => a.provider === "github");
  if (!ghUrl && laGithub) {
    try {
      ghUrl = await githubFindLinkedUser(laGithub, githubToken);
      if (ghUrl) ghSource = "Upwork linked account (matched by name, join year and followers)";
    } catch {}
  }
  if (laGithub && ghUrl && ghSource === "Linked on Upwork profile") ghSource = "Upwork linked account";
  if (ghUrl) {
    try {
      out.github = { url: ghUrl, source: ghSource, ...(await githubInsights(githubLoginFromUrl(ghUrl), githubToken)) };
    } catch (e) {
      out.github = { url: ghUrl, source: ghSource, error: e.message };
    }
  }

  // Contact details the person published themselves.
  const gh = out.github;
  const so = out.stackoverflow;
  const add = (c) => {
    const same = (x) => x.type === c.type && x.value.toLowerCase() === c.value.toLowerCase();
    const prev = out.contacts.find(same);
    if (!prev) out.contacts.push({ confidence: "likely", ...c });
    else if (prev.confidence === "check" && c.confidence !== "check") Object.assign(prev, c); // keep the stronger source
  };
  (gh?.profileEmails || []).forEach((e) => add({ type: "email", ...e }));
  (so?.profileEmails || []).forEach((e) => add({ type: "email", ...e }));
  // Author email in commits made by their GitHub account (most used first).
  (gh?.commitEmails || []).forEach((e) => add({ type: "email", value: e.value, source: e.source, sourceUrl: e.sourceUrl }));
  // Telegram / phone written in their GitHub bio, profile README, commit patches or Stack Overflow about-me.
  for (const t of [...(gh?.profileTexts || []), ...(so?.profileTexts || [])]) {
    const found = extractContacts(t.text);
    const conf = t.confidence ? { confidence: t.confidence } : {};
    found.telegrams.forEach((v) => add({ type: "telegram", value: v, source: t.source, sourceUrl: t.sourceUrl, ...conf }));
    found.phones.forEach((p) => add({ type: p.kind, value: p.value, source: t.source, sourceUrl: t.sourceUrl, ...conf }));
  }

  if (gh?.blog) add({ type: "website", value: gh.blog, source: "Website on GitHub profile", sourceUrl: gh.url });
  if (gh?.twitter) add({ type: "x", value: "@" + gh.twitter, source: "X/Twitter on GitHub profile", sourceUrl: gh.url });
  // Social accounts listed on their GitHub profile.
  for (const s of gh?.socialAccounts || []) {
    const tg = /(?:^|\/\/)(?:www\.)?(?:t\.me|telegram\.me)\/([A-Za-z0-9_]{5,32})/i.exec(s.url);
    const x = /(?:^|\/\/)(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i.exec(s.url);
    const src = { source: `${s.provider && s.provider !== "generic" ? s.provider[0].toUpperCase() + s.provider.slice(1) : "Link"} on GitHub profile`, sourceUrl: gh.url };
    if (tg) add({ type: "telegram", value: "@" + tg[1], ...src });
    else if (x) add({ type: "x", value: "@" + x[1], ...src });
    else add({ type: "website", value: s.url, ...src });
  }
  if (so?.website) add({ type: "website", value: so.website, source: "Website on Stack Overflow profile", sourceUrl: so.url });

  // Web pages: their own sites (from GitHub / SO) + portfolio and other personal links on Upwork.
  const own = [gh?.blog, so?.website].filter(Boolean).map((u) => ({ url: u, label: "Their website", trusted: true }));
  const portfolio = (profile.links || [])
    .map((l) => l.url)
    .filter((u) => !SKIP_SITES.test(u) && !own.some((o) => sameSite(o.url, u)))
    .map((u) => ({ url: u, label: "Portfolio / personal page", trusted: false }));
  // Pages linked from their GitHub profile README: crawled for contacts, not kept as links themselves.
  const readme = (gh?.readmeLinks || [])
    .filter((u) => !SKIP_SITES.test(u))
    .map((u) => ({ url: u, label: "Linked from GitHub README", trusted: false, crawlOnly: true }));
  const seen = new Set();
  const sites = [...own, ...portfolio, ...readme].filter((s) => {
    const host = siteHost(s.url);
    return host && !seen.has(host) && seen.add(host);
  });

  // The links themselves are always kept, so you can open them even if no contact is found.
  for (const s of portfolio.filter((p) => sites.includes(p)))
    add({ type: "website", value: s.url, source: "Portfolio / personal link on Upwork", sourceUrl: profile.url, confidence: "unverified" });

  // Searching those pages for email / Telegram / phone needs the optional "all sites" permission (Settings).
  const { checkWebsites } = await getSettings();
  if (checkWebsites && (await chrome.permissions.contains({ origins: ["<all_urls>"] }))) {
    const names = personNames(profile, gh, so);
    // Their own sites and portfolio first; README links fill the remaining slots.
    for (const s of sites.slice(0, 9)) {
      const res = await websiteContacts(s.url, { names, render: renderPage, sourceLabel: s.label, trusted: s.trusted });
      res.contacts.forEach(add);
      // Record whether the page looked like theirs.
      const link = out.contacts.find((c) => c.type === "website" && sameSite(c.value, s.url) && c.confidence === "unverified");
      if (link) link.confidence = res.nameMatched ? "likely" : "check";
    }
  }

  out.emailCandidates = out.contacts.filter((c) => c.type === "email");
  return out;
}

// Big platforms aren't personal pages (and mostly block fetching).
const SKIP_SITES =
  /(^https?:\/\/)?([^/]+\.)?(github\.com|stackoverflow\.com|stackexchange\.com|linkedin\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|youtu\.be|google\.[a-z.]+|apple\.com|microsoft\.com|play\.google\.com|apps\.apple\.com|medium\.com|behance\.net|dribbble\.com|upwork\.com|vimeo\.com|tiktok\.com|wa\.me|t\.me)(\/|$)/i;

function siteHost(u) {
  try {
    return new URL(/^https?:/i.test(u) ? u : "https://" + u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
const sameSite = (a, b) => siteHost(a) === siteHost(b);

// Names and handles that, when found on a page, suggest it really is this freelancer's.
function personNames(profile, gh, so) {
  const out = new Set();
  const addName = (n) => {
    for (const part of String(n || "").split(/[\s.]+/)) if (part.length >= 3) out.add(part);
  };
  addName(profile.name?.split(" ")[0]); // Upwork shows "Mike B."
  addName(gh?.name);
  addName(so?.name);
  if (gh?.login) out.add(gh.login);
  return [...out];
}

// Browser-rendered HTML for JavaScript-only sites (opened in a hidden tab, then closed).
async function renderPage(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForTabComplete(tab.id, 20_000);
    await sleep(2000);
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => document.documentElement.outerHTML });
    return result || "";
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// ---------- draft + send ----------
async function findContact(item) {
  const url = item.profile?.url || item.card.url;
  if (!url) return null;
  const n = normalizeUrl(url);
  return (await listContacts()).find((c) => c.upwork?.url && normalizeUrl(c.upwork.url) === n) || null;
}

async function draftFor(item) {
  if (item.draft) return item.draft;
  const s = await getSettings();
  const p = item.profile || item.card;
  // The backend fills in your email template (edited in the Contacts app).
  const payload = { profile: { name: p.name, title: p.title }, sender: s.sender };
  let res;
  try {
    res = await fetch(s.backend.replace(/\/$/, "") + "/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("Backend not running — start UpworkOutreach.exe.");
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Draft failed");
  return data;
}

async function sendEmail(key) {
  const run = await getRun();
  const item = run?.items.find((i) => i.key === key);
  if (!item) throw new Error("Freelancer not found — press Start again.");
  await patchItem(key, { sending: true, error: "" });
  try {
    const draft = await draftFor(item);
    const existing = await findContact(item);
    // Recipient = the address you picked; otherwise a saved one, then the first candidate.
    const to =
      item.chosenEmail !== undefined
        ? item.chosenEmail
        : existing?.methods?.find((m) => m.type === "email" || m.type === "outlook")?.value ||
          item.accounts?.emailCandidates?.[0]?.value ||
          "";
    item.chosenEmail = to;

    const gmail =
      "https://mail.google.com/mail/?view=cm&fs=1" +
      `&to=${encodeURIComponent(to)}&su=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}`;
    await chrome.tabs.create({ url: gmail });

    // Keep contacts that have an email (found, chosen or typed) or at least a personal website /
    // portfolio link to follow up on; otherwise don't save.
    const hasEmail = !!to || (item.accounts?.emailCandidates || []).length > 0;
    const hasWebsite = (item.accounts?.contacts || []).some((c) => c.type === "website");
    // Already saved during Start (GitHub contact info found) counts too.
    const saved = hasEmail || hasWebsite || !!item.saved;
    if (saved) await saveContact(item, draft, existing);
    const savedAs = hasEmail ? "email" : hasWebsite ? "websites" : item.savedAs || "";
    // The draft stays only in this browser session, never in the contact database.
    await patchItem(key, { sending: false, draft, sent: true, chosenEmail: to, saved, savedAs });
    await remember(item.card.url, { profile: item.profile, accounts: item.accounts, saved, savedAs });
    return { saved, savedAs };
  } catch (e) {
    await patchItem(key, { sending: false, error: e.message });
    throw e;
  }
}

async function saveContact(item, draft, existing) {
  const p = item.profile || item.card;
  const a = item.accounts || {};
  const now = new Date().toISOString();
  const accounts = [];
  if (a.github?.url)
    accounts.push({
      type: "github", url: a.github.url, source: a.github.source || "Linked on Upwork profile", confidence: "high", verified: true, lastVerified: now,
      bio: a.github.bio, topLanguages: a.github.topLanguages, projects: a.github.projects, activity: a.github.activity,
    });
  if (a.stackoverflow?.url)
    accounts.push({
      type: "stackoverflow", url: a.stackoverflow.url, source: "Linked on Upwork profile", confidence: "high", verified: true, lastVerified: now,
      reputation: a.stackoverflow.reputation, topTags: a.stackoverflow.topTags,
    });

  await putContact({
    id: existing?.id || crypto.randomUUID(),
    name: p.name,
    description: existing?.description || "",
    upwork: { url: p.url, title: p.title, skills: p.skills, location: p.location, rate: p.rate, jobSuccess: p.jobSuccess, earned: p.earned, badges: p.badges, capturedAt: p.capturedAt },
    accounts,
    // A draft means Gmail was just opened: that address now counts as used.
    methods: mergeMethods(existing?.methods || [], a.contacts || [], now, item.chosenEmail, !!draft),
    // Saved automatically (no draft yet) stays "Not contacted" until you open an email.
    status: existing && existing.status !== "not_contacted" ? existing.status : draft ? "draft_opened" : "not_contacted",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });
  // Share with the Contacts app (backend); don't hold up the Gmail flow for it.
  getSettings().then((s) => syncContacts(s.backend));
}

// Keep methods already on the contact; add newly published ones with their source.
function mergeMethods(methods, found, now, chosen, used) {
  const out = [...methods];
  for (const c of found) {
    if (out.some((m) => m.value.toLowerCase() === c.value.toLowerCase())) continue;
    out.push({ type: c.type, value: c.value, source: c.source, sourceUrl: c.sourceUrl, verified: false, addedAt: now });
  }
  if (chosen) {
    const mark = { verified: true, chosen: true, ...(used && { usedAt: now }) };
    const hit = out.find((m) => m.value.toLowerCase() === chosen.toLowerCase());
    if (hit) Object.assign(hit, mark);
    else out.push({ type: "email", value: chosen, source: "Entered by you", addedAt: now, ...mark });
    // The chosen address goes first so it is used as the recipient next time.
    out.sort((a, b) => (b.chosen ? 1 : 0) - (a.chosen ? 1 : 0));
  }
  return out;
}

// ---------- automatic sync with the Contacts app ----------
// Runs while Chrome is open, with or without the side panel, and catches up when the backend returns.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "sync") getSettings().then((s) => syncContacts(s.backend));
});
chrome.alarms.get("sync").then((alarm) => {
  if (!alarm) chrome.alarms.create("sync", { delayInMinutes: 0.5, periodInMinutes: 0.5 });
});

// ---------- messages ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const reply = (p) =>
    p.then((data) => sendResponse({ ok: true, data })).catch((e) => sendResponse({ ok: false, error: e.message }));

  if (msg.type === "start") return reply(start(msg.tabId, msg.auto)), true;
  if (msg.type === "stop") return reply(mutate((r) => (r.status = "stopped"))), true;
  if (msg.type === "resume")
    return reply(mutate((r) => Object.assign(r, { status: "running", notice: "" })).then(() => processQueue())), true;
  if (msg.type === "clear") return reply(chrome.storage.session.remove("run")), true;
  if (msg.type === "send") return reply(sendEmail(msg.key)), true;
  if (msg.type === "chooseEmail") return reply(patchItem(msg.key, { chosenEmail: msg.email })), true;
});

// If Chrome restarted the worker mid-run, pick up where it left off.
(async () => {
  const run = await getRun();
  if (run?.status !== "running") return;
  await mutate((r) => r.items.forEach((i) => i.state === "checking" && (i.state = "queued")));
  processQueue();
})();
