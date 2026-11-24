// Public GitHub / Stack Overflow data for accounts a freelancer links on Upwork.
// Shared by the background worker, content script and side panel.
// Contact info comes from their profile (public email, bio, README, website, social accounts)
// and from the author email in their own commits (git metadata and the commit .patch "From:"
// header). Only commits made by that GitHub account count, so collaborators' emails aren't picked up.

// Git author emails that aren't a real inbox: GitHub's private noreply, bots, local machine names.
function isRealCommitEmail(e) {
  return (
    /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e) &&
    !/noreply|no-reply|@localhost|\.local$|\.localdomain$|\.lan$|\.home$|\.internal$|@example\.|@users\.github\.com$|\[bot\]|^(root|admin|user|test)@/i.test(e)
  );
}

async function githubInsights(login, token) {
  const headers = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const get = async (path) => {
    const r = await fetch("https://api.github.com" + path, { headers });
    if (r.status === 403 || r.status === 429) throw new Error("GitHub rate limit hit — add a token in Settings.");
    if (!r.ok) throw new Error(`GitHub ${r.status} for ${path}`);
    return r.json();
  };
  const u = encodeURIComponent(login);

  const [user, repos, commits, readme, social] = await Promise.all([
    get(`/users/${u}`),
    get(`/users/${u}/repos?sort=pushed&per_page=30`).catch(() => []),
    get(`/search/commits?q=author:${u}&sort=author-date&order=desc&per_page=50`).catch(() => null),
    // Profile README (the special username/username repo shown on their GitHub profile page).
    fetch(`https://api.github.com/repos/${u}/${u}/readme`, { headers: { ...headers, Accept: "application/vnd.github.raw" } })
      .then((r) => (r.ok ? r.text() : ""))
      .catch(() => ""),
    // Social links listed on their profile (LinkedIn, X, Telegram, personal site…).
    get(`/users/${u}/social_accounts`).catch(() => []),
  ]);

  const profileUrl = `https://github.com/${user.login}`;
  const profileEmails = [
    ...(user.email ? [{ value: user.email.toLowerCase(), source: "GitHub profile email", sourceUrl: profileUrl }] : []),
    ...extractEmails(user.bio).map((value) => ({ value, source: "GitHub bio", sourceUrl: profileUrl })),
    ...extractEmails(readme).map((value) => ({ value, source: "GitHub profile README", sourceUrl: `${profileUrl}/${user.login}` })),
  ];

  const items = commits?.items || [];
  const mine = (c) => (c.author?.login || "").toLowerCase() === user.login.toLowerCase();

  // Commits by this account: from the search above, or (search is rate-limited to 10/min
  // without a token) from their most recently pushed repos.
  let own = items.filter(mine).map((c) => ({ sha: c.sha, url: c.html_url, email: c.commit.author.email, repoOwner: c.repository.owner.login }));
  if (!own.length) {
    const recent = repos.filter((r) => !r.fork).slice(0, 3);
    const lists = await Promise.all(
      recent.map((r) => get(`/repos/${r.owner.login}/${encodeURIComponent(r.name)}/commits?author=${u}&per_page=20`).catch(() => []))
    );
    own = lists.flat().filter(mine).map((c) => ({ sha: c.sha, url: c.html_url, email: c.commit.author.email, repoOwner: user.login }));
  }

  // Author emails, most used first.
  const emailUse = new Map();
  for (const c of own) {
    const e = String(c.email || "").trim().toLowerCase();
    if (!isRealCommitEmail(e)) continue;
    const prev = emailUse.get(e) || { value: e, commits: 0, sourceUrl: c.url };
    prev.commits++;
    emailUse.set(e, prev);
  }

  // The .patch of a few of their own commits: its "From:" header carries the author email,
  // "Date:" their timezone, and the commit message sometimes a Telegram handle or phone number.
  const patchTexts = [];
  const tzMinutes = [];
  const patches = await Promise.all(
    own
      .filter((c) => c.repoOwner.toLowerCase() === user.login.toLowerCase())
      .slice(0, 3)
      .map((c) =>
        fetch(c.url + ".patch", { headers: { Accept: "text/plain" } })
          .then((r) => (r.ok ? r.text() : ""))
          .then((text) => ({ url: c.url, sha: c.sha, text: text.slice(0, 200_000) }))
          .catch(() => null)
      )
  );
  // A merge commit's .patch holds the merged contributors' commits (their names and emails),
  // so only use patches that contain exactly this one commit.
  const single = (p) => /^From ([0-9a-f]{40}) /.exec(p.text)?.[1] === p.sha && (p.text.match(/^From: /gm) || []).length === 1;
  for (const p of patches.filter((p) => p?.text && single(p))) {
    const from = /^From: .*?<([^>\s]+@[^>\s]+)>/m.exec(p.text)?.[1]?.toLowerCase();
    if (from && isRealCommitEmail(from) && !emailUse.has(from)) emailUse.set(from, { value: from, commits: 1, sourceUrl: p.url });
    const header = p.text.slice(0, p.text.indexOf("\n\n") >>> 0);
    const tz = /^Date:.*([+-])(\d{2})(\d{2})\s*$/m.exec(header);
    if (tz) tzMinutes.push((tz[1] === "-" ? -1 : 1) * (60 * +tz[2] + +tz[3]));
    // Only the commit message — the code diff below "---" is full of numbers that aren't phones.
    const subject = /^Subject:\s*(?:\[PATCH[^\]]*\]\s*)?(.*(?:\n[ \t].*)*)/m.exec(header)?.[1] || "";
    const body = p.text.slice(header.length);
    const message = subject + "\n" + body.slice(0, Math.min(...[body.search(/\n---\n/), body.search(/\ndiff --git /), body.length].filter((i) => i >= 0)));
    patchTexts.push({ text: message, source: "GitHub commit message", sourceUrl: p.url, confidence: "check" });
  }
  // Their usual UTC offset, e.g. "UTC+03:00" (the most common one across the patches).
  const tzMode = tzMinutes.sort((a, b) => tzMinutes.filter((x) => x === b).length - tzMinutes.filter((x) => x === a).length)[0];
  const timezone =
    tzMode === undefined || Math.abs(tzMode) > 840
      ? ""
      : `UTC${tzMode < 0 ? "-" : "+"}${String(Math.floor(Math.abs(tzMode) / 60)).padStart(2, "0")}:${String(Math.abs(tzMode) % 60).padStart(2, "0")}`;

  // Pages linked from the profile README (personal site, portfolio, contact page…), excluding
  // GitHub itself, badges/images and file downloads. Crawled later like their other websites.
  const readmeLinks = [
    ...new Set(
      (String(readme).match(/https?:\/\/[^\s<>"'`)\]]+/g) || [])
        .map((u) => u.replace(/[.,;:!?]+$/, ""))
        .filter((u) => {
          try {
            const { hostname, pathname } = new URL(u);
            return (
              // GitHub itself and the badge / stats-card / icon services READMEs embed.
              !/(^|\.)(github\.com|githubusercontent\.com|githubassets\.com|shields\.io|badgen\.net|komarev\.com|skillicons\.dev|jsdelivr\.net|github-readme-stats\.vercel\.app|github-readme-streak-stats\.herokuapp\.com|readme-typing-svg\.(demolab\.com|herokuapp\.com)|github-profile-trophy\.vercel\.app|forthebadge\.com)$/i.test(hostname) &&
              !/\.(png|jpe?g|gif|svg|webp|ico|bmp|avif|css|js|mjs|json|xml|map|woff2?|ttf|eot|otf|mp4|webm|mp3|wav|pdf|zip)$/i.test(pathname)
            );
          } catch {
            return false;
          }
        })
    ),
  ].slice(0, 6);
  const commitEmails = [...emailUse.values()]
    .sort((a, b) => b.commits - a.commits)
    .map((e) => ({ ...e, source: `GitHub commits (author email, ${e.commits} commit${e.commits > 1 ? "s" : ""})` }));
  const byRepo = new Map();
  for (const c of items) {
    const name = c.repository.full_name;
    const entry = byRepo.get(name) || { name, url: c.repository.html_url, commits: 0, external: c.repository.owner.login.toLowerCase() !== login.toLowerCase() };
    entry.commits++;
    byRepo.set(name, entry);
  }

  const languages = {};
  for (const r of repos) if (r.language && !r.fork) languages[r.language] = (languages[r.language] || 0) + 1;

  return {
    url: profileUrl,
    login: user.login,
    name: user.name || "",
    bio: user.bio || "",
    company: user.company || "",
    location: user.location || "",
    blog: user.blog || "",
    publicEmail: user.email || "", // only set when the user made it public on their profile
    profileEmails,
    commitEmails,
    timezone,
    readmeLinks,
    socialAccounts: (Array.isArray(social) ? social : []).filter((s) => s?.url).map((s) => ({ provider: s.provider || "", url: s.url })),
    // Raw text the person wrote on their profile (and in their commit patches); scanned for Telegram / phone too.
    profileTexts: [
      { text: user.bio || "", source: "GitHub bio", sourceUrl: profileUrl },
      { text: String(readme).slice(0, 50_000), source: "GitHub profile README", sourceUrl: `${profileUrl}/${user.login}` },
      ...patchTexts,
    ].filter((t) => t.text),
    twitter: user.twitter_username || "",
    hireable: !!user.hireable,
    followers: user.followers,
    publicRepos: user.public_repos,
    createdAt: user.created_at,
    topLanguages: Object.entries(languages).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([l]) => l),
    projects: repos
      .filter((r) => !r.fork)
      .sort((a, b) => b.stargazers_count - a.stargazers_count)
      .slice(0, 6)
      .map((r) => ({ name: r.name, description: r.description || "", language: r.language || "", stars: r.stargazers_count, url: r.html_url })),
    activity: commits
      ? {
          totalCommits: commits.total_count,
          lastCommitAt: items[0]?.commit.author.date || null,
          repos: [...byRepo.values()].sort((a, b) => b.commits - a.commits).slice(0, 8),
          recentMessages: items.slice(0, 8).map((c) => ({
            repo: c.repository.full_name,
            message: c.commit.message.split("\n")[0].slice(0, 120),
            date: c.commit.author.date,
            url: c.html_url,
          })),
        }
      : null,
  };
}

// Upwork's "Linked accounts" card shows the GitHub display name, join year and follower
// count but sometimes no URL. Find the account that matches all three; accept only a unique hit.
async function githubFindLinkedUser({ displayName, since, followers }, token) {
  if (!displayName) return null;
  const headers = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const search = async (q) => {
    const r = await fetch(`https://api.github.com/search/users?q=${encodeURIComponent(q)}&per_page=5`, { headers });
    if (!r.ok) throw new Error(`GitHub search ${r.status}`);
    return (await r.json()).items || [];
  };
  const base = `fullname:"${displayName.replace(/"/g, "")}" type:user` + (since ? ` created:${since}-01-01..${since}-12-31` : "");
  const attempts = followers != null ? [`${base} followers:${followers}`, `${base} followers:${Math.max(0, followers - 3)}..${followers + 3}`, base] : [base];
  for (const q of attempts) {
    const items = await search(q);
    if (items.length === 1) return items[0].html_url;
    if (items.length > 1) return null; // ambiguous: don't guess
  }
  return null;
}

function githubLoginFromUrl(url) {
  const m = /github\.com\/([A-Za-z0-9-]+)(?:[/?#]|$)/i.exec(url || "");
  const reserved = ["orgs", "topics", "features", "about", "sponsors", "marketplace", "settings"];
  return m && !reserved.includes(m[1].toLowerCase()) ? m[1] : null;
}

function timeAgo(iso) {
  if (!iso) return "";
  const d = (Date.now() - new Date(iso)) / 86400000;
  if (d < 1) return "today";
  if (d < 30) return `${Math.round(d)}d ago`;
  if (d < 365) return `${Math.round(d / 30)}mo ago`;
  return `${(d / 365).toFixed(1)}y ago`;
}

// Stack Overflow: reputation, badges and the tags they answer most.
async function stackoverflowInsights(userId) {
  const base = "https://api.stackexchange.com/2.3";
  const get = async (path) => {
    const r = await fetch(`${base}${path}${path.includes("?") ? "&" : "?"}site=stackoverflow`);
    const data = await r.json();
    if (data.error_message) throw new Error(`Stack Overflow: ${data.error_message}`);
    return data;
  };
  const filter = await stackoverflowFilter();
  const [u, tags] = await Promise.all([
    get(`/users/${userId}${filter ? `?filter=${encodeURIComponent(filter)}` : ""}`),
    get(`/users/${userId}/top-tags?pagesize=8`).catch(() => ({ items: [] })),
  ]);
  const user = u.items?.[0];
  if (!user) throw new Error("Stack Overflow user not found");
  const decode = (s) => String(s || "").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  // The API has no field for the GitHub link shown on the profile page, so read the page itself.
  const githubUrl = findGithubUrl(`${user.website_url || ""} ${user.about_me || ""}`) || (await stackoverflowPageGithub(user.link));
  return {
    userId,
    name: decode(user.display_name),
    reputation: user.reputation,
    badges: user.badge_counts,
    location: decode(user.location),
    createdAt: new Date(user.creation_date * 1000).toISOString(),
    lastActiveAt: user.last_access_date ? new Date(user.last_access_date * 1000).toISOString() : null,
    topTags: (tags.items || []).map((t) => ({ tag: t.tag_name, answers: t.answer_count, score: t.answer_score })),
    website: user.website_url || "",
    // A GitHub account the person links from their own Stack Overflow profile.
    githubUrl,
    profileEmails: extractEmails(user.about_me).map((value) => ({ value, source: "Stack Overflow about me", sourceUrl: user.link })),
    profileTexts: user.about_me ? [{ text: user.about_me, source: "Stack Overflow about me", sourceUrl: user.link }] : [],
  };
}

// The GitHub account most linked on a Stack Overflow profile page (profile links, about-me).
async function stackoverflowPageGithub(profileUrl) {
  if (!profileUrl) return "";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const r = await fetch(profileUrl, { signal: ctrl.signal, headers: { Accept: "text/html" } });
    if (!r.ok) return "";
    const html = (await r.text()).slice(0, 1_000_000);
    const reserved = new Set(["about", "apps", "business", "codespaces", "collections", "contact", "customer-stories", "enterprise", "events", "explore", "features", "githubtraining", "home", "issues", "login", "marketplace", "new", "notifications", "organizations", "orgs", "pricing", "pulls", "readme", "search", "security", "settings", "signup", "site", "sponsors", "stars", "team", "topics", "trending", "stackexchange"]);
    const counts = new Map();
    for (const m of html.matchAll(/(?:https?:)?\/\/(?:www\.)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))(?:[/?#"'\s<]|$)/gi))
      if (!reserved.has(m[1].toLowerCase())) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
    const best = [...counts].sort((a, b) => b[1] - a[1])[0];
    return best ? `https://github.com/${best[0]}` : "";
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

// Email addresses written in text/HTML, including "name [at] domain [dot] com" forms.
// Skips no-reply, placeholder and image-filename false positives.
function extractEmails(text) {
  if (!text) return [];
  const s = String(text)
    .replace(/&#64;|&commat;/gi, "@")
    .replace(/\s*[[(]\s*at\s*[\])]\s*/gi, "@")
    .replace(/\s*[[(]\s*dot\s*[\])]\s*/gi, ".")
    .replace(/mailto:/gi, " ");
  const out = new Set();
  // Not preceded by "@": "@name@mastodon.social" is a Mastodon / Fediverse handle, not an email.
  for (const m of s.match(/(?<![@\w.%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []) {
    const e = m.toLowerCase().replace(/\.+$/, "");
    if (/noreply|no-reply|example\.(com|org)|@(sentry|wixpress)\.|\.ingest\.sentry\.io$|\.(png|jpe?g|gif|svg|webp|ico|bmp|avif|css|js|mjs|json|xml|map|woff2?|ttf|eot|otf|mp4|webm|mp3|wav|pdf|zip|html?)$/.test(e)) continue;
    if (/^[0-9a-f]{32,}@/.test(e)) continue; // tracking / error-reporting keys, not people
    out.add(e);
  }
  return [...out];
}

// Visible-ish text of an HTML document (scripts/styles removed, tags -> spaces).
function htmlToText(html) {
  return String(html || "")
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#43;|&plus;/g, "+")
    .replace(/\s+/g, " ");
}

// Telegram handles: t.me links and "Telegram: @handle" mentions.
function extractTelegrams(text) {
  const s = String(text || "");
  const out = new Set();
  const skip = /^(joinchat|share|s|addstickers|addemoji|proxy|socks|iv|c|bg|setlanguage|confirmphone|login|start)$/i;
  for (const m of s.matchAll(/(?:t\.me|telegram\.me|telegram\.dog)\/([A-Za-z0-9_]{5,32})/gi)) if (!skip.test(m[1])) out.add("@" + m[1]);
  for (const m of s.matchAll(/(?:telegram|\btg\b)[^A-Za-z0-9@]{0,20}@([A-Za-z][A-Za-z0-9_]{4,31})/gi)) if (!skip.test(m[1])) out.add("@" + m[1]);
  return [...out];
}

// Phone / WhatsApp numbers: tel: and wa.me links, labelled numbers, and +international numbers.
function extractPhones(html, text = htmlToText(html)) {
  const raw = [];
  const src = String(html || "");
  for (const m of src.matchAll(/tel:([+\d][\d\s().%20-]{6,24})/gi)) raw.push({ v: decodeURIComponent(m[1]), kind: "phone" });
  for (const m of src.matchAll(/(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?phone=)(\+?\d{8,15})/gi)) raw.push({ v: m[1], kind: "whatsapp" });
  for (const m of text.matchAll(/\b(phone|tel|telephone|mobile|cell|call|whatsapp)\s*[:：.]?\s*(\+?\d[\d\s().-]{7,18}\d)/gi))
    raw.push({ v: m[2], kind: /whatsapp/i.test(m[1]) ? "whatsapp" : "phone" });
  for (const m of text.matchAll(/(?<![\w+])\+\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}\b/g)) raw.push({ v: m[0], kind: "phone" });

  const out = new Map();
  for (const { v, kind } of raw) {
    const digits = v.replace(/[^\d]/g, "");
    if (digits.length < 8 || digits.length > 15 || /^(\d)\1+$/.test(digits)) continue;
    const norm = (v.trim().startsWith("+") || kind === "whatsapp" ? "+" : "") + digits;
    const prev = out.get(digits);
    if (!prev || (prev.kind === "phone" && kind === "whatsapp")) out.set(digits, { value: norm, kind });
  }
  return [...out.values()];
}

// All contact details in one blob of text/HTML.
function extractContacts(html) {
  const text = htmlToText(html);
  return {
    emails: extractEmails(html + " " + text),
    telegrams: extractTelegrams(html + " " + text),
    phones: extractPhones(html, text),
  };
}

// Contact details on one site: home page plus up to 3 contact/about-style pages on it.
// `render(url)` (optional) returns browser-rendered HTML for JS-only sites.
// `names` are the freelancer's names/handles; a page mentioning one marks results "likely".
async function websiteContacts(site, { names = [], render, sourceLabel = "Website", trusted = false } = {}) {
  let base;
  try {
    base = new URL(/^https?:\/\//i.test(site) ? site : "https://" + site).href;
  } catch {
    return { contacts: [], nameMatched: false };
  }
  const getHtml = async (url) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const r = await fetch(url, { redirect: "follow", signal: ctrl.signal });
      if (!r.ok || !/text\/html/i.test(r.headers.get("content-type") || "")) return "";
      let html = (await r.text()).slice(0, 800_000);
      // Single-page apps ship an empty shell; let the browser render it.
      if (render && htmlToText(html).length < 200 && /<script\b/i.test(html)) html = (await render(url).catch(() => "")) || html;
      return html;
    } catch {
      return "";
    } finally {
      clearTimeout(t);
    }
  };

  const home = await getHtml(base);
  if (!home) return { contacts: [], nameMatched: false };
  const pages = [{ url: base, html: home }];
  const origin = new URL(base).origin;
  const sub = new Set();
  for (const m of home.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,80}?)<\/a>/gi)) {
    if (!/contact|about|hire|reach|connect|get.in.touch/i.test(m[1] + " " + m[2])) continue;
    try {
      const u = new URL(m[1], base);
      if (u.origin === origin && u.href !== base) sub.add(u.origin + u.pathname);
    } catch {}
  }
  if (!sub.size) ["/contact", "/about"].forEach((p) => sub.add(new URL(p, base).href));
  for (const url of [...sub].slice(0, 3)) {
    const html = await getHtml(url);
    if (html) pages.push({ url, html });
  }

  const allText = pages.map((p) => htmlToText(p.html)).join(" ").toLowerCase();
  const nameMatched = trusted || names.some((n) => n && n.length >= 3 && allText.includes(n.toLowerCase()));
  const confidence = nameMatched ? "likely" : "check";
  const contacts = [];
  const push = (type, value, url) => {
    if (!contacts.some((c) => c.type === type && c.value === value))
      contacts.push({ type, value, source: `${sourceLabel} (${new URL(url).hostname}${new URL(url).pathname.replace(/\/$/, "")})`, sourceUrl: url, confidence });
  };
  for (const p of pages) {
    const c = extractContacts(p.html);
    c.emails.forEach((v) => push("email", v, p.url));
    c.telegrams.forEach((v) => push("telegram", v, p.url));
    c.phones.forEach((ph) => push(ph.kind, ph.value, p.url));
  }
  return { contacts, nameMatched };
}

// Default user objects omit about_me; create (once) a filter that includes it.
let soFilter;
async function stackoverflowFilter() {
  if (soFilter !== undefined) return soFilter;
  try {
    const r = await fetch("https://api.stackexchange.com/2.3/filters/create?include=user.about_me&unsafe=false");
    soFilter = (await r.json()).items?.[0]?.filter || "";
  } catch {
    soFilter = "";
  }
  return soFilter;
}

function findGithubUrl(text) {
  const reserved = ["orgs", "topics", "features", "about", "sponsors", "marketplace", "settings", "login", "join"];
  for (const m of String(text).matchAll(/github\.com\/([A-Za-z0-9-]{1,39})/gi)) {
    if (!reserved.includes(m[1].toLowerCase())) return `https://github.com/${m[1]}`;
  }
  // A GitHub Pages site (username.github.io) belongs to that GitHub user.
  const pages = /\b([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\.github\.io\b/i.exec(String(text));
  if (pages && !["www", "pages", "docs", "help"].includes(pages[1].toLowerCase())) return `https://github.com/${pages[1]}`;
  return "";
}

function stackoverflowIdFromUrl(url) {
  const m = /stackoverflow\.com\/users\/(\d+)/i.exec(url || "");
  return m ? m[1] : null;
}

function compactNumber(n) {
  return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n ?? 0);
}

Object.assign(globalThis, { extractEmails, extractContacts, extractTelegrams, extractPhones, htmlToText, websiteContacts, githubInsights, githubFindLinkedUser, githubLoginFromUrl, findGithubUrl, stackoverflowInsights, stackoverflowIdFromUrl, timeAgo, compactNumber });
