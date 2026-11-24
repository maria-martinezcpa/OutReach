// Contacts app: reads contacts synced from the extension, lets you search and edit them, add new
// ones from pasted text, pick the recipient, fill in your email template and open Gmail.
// Drafts live only in this page's memory, never in the contact store.
const STATUSES = {
  not_contacted: "Not contacted",
  draft_opened: "Draft opened",
  emailed: "Emailed",
  waiting: "Waiting",
  follow_up: "Follow-up",
  replied: "Replied",
  approved: "Approved",
  rejected: "Rejected",
};
// Statuses that mean they've already been emailed (so they don't show under "Not emailed").
const CONTACTED = ["emailed", "waiting", "follow_up", "replied", "approved", "rejected"];
const ACCOUNT_LABELS = { github: "GitHub", stackoverflow: "Stack Overflow", linkedin: "LinkedIn", portfolio: "Portfolio" };
const METHOD_LABELS = {
  email: "Email", outlook: "Email", website: "Website", phone: "Phone", x: "X",
  telegram: "Telegram", whatsapp: "WhatsApp", skype: "Skype", discord: "Discord",
};
const MESSAGING = ["phone", "telegram", "whatsapp", "skype", "discord"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY = 86_400_000;

const $ = (id) => document.getElementById(id);
// Inside the desktop app the top bar doubles as the window's title bar.
if (/Electron/.test(navigator.userAgent)) document.documentElement.classList.add("desktop");
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let contacts = [];
let selectedId = null;
let settings = {};
let visibleIds = [];
const drafts = {}; // id -> { subject, body }
const recipients = {}; // id -> chosen email ("" = none) for this session
const busy = new Set();
let extensionSync = null; // { at, count } from the backend

// Filters, sort and chips survive a reload (this browser only).
const ui = { status: "", sort: "best", chips: [] };
try {
  Object.assign(ui, JSON.parse(localStorage.getItem("outreachUi") || "{}"));
} catch {}
const saveUi = () => {
  try {
    localStorage.setItem("outreachUi", JSON.stringify(ui));
  } catch {}
};

// ---------- api ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(msg, err = false) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast" + (err ? " err" : "");
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), err ? 6000 : 3000);
}

const current = () => contacts.find((c) => c.id === selectedId);
const emailsOf = (c) => (c.methods || []).filter((m) => m.type === "email" || m.type === "outlook");
// Emailed = Gmail was opened for one of their addresses, or the status says so (e.g. imported from a sheet).
const emailed = (c) => emailsOf(c).some((m) => m.usedAt) || CONTACTED.includes(c.status);
const githubOf = (c) => (c.accounts || []).find((a) => a.type === "github");
const avatarOf = (c) => {
  const u = c.upwork || {};
  if (u.avatarUrl) return u.avatarUrl;
  const gh = githubOf(c);
  if (!gh) return null;

  let login = "";
  if (gh.url) {
    const url = String(gh.url).trim();
    const match = url.match(/github\.com\/([A-Za-z0-9-]+)/i);
    if (match) login = match[1];
    else login = url.split("/").filter(Boolean).pop() || "";
  }

  if (login && login.length > 0 && !login.includes(".com")) {
    return `https://github.com/${encodeURIComponent(login)}.png?size=96`;
  }

  // Fallback: colorful initials avatar for contacts with GitHub
  if (gh) {
    const initials = c.name?.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
    const hue = (c.id?.charCodeAt(0) || 0) % 360;
    return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96'%3E%3Crect fill='hsl(${hue},70%,60%)' width='96' height='96'/%3E%3Ctext x='48' y='55' font-size='40' font-weight='bold' fill='white' text-anchor='middle' dominant-baseline='middle'%3E${initials}%3C/text%3E%3C/svg%3E`;
  }
  return null;
};
const lastCommit = (c) => {
  const d = new Date(githubOf(c)?.activity?.lastCommitAt || "");
  return isNaN(d) ? null : d;
};
const hasMethod = (c, ...types) => (c.methods || []).some((m) => types.includes(m.type));
const hasAccount = (c, type) => (c.accounts || []).some((a) => a.type === type);
const usedTag = (m) =>
  m.usedAt ? `<span class="tag ok" title="Gmail opened ${esc(new Date(m.usedAt).toLocaleString())}">Used · ${esc(new Date(m.usedAt).toLocaleDateString())}</span>` : `<span class="tag">Not used</span>`;

async function load() {
  contacts = await api("/api/contacts");
  renderList();
  renderDetail();
}

// Saves run one at a time, each applied to the newest copy of the contact, so a quick second
// change (a note, then a title) can't overwrite the first with an older copy.
let saveQueue = Promise.resolve();
let pendingSaves = 0; // the 5-second refresh waits while saves are in flight
function updateContact(id, change) {
  pendingSaves++;
  const run = saveQueue.then(async () => {
    const latest = contacts.find((x) => x.id === id);
    if (!latest) throw new Error("This contact no longer exists");
    const next = change(structuredClone(latest));
    if (!next) return null; // nothing to change
    const saved = await api(`/api/contacts/${encodeURIComponent(id)}`, { method: "PUT", body: next });
    contacts = contacts.map((x) => (x.id === saved.id ? saved : x));
    renderList();
    return saved;
  });
  saveQueue = run.catch(() => {}).finally(() => pendingSaves--);
  return run;
}

// ---------- search ----------
const norm = (s) => String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// One lowercase text per field, built once per contact version.
const indexCache = new WeakMap();
function indexOf(c) {
  let f = indexCache.get(c);
  if (f) return f;
  const u = c.upwork || {};
  const accts = c.accounts || [];
  const methods = c.methods || [];
  f = {
    name: norm(c.name),
    title: norm(u.title),
    skill: norm((u.skills || []).join(" | ")),
    lang: norm([...accts.flatMap((a) => (a.topLanguages || []).map((l) => l.name || l)), ...accts.flatMap((a) => (a.projects || []).map((p) => p.language))].join(" | ")),
    loc: norm(u.location),
    email: norm(emailsOf(c).map((m) => m.value).join(" ")),
    contact: norm(methods.map((m) => `${m.type} ${m.value}`).join(" ")),
    account: norm(
      accts
        .map((a) => [a.type, a.url, a.bio, ...(a.projects || []).map((p) => `${p.name} ${p.description || ""}`), ...(a.topTags || []).map((t) => t.tag || t.name || t), ...(a.activity?.repos || []).map((r) => r.name)].join(" "))
        .join(" ")
    ),
    note: norm(c.description),
    source: norm([c.importedFrom, ...methods.map((m) => m.source), ...accts.map((a) => a.source)].join(" ")),
    status: norm(`${c.status} ${STATUSES[c.status] || ""}`),
    upwork: norm([u.url, u.rate, u.earned, u.jobSuccess, ...(u.badges || [])].join(" ")),
  };
  f.all = Object.values(f).join(" \n ");
  indexCache.set(c, f);
  return f;
}

const FIELD_ALIASES = {
  name: "name", n: "name", title: "title", role: "title",
  skill: "skill", skills: "skill", s: "skill", lang: "lang", language: "lang", languages: "lang",
  loc: "loc", location: "loc", country: "loc", city: "loc",
  email: "email", mail: "email", contact: "contact", phone: "contact", tel: "contact",
  note: "note", notes: "note", source: "source", from: "source", status: "status",
  github: "account", repo: "account", project: "account", account: "account", tag: "account", upwork: "upwork",
};
const HAS = {
  email: (c) => emailsOf(c).length > 0,
  phone: (c) => hasMethod(c, "phone"),
  telegram: (c) => hasMethod(c, "telegram"), tg: (c) => hasMethod(c, "telegram"),
  whatsapp: (c) => hasMethod(c, "whatsapp"), wa: (c) => hasMethod(c, "whatsapp"),
  x: (c) => hasMethod(c, "x"), twitter: (c) => hasMethod(c, "x"),
  skype: (c) => hasMethod(c, "skype"), discord: (c) => hasMethod(c, "discord"),
  website: (c) => hasMethod(c, "website"), site: (c) => hasMethod(c, "website"),
  messaging: (c) => hasMethod(c, ...MESSAGING),
  github: (c) => hasAccount(c, "github"), gh: (c) => hasAccount(c, "github"),
  stackoverflow: (c) => hasAccount(c, "stackoverflow"), so: (c) => hasAccount(c, "stackoverflow"),
  linkedin: (c) => hasAccount(c, "linkedin"),
  upwork: (c) => !!c.upwork?.url,
  note: (c) => !!c.description,
};
const IS = {
  emailed: (c) => emailed(c),
  unemailed: (c) => emailsOf(c).length > 0 && !emailed(c),
  active: (c) => !!lastCommit(c) && Date.now() - lastCommit(c) < 90 * DAY,
  imported: (c) => !!c.importedFrom,
  new: (c) => Date.now() - new Date(c.createdAt) < 7 * DAY,
};

// "react -wordpress skill:node has:phone "full stack"" -> terms
function parseQuery(q) {
  const terms = [];
  for (const m of String(q).matchAll(/(-)?(?:(\w+):)?(?:"([^"]*)"?|(\S+))/g)) {
    const neg = !!m[1];
    const rawField = m[2]?.toLowerCase();
    const text = norm(m[3] ?? m[4] ?? "").trim();
    if (!text && rawField === undefined) continue;
    if (rawField === "has" || rawField === "is") {
      const test = (rawField === "has" ? HAS : IS)[text] || (rawField === "is" && STATUSES[text.replace(/-/g, "_")] ? (c) => c.status === text.replace(/-/g, "_") : null);
      if (test) terms.push({ neg, test });
      continue;
    }
    const field = rawField && FIELD_ALIASES[rawField];
    // Unknown "word:" isn't a field (a URL, a time): search it as text.
    const whole = rawField && !field ? norm(m[0].replace(/^-/, "")) : text;
    if (whole) terms.push({ neg, field, text: whole });
  }
  return terms;
}

function matchScore(c, terms) {
  const f = indexOf(c);
  let score = 0;
  for (const t of terms) {
    const hit = t.test ? t.test(c) : (t.field ? f[t.field] : f.all).includes(t.text);
    if (t.neg ? hit : !hit) return -1;
    if (t.neg || t.test) continue;
    if (f.name.startsWith(t.text)) score += 12;
    else if (f.name.includes(t.text)) score += 8;
    if (f.title.includes(t.text)) score += 4;
    if (f.skill.includes(t.text)) score += 3;
    if (f.email.includes(t.text) || f.contact.includes(t.text)) score += 3;
    score += 1;
  }
  return score;
}

// ---------- quick filters ----------
const CHIPS = {
  email: ["Has email", (c) => emailsOf(c).length > 0],
  unemailed: ["Not emailed", IS.unemailed],
  messaging: ["Phone / messaging", HAS.messaging],
  github: ["GitHub", HAS.github],
  so: ["Stack Overflow", HAS.so],
  active: ["Active 90 days", IS.active],
  imported: ["Added by you", IS.imported],
};
$("statusFilter").innerHTML += Object.entries(STATUSES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
$("statusFilter").value = ui.status;
$("sortSel").value = ui.sort;

function filtered() {
  const terms = parseQuery($("search").value);
  const chips = ui.chips.filter((k) => CHIPS[k]);
  const rows = [];
  for (const c of contacts) {
    if (ui.status && c.status !== ui.status) continue;
    if (!chips.every((k) => CHIPS[k][1](c))) continue;
    const score = terms.length ? matchScore(c, terms) : 0;
    if (score >= 0) rows.push({ c, score });
  }
  const by = {
    updated: (a, b) => String(b.c.updatedAt).localeCompare(String(a.c.updatedAt)),
    added: (a, b) => String(b.c.createdAt || b.c.updatedAt).localeCompare(String(a.c.createdAt || a.c.updatedAt)),
    name: (a, b) => norm(a.c.name).localeCompare(norm(b.c.name)),
    activity: (a, b) => (lastCommit(b.c) || 0) - (lastCommit(a.c) || 0),
  };
  const sort = ui.sort === "best" ? (terms.some((t) => !t.neg && !t.test) ? (a, b) => b.score - a.score || by.updated(a, b) : by.updated) : by[ui.sort];
  return { rows: rows.sort(sort).map((r) => r.c), terms };
}

// Marks the searched words in a piece of plain text.
function highlight(text, terms) {
  const words = terms.filter((t) => !t.neg && !t.test && (!t.field || t.field === "name" || t.field === "title")).map((t) => t.text);
  if (!words.length || !text) return esc(text);
  const lower = norm(text);
  const marks = new Array(text.length).fill(false);
  // norm() keeps one char per char for most names; skip highlighting if it doesn't.
  if (lower.length !== text.length) return esc(text);
  for (const w of words) for (let i = lower.indexOf(w); i >= 0 && w; i = lower.indexOf(w, i + 1)) marks.fill(true, i, i + w.length);
  let out = "";
  for (let i = 0; i < text.length; ) {
    let j = i;
    while (j < text.length && marks[j] === marks[i]) j++;
    out += marks[i] ? `<mark>${esc(text.slice(i, j))}</mark>` : esc(text.slice(i, j));
    i = j;
  }
  return out;
}

// The extension syncs every 30 seconds while Chrome is open.
function extensionSyncText() {
  if (!extensionSync) return " · extension not synced yet";
  const at = new Date(extensionSync.at);
  return Date.now() - at > 120_000
    ? ` · extension last synced ${at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} (is Chrome open?)`
    : " · extension synced";
}

function renderCountLine(shown = visibleIds.length) {
  const withEmail = contacts.filter((c) => emailsOf(c).length).length;
  $("countLine").textContent = `${contacts.length} contacts · ${withEmail} with email · ${contacts.filter(IS.unemailed).length} not emailed yet` +
    (shown !== contacts.length ? ` · showing ${shown}` : "") + extensionSyncText();
}

function renderChips() {
  $("chips").innerHTML = Object.entries(CHIPS)
    .map(([k, [label, test]]) => {
      const n = contacts.filter(test).length;
      const on = ui.chips.includes(k);
      return `<button class="chip ${on ? "on" : ""}" data-chip="${k}" aria-pressed="${on}" ${!n && !on ? "disabled" : ""}>${esc(label)} <span>${n}</span></button>`;
    })
    .join("");
  $("clearFilters").hidden = !(ui.chips.length || ui.status || $("search").value.trim());
}

function renderList() {
  const { rows, terms } = filtered();
  visibleIds = rows.map((c) => c.id);
  renderCountLine(rows.length);
  renderChips();
  const empty = $("emptyList");
  empty.hidden = rows.length > 0;
  empty.innerHTML = !contacts.length
    ? "No contacts yet. Use <b>+ Add contacts</b> to paste some in, or save them from the extension."
    : "No contacts match. <button class='link-btn' id='emptyClear'>Clear search and filters</button>";
  const now = Date.now();
  if (rows.length > 0 && rows[0].accounts?.some(a => a.type === 'github')) {
    console.log("Debug first contact:", rows[0].name, "GitHub accounts:", rows[0].accounts?.filter(a => a.type === 'github'));
  }
  $("contactList").innerHTML = rows
    .map((c) => {
      const u = c.upwork || {};
      const nEmails = emailsOf(c).length;
      const commit = lastCommit(c);
      const commitAge = commit ? Math.max(0, Math.round((now - commit) / DAY)) : null;
      const info = [u.location, commitAge != null && (commitAge === 0 ? "committed today" : `committed ${commitAge}d ago`)].filter(Boolean).join(" · ");
      const kinds = [...new Set((c.methods || []).map((m) => m.type).filter((t) => MESSAGING.includes(t)))];
      const avatar = avatarOf(c);
      return `
      <li data-id="${esc(c.id)}" role="option" aria-selected="${c.id === selectedId}" class="${c.id === selectedId ? "on" : ""}">
        ${avatar ? `<img class="list-avatar" src="${esc(avatar)}" alt="${esc(c.name)}" loading="lazy" />` : ""}
        <div class="list-content">
          <div class="row1">
            <span class="name">${highlight(c.name, terms)}</span>
            <span class="meta status-${esc(c.status)}">${esc(STATUSES[c.status] || c.status)}</span>
          </div>
          ${u.title ? `<div class="sub">${highlight(u.title, terms)}</div>` : ""}
          ${info ? `<div class="sub faint">${esc(info)}</div>` : ""}
          <div class="tags">
            ${nEmails ? `<span class="tag ${emailed(c) ? "" : "ok"}">${nEmails} email${nEmails > 1 ? "s" : ""}${emailed(c) ? " · emailed" : ""}</span>` : `<span class="tag warn">no email</span>`}
            ${kinds.map((k) => `<span class="tag info">${esc(METHOD_LABELS[k])}</span>`).join("")}
            ${(c.accounts || []).map((a) => `<span class="tag">${esc(ACCOUNT_LABELS[a.type] || a.type)}</span>`).join("")}
            ${c.importedFrom ? `<span class="tag">${esc(c.importedFrom)}</span>` : ""}
          </div>
        </div>
      </li>`;
    })
    .join("");
}

function select(id, { scroll = false } = {}) {
  selectedId = id;
  for (const li of $("contactList").children) {
    const on = li.dataset.id === id;
    li.classList.toggle("on", on);
    li.setAttribute("aria-selected", on);
    if (on && scroll) li.scrollIntoView({ block: "nearest" });
  }
  renderDetail();
  // Slide the newly opened contact in (only on a change of contact, not on every refresh).
  const d = $("detail");
  d.classList.remove("enter");
  void d.offsetWidth;
  d.classList.add("enter");
}

$("contactList").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-id]");
  if (li) select(li.dataset.id);
});
$("emptyList").addEventListener("click", (e) => {
  if (e.target.id === "emptyClear") clearFilters();
});

let searchTimer;
$("search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderList, 80);
});
$("statusFilter").addEventListener("change", (e) => {
  ui.status = e.target.value;
  saveUi();
  renderList();
});
$("sortSel").addEventListener("change", (e) => {
  ui.sort = e.target.value;
  saveUi();
  renderList();
});
$("chips").addEventListener("click", (e) => {
  const k = e.target.closest("[data-chip]")?.dataset.chip;
  if (!k) return;
  ui.chips = ui.chips.includes(k) ? ui.chips.filter((x) => x !== k) : [...ui.chips, k];
  saveUi();
  renderList();
});
function clearFilters() {
  $("search").value = "";
  ui.chips = [];
  ui.status = "";
  $("statusFilter").value = "";
  saveUi();
  renderList();
}
$("clearFilters").addEventListener("click", clearFilters);

// Keyboard: / or Ctrl+K to search, arrows to move through results, Enter to open, Esc to clear.
document.addEventListener("keydown", (e) => {
  if (document.querySelector("dialog[open]")) return;
  const typing = e.target.matches?.("input, textarea, select") && e.target.id !== "search";
  if ((e.key === "/" && !typing && e.target.id !== "search") || (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey))) {
    e.preventDefault();
    $("search").focus();
    $("search").select();
    return;
  }
  if (typing) return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    if (!visibleIds.length) return;
    e.preventDefault();
    const i = visibleIds.indexOf(selectedId);
    const next = e.key === "ArrowDown" ? Math.min(visibleIds.length - 1, i + 1) : Math.max(0, i - 1);
    select(visibleIds[i < 0 ? 0 : next], { scroll: true });
  } else if (e.key === "Enter" && e.target.id === "search") {
    if (visibleIds.length && !visibleIds.includes(selectedId)) select(visibleIds[0], { scroll: true });
    $("search").blur();
  } else if (e.key === "Escape" && e.target.id === "search") {
    if ($("search").value) {
      $("search").value = "";
      renderList();
    } else $("search").blur();
  }
});

// ---------- detail ----------
// Saved data comes from public pages, so only web links become clickable.
const webUrl = (url) => (/^https?:\/\//i.test(url || "") ? url : "");
const link = (url, label) =>
  webUrl(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>` : esc(label);
const shortDate = (iso) => {
  const d = new Date(iso);
  return iso && !isNaN(d) ? d.toLocaleDateString() : "";
};
const copyBtn = (value) => `<button class="icon-btn" type="button" data-copy="${esc(value)}" title="Copy">⧉</button>`;

function acctList(title, items, open = false) {
  if (!items.length) return "";
  return `
    <details class="acct-list" ${open ? "open" : ""}>
      <summary>${esc(title)} (${items.length})</summary>
      <ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>
    </details>`;
}

function accountCard(a) {
  const lines = [];
  const lists = [];
  if (a.type === "github") {
    const act = a.activity || {};
    const stats = [
      act.totalCommits != null && `${act.totalCommits} commits`,
      act.repos?.length && `${act.repos.length} repos`,
      act.lastCommitAt && `last commit ${shortDate(act.lastCommitAt)}`,
    ].filter(Boolean);
    if (stats.length) lines.push(stats.join(" · "));
    if (a.topLanguages?.length) lines.push(a.topLanguages.map((l) => l.name || l).join(", "));
    if (a.bio) lines.push(a.bio);
    lists.push(
      acctList(
        "Projects",
        (a.projects || []).map(
          (p) =>
            `${link(p.url, p.name)}<span class="meta"> ${esc([p.language, p.stars ? `★ ${p.stars}` : ""].filter(Boolean).join(" · "))}</span>` +
            (p.description ? `<div class="meta">${esc(p.description)}</div>` : "")
        ),
        true
      ),
      acctList(
        "Repos committed to",
        (act.repos || []).map(
          (r) => `${link(r.url, r.name)}<span class="meta"> ${esc([r.commits != null ? `${r.commits} commits` : "", r.external ? "external" : ""].filter(Boolean).join(" · "))}</span>`
        )
      ),
      acctList(
        "Recent commits",
        (act.recentMessages || []).map(
          (m) => `${link(m.url, m.message)}<div class="meta">${esc([m.repo, shortDate(m.date)].filter(Boolean).join(" · "))}</div>`
        )
      )
    );
  }
  if (a.type === "stackoverflow") {
    if (a.reputation != null) lines.push(`${Number(a.reputation).toLocaleString()} reputation`);
    lists.push(
      acctList(
        "Top tags",
        (a.topTags || []).map(
          (t) => `${esc(t.tag || t.name || t)}<span class="meta"> ${esc([t.answers != null ? `${t.answers} answers` : "", t.score != null ? `score ${t.score}` : ""].filter(Boolean).join(" · "))}</span>`
        ),
        true
      )
    );
  }
  return `
    <div class="acct">
      <div class="acct-name">${link(a.url, ACCOUNT_LABELS[a.type] || a.type)}
        ${a.type === "github" && a.url ? `<button class="btn small" type="button" data-ghlookup="${esc(a.url)}" title="Search this GitHub account for email, Telegram, phone and websites">Find contact info</button>` : ""}</div>
      ${lines.map((l) => `<div class="meta">${esc(l)}</div>`).join("")}
      ${a.source ? `<div class="meta">Source: ${esc(a.source)}</div>` : ""}
      ${lists.join("")}
    </div>`;
}

function methodHref(m) {
  const value = String(m.value || "").trim();
  const handle = value.replace(/^@/, "");
  const digits = value.replace(/[^\d]/g, "");
  if (m.type === "email" || m.type === "outlook") return EMAIL_RE.test(value) ? `mailto:${value}` : "";
  if (m.type === "website") return webUrl(value) || (/^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(value) ? `https://${value}` : "");
  if (m.type === "phone" && digits) return `tel:+${digits}`;
  if (m.type === "whatsapp" && digits) return `https://wa.me/${digits}`;
  if (m.type === "x" && /^\w+$/.test(handle)) return `https://x.com/${handle}`;
  if (m.type === "telegram" && /^\w+$/.test(handle)) return `https://t.me/${handle}`;
  return "";
}

function chosenRecipient(c) {
  if (recipients[c.id] !== undefined) return recipients[c.id];
  const emails = emailsOf(c);
  return (emails.find((m) => m.chosen) || emails[0])?.value || "";
}

function contactCard(c) {
  const emails = emailsOf(c);
  const others = (c.methods || []).filter((m) => m.type !== "email" && m.type !== "outlook");
  const chosen = chosenRecipient(c);
  const isOther = chosen && !emails.some((m) => m.value === chosen);
  const option = (value, label, extra = "") => `
    <label class="rcpt ${value === chosen && !isOther ? "on" : ""}">
      <input type="radio" name="rcpt" value="${esc(value)}" ${value === chosen && !isOther ? "checked" : ""} />
      <span class="rcpt-main">${label}</span>${extra}
    </label>`;
  return `
    <div class="card">
      <h3>Contact details</h3>
      <div class="sub-h">Email ${emails.length ? "· choose who gets the email" : "· none saved yet"}</div>
      ${emails
        .map((m) =>
          option(m.value, esc(m.value), usedTag(m) + (m.confidence === "check" ? `<span class="tag warn" title="Found through a name search or on a page that may not be theirs: check before using">Check</span>` : "") + (m.source ? `<span class="csrc">${link(m.sourceUrl, m.source)}</span>` : "") + copyBtn(m.value))
        )
        .join("")}
      <label class="rcpt ${isOther ? "on" : ""}">
        <input type="radio" name="rcpt" value="__other" ${isOther ? "checked" : ""} />
        <input class="grow" id="otherEmail" placeholder="Other email…" value="${isOther ? esc(chosen) : ""}" />
      </label>
      ${option("", `<span class="meta">No recipient (fill in Gmail)</span>`)}

      ${
        others.length
          ? `<div class="sub-h">Other · ${others.length}</div>
             <ul class="methods">
               ${others
                 .map((m) => {
                   const href = methodHref(m);
                   return `<li>
                     <span class="mtype">${esc(METHOD_LABELS[m.type] || m.type)}</span>
                     <span class="mvalue">${href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(m.value)}</a>` : esc(m.value)}</span>
                     ${copyBtn(m.value)}
                     ${m.source ? `<span class="csrc">${link(m.sourceUrl, m.source)}</span>` : ""}
                   </li>`;
                 })
                 .join("")}
             </ul>`
          : ""
      }

      <div class="add-row">
        <select id="addType" aria-label="Detail type">
          <option value="">Auto-detect</option>
          ${Object.entries({ email: "Email", phone: "Phone", telegram: "Telegram", whatsapp: "WhatsApp", x: "X", skype: "Skype", discord: "Discord", website: "Website / link" })
            .map(([k, v]) => `<option value="${k}">${v}</option>`)
            .join("")}
        </select>
        <input class="grow" id="addValue" placeholder="Add an email, phone, @handle or link…" />
        <button class="btn" id="addDetailBtn" type="button">Add</button>
      </div>
    </div>`;
}

function draftCard(c) {
  const d = drafts[c.id];
  const sending = busy.has(c.id);
  return `
    <div class="card" id="emailCard">
      <h3>Email</h3>
      ${
        d
          ? `<div class="draft-fields">
               <input id="dSubject" value="${esc(d.subject)}" />
               <textarea id="dBody" rows="12">${esc(d.body)}</textarea>
             </div>`
          : `<p class="meta">Uses your email template (Settings). You can edit the text before opening Gmail.</p>`
      }
      <div class="actions">
        <button class="btn primary" id="sendBtn" ${sending ? "disabled" : ""}>
          ${sending ? "Preparing email…" : d ? "Open in Gmail" : "Write email"}
        </button>
        ${d ? `<button class="btn ghost" id="copyBtn">Copy</button><button class="btn ghost" id="redraftBtn" ${sending ? "disabled" : ""}>Reset to template</button>` : ""}
      </div>
    </div>`;
}

function renderDetail() {
  const c = current();
  if (!c) {
    $("detail").innerHTML = `<div class="empty">${
      contacts.length
        ? "Select a contact to see their details and send an email.<br><span class='meta'>Tip: press <kbd>/</kbd> to search, then <kbd>↑</kbd><kbd>↓</kbd> to move.</span>"
        : ""
    }</div>`;
    return;
  }
  const u = c.upwork || {};
  const facts = [u.location, u.rate, u.jobSuccess && `${u.jobSuccess} job success`, u.earned && `${u.earned} earned`, ...(u.badges || [])].filter(Boolean);
  const first = emailsOf(c)[0]?.value;
  const accounts = [
    u.url ? `<div class="acct"><div class="acct-name">${link(u.url, "Upwork profile")}</div></div>` : "",
    ...(c.accounts || []).map(accountCard),
  ].filter(Boolean);

  const avatar = avatarOf(c);
  $("detail").innerHTML = `
    <div class="d-head">
      ${avatar ? `<img class="detail-avatar" src="${esc(avatar)}" alt="${esc(c.name)}" loading="lazy" />` : ""}
      <div class="d-title">
        <h1>${esc(c.name)} <button class="icon-btn" id="editBtn" type="button" title="Edit name, title and location">✎</button></h1>
        ${u.title ? `<div class="sub">${esc(u.title)}</div>` : ""}
      </div>
      <div class="d-actions">
        <select id="statusSel" class="status-${esc(c.status)}" aria-label="Status">
          ${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}" ${k === c.status ? "selected" : ""}>${v}</option>`).join("")}
        </select>
        ${first ? `<button class="btn" type="button" data-copy="${esc(chosenRecipient(c) || first)}">Copy email</button>` : ""}
        <button class="btn primary" id="quickSend" type="button" ${busy.has(c.id) ? "disabled" : ""}>Email ${esc(String(c.name).split(/\s+/)[0])}</button>
      </div>
    </div>
    ${facts.length ? `<div class="facts">${facts.map((f) => `<span class="tag">${esc(f)}</span>`).join("")}</div>` : ""}
    ${u.skills?.length ? `<div class="facts">${u.skills.map((s) => `<span class="tag">${esc(s)}</span>`).join("")}</div>` : ""}

    ${contactCard(c)}
    ${draftCard(c)}

    <div class="card">
      <h3>Notes</h3>
      <textarea id="notes" rows="3" placeholder="Anything worth remembering — saved when you click away.">${esc(c.description || "")}</textarea>
    </div>

    ${accounts.length ? `<div class="card"><h3>Accounts</h3><div class="accounts">${accounts.join("")}</div></div>` : ""}

    <div class="actions">
      <span class="meta grow">${c.importedFrom ? `Added from ${esc(c.importedFrom)} · ` : ""}Updated ${new Date(c.updatedAt).toLocaleString()}</span>
      <button class="btn ghost danger" id="deleteBtn">Delete contact</button>
    </div>`;
}

// Keep edits to the draft while re-rendering.
function captureDraftEdits() {
  const d = drafts[selectedId];
  if (d && $("dSubject")) Object.assign(d, { subject: $("dSubject").value, body: $("dBody").value });
}

$("detail").addEventListener("change", async (e) => {
  const c = current();
  if (!c) return;
  if (e.target.id === "statusSel") {
    const status = e.target.value;
    e.target.className = "status-" + status;
    await updateContact(c.id, (x) => ({ ...x, status })).catch((err) => toast(err.message, true));
  }
  if (e.target.name === "rcpt") {
    if (e.target.value === "__other") {
      $("otherEmail").focus();
      recipients[c.id] = $("otherEmail").value.trim();
    } else recipients[c.id] = e.target.value;
    captureDraftEdits();
    renderDetail();
  }
});

$("detail").addEventListener("input", (e) => {
  if (e.target.id !== "otherEmail") return;
  recipients[selectedId] = e.target.value.trim();
  e.target.closest(".rcpt").querySelector("input[type=radio]").checked = true;
});

// Notes save when you leave the box.
$("detail").addEventListener(
  "blur",
  async (e) => {
    if (e.target.id !== "notes") return;
    const c = current();
    const value = e.target.value.trim();
    if (!c || value === (c.description || "")) return;
    try {
      await updateContact(c.id, (x) => ({ ...x, description: value }));
      toast("Notes saved");
    } catch (err) {
      toast(err.message, true);
    }
  },
  true
);

$("detail").addEventListener("keydown", (e) => {
  if (e.target.id === "addValue" && e.key === "Enter") {
    e.preventDefault();
    $("addDetailBtn").click();
  }
});

$("detail").addEventListener("click", async (e) => {
  const c = current();
  if (!c) return;
  const copy = e.target.closest("[data-copy]");
  if (copy) {
    e.preventDefault();
    await navigator.clipboard.writeText(copy.dataset.copy);
    return toast(`Copied ${copy.dataset.copy}`);
  }
  if (e.target.id === "quickSend" || e.target.id === "sendBtn") {
    if (e.target.id === "quickSend") $("emailCard")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return sendEmail(c);
  }
  if (e.target.id === "redraftBtn") {
    delete drafts[c.id];
    return sendEmail(c, { openGmail: false });
  }
  if (e.target.id === "copyBtn") {
    captureDraftEdits();
    const d = drafts[c.id];
    await navigator.clipboard.writeText(`Subject: ${d.subject}\n\n${d.body}`);
    return toast("Email copied");
  }
  const gl = e.target.closest("[data-ghlookup]");
  if (gl) return openGithubLookup(gl.dataset.ghlookup, c.id);
  if (e.target.id === "addDetailBtn") return addDetail(c);
  if (e.target.id === "editBtn") {
    $("eName").value = c.name || "";
    $("eTitle").value = c.upwork?.title || "";
    $("eLocation").value = c.upwork?.location || "";
    $("editDlg").returnValue = ""; // Esc keeps the old value, which mustn't count as Save
    return $("editDlg").showModal();
  }
  if (e.target.id === "deleteBtn" && confirm(`Delete ${c.name} permanently?`)) {
    await api(`/api/contacts/${encodeURIComponent(c.id)}`, { method: "DELETE" });
    const i = visibleIds.indexOf(c.id);
    contacts = contacts.filter((x) => x.id !== c.id);
    selectedId = null;
    renderList();
    if (visibleIds.length) select(visibleIds[Math.min(i, visibleIds.length - 1)]);
    else renderDetail();
  }
});

$("editDlg").addEventListener("close", async () => {
  const c = current();
  if ($("editDlg").returnValue !== "save" || !c) return;
  const name = $("eName").value.trim();
  const title = $("eTitle").value.trim();
  const location = $("eLocation").value.trim();
  if (!name) return;
  try {
    await updateContact(c.id, (x) => ({ ...x, name, upwork: { ...(x.upwork || {}), title, location } }));
    renderDetail();
    toast("Contact updated");
  } catch (err) {
    toast(err.message, true);
  }
});

async function addDetail(c) {
  const raw = $("addValue").value.trim();
  if (!raw) return;
  const forced = $("addType").value;
  const found = forced ? { kind: "method", type: forced, value: cleanValue(forced, raw) } : classify(raw);
  if (!found) return toast("Couldn't tell what that is — pick a type from the list", true);
  if (found.type === "email" && !EMAIL_RE.test(found.value)) return toast("That email looks invalid", true);
  const now = new Date().toISOString();
  const withDetail = (x) => {
    const next = { ...x, methods: x.methods || [], accounts: x.accounts || [], upwork: x.upwork || {} };
    return mergeInto(next, [found], "Added by you", now) ? next : null;
  };
  if (!withDetail(structuredClone(c))) return toast("Already saved on this contact");
  try {
    await updateContact(c.id, withDetail);
    $("addValue").value = "";
    renderDetail();
    toast(`${METHOD_LABELS[found.type] || ACCOUNT_LABELS[found.type] || "Detail"} added`);
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------- drafting & sending ----------
function draftPayload(c) {
  const u = c.upwork || {};
  return {
    profile: { name: c.name, title: u.title },
    sender: settings.sender,
  };
}

async function sendEmail(c, { openGmail = true } = {}) {
  const to = chosenRecipient(c);
  if (to && !EMAIL_RE.test(to)) return toast("That email looks invalid", true);
  captureDraftEdits();

  if (!drafts[c.id]) {
    busy.add(c.id);
    renderDetail();
    try {
      drafts[c.id] = await api("/draft", { method: "POST", body: draftPayload(c) });
    } catch (err) {
      toast(err.message, true);
      return;
    } finally {
      busy.delete(c.id);
      if (selectedId === c.id) renderDetail();
    }
  }
  if (!openGmail) return;

  const d = drafts[c.id];
  const gmail =
    "https://mail.google.com/mail/?view=cm&fs=1" +
    `&to=${encodeURIComponent(to)}&su=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}`;
  // The backend opens it in the topmost Google Chrome window, with that window's profile.
  let profile = null;
  try {
    profile = (await api("/api/open-gmail", { method: "POST", body: { url: gmail } })).profile;
  } catch (err) {
    toast(err.message, true);
    return;
  }

  // Remember the recipient on the contact (first in the list) and move the status along.
  const now = new Date().toISOString();
  await updateContact(c.id, (x) => {
    const methods = (x.methods || []).map((m) => {
      const chosen = !!to && m.value.toLowerCase() === to.toLowerCase();
      return { ...m, chosen, ...(chosen && { usedAt: now }) };
    });
    if (to && !methods.some((m) => m.chosen))
      methods.push({ type: "email", value: to, source: "Entered by you", verified: true, chosen: true, usedAt: now, addedAt: now });
    methods.sort((a, b) => (b.chosen ? 1 : 0) - (a.chosen ? 1 : 0));
    const status = x.status === "not_contacted" || !x.status ? "draft_opened" : x.status;
    return { ...x, methods, status };
  }).catch((err) => toast(err.message, true));
  delete recipients[c.id];
  if (selectedId === c.id) renderDetail();
  const where = profile?.email ? ` in ${profile.email}` : profile?.name ? ` in ${profile.name}` : "";
  toast((to ? `Gmail opened for ${to}` : "Gmail opened · add the recipient there") + where);
}

// ---------- reading contact details out of pasted text ----------
const RX = {
  email: /(?:mailto:)?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi,
  url: /\b(?:https?:\/\/|www\.|(?:github\.com|linkedin\.com|t\.me|telegram\.me|wa\.me|x\.com|twitter\.com|upwork\.com|stackoverflow\.com)\/)[^\s<>()"'`|]+/gi,
  labelled: /\b(telegram|tg|whatsapp|wa|skype|discord|twitter|x|phone|tel|mobile|cell|cellphone|call|text)\s*(?:id|handle|number|no\.?|#)?\s*[:=\-–—]\s*([^\s,;|]+(?:\s[\d()+.-]+)*)/gi,
  phone: /(?:\+|\b00)\d[\d\s().-]{6,18}\d/g,
};
const TYPE_OF_LABEL = {
  telegram: "telegram", tg: "telegram", whatsapp: "whatsapp", wa: "whatsapp", skype: "skype", discord: "discord",
  twitter: "x", x: "x", phone: "phone", tel: "phone", mobile: "phone", cell: "phone", cellphone: "phone", call: "phone", text: "phone",
};

function cleanValue(type, raw) {
  const v = String(raw).trim().replace(/[.,;:!?)\]]+$/, "");
  if (type === "email") return v.replace(/^mailto:/i, "").toLowerCase();
  if (type === "telegram" || type === "x") return "@" + v.replace(/^@/, "").replace(/^https?:\/\/(?:www\.)?(?:t\.me|telegram\.me|x\.com|twitter\.com)\//i, "");
  if (type === "phone" || type === "whatsapp") return v.replace(/[^\d+]/g, "").replace(/^00/, "+");
  return v;
}

// One value -> what kind of contact detail it is (or null).
function classify(raw) {
  const v = String(raw).trim().replace(/[.,;:!?)\]]+$/, "");
  if (EMAIL_RE.test(v.replace(/^mailto:/i, ""))) return { kind: "method", type: "email", value: cleanValue("email", v) };
  const url = /^(https?:\/\/|www\.)/i.test(v) ? (v.startsWith("www.") ? "https://" + v : v) : /^[\w-]+(\.[\w-]+)+\/\S*$/.test(v) ? "https://" + v : "";
  if (url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const parts = u.pathname.split("/").filter(Boolean);
    if (host === "github.com" && parts[0] && !["orgs", "topics", "search", "settings"].includes(parts[0]))
      return { kind: "account", type: "github", url: `https://github.com/${parts[0]}` };
    if (host.endsWith("linkedin.com") && parts[0] === "in" && parts[1]) return { kind: "account", type: "linkedin", url: `https://www.linkedin.com/in/${parts[1]}` };
    if (host === "stackoverflow.com" && parts[0] === "users" && parts[1]) return { kind: "account", type: "stackoverflow", url: `https://stackoverflow.com/users/${parts[1]}${parts[2] ? "/" + parts[2] : ""}` };
    if (host.endsWith("upwork.com") && /freelancers/.test(u.pathname)) return { kind: "upwork", type: "upwork", url: u.origin + u.pathname.replace(/\/+$/, "") };
    if ((host === "t.me" || host === "telegram.me") && parts[0]) return { kind: "method", type: "telegram", value: "@" + parts[0] };
    if (host === "wa.me" && /^\+?\d{7,15}$/.test(parts[0] || "")) return { kind: "method", type: "whatsapp", value: "+" + parts[0].replace(/^\+/, "") };
    if ((host === "x.com" || host === "twitter.com") && parts[0] && !["home", "i", "search", "intent"].includes(parts[0])) return { kind: "method", type: "x", value: "@" + parts[0] };
    if (/(^|\.)slack\.com$|slack-edge\.com$|slack-files\.com$/.test(host)) return null; // links back into Slack itself
    return { kind: "method", type: "website", value: u.href.replace(/\/$/, "") };
  }
  const digits = v.replace(/[^\d]/g, "");
  if (/^[+\d][\d\s().-]+$/.test(v) && digits.length >= 8 && digits.length <= 15) return { kind: "method", type: "phone", value: cleanValue("phone", v) };
  return null;
}

// Pulls every contact detail out of one chunk of text; returns them plus the text left over.
function extract(text) {
  const found = [];
  let rest = ` ${text} `;
  const take = (re, fn) => {
    rest = rest.replace(re, (...m) => {
      const item = fn(...m);
      if (item) found.push(item);
      return item ? " " : m[0];
    });
  };
  take(RX.email, (_, e) => ({ kind: "method", type: "email", value: cleanValue("email", e) }));
  take(RX.url, (u) => classify(u) || { skip: true });
  take(RX.labelled, (_, label, value) => {
    const type = TYPE_OF_LABEL[label.toLowerCase()];
    const v = cleanValue(type, value);
    if (type === "phone" || type === "whatsapp") return v.replace(/\D/g, "").length >= 7 ? { kind: "method", type, value: v } : null;
    return v.replace(/^@/, "").length >= 2 ? { kind: "method", type, value: v } : null;
  });
  take(RX.phone, (p) => {
    const v = cleanValue("phone", p);
    const n = v.replace(/\D/g, "").length;
    return n >= 8 && n <= 15 ? { kind: "method", type: "phone", value: v } : null;
  });
  return { found: found.filter((f) => !f.skip), rest };
}

const TIME_RE = /\b\d{1,2}:\d{2}(?:\s?[AP]M)?\b|\[\d{1,2}:\d{2}[^\]]*\]/gi;
const NAME_LABEL = /^(?:name|full name|contact|freelancer)\s*[:\-–—]\s*/i;
const TITLE_LABEL = /^(?:title|role|position|job|headline)\s*[:\-–—]\s*(.+)$/i;
const NOISE = /^(?:email|e-mail|mail|phone|tel|mobile|telegram|whatsapp|skype|discord|website|site|portfolio|github|linkedin|upwork|links?|contacts?|notes?)\s*[:\-–—]?\s*$/i;

// The text of a line that could be a name: no times, bullets, numbers or stray punctuation.
function nameText(l) {
  l = l.replace(TIME_RE, " ").replace(/^[\s>*•·\-–—\d.)]+/, "").replace(/\(.*?\)/g, " ").trim();
  return l
    .split(/\s[|•·—–-]\s|,|:|\t/)[0]
    .replace(/[^\p{L}\p{M}' .-]/gu, " ")
    .replace(/(^|\s)[-.']+(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const looksLikeName = (s) => /^(\p{Lu}[\p{L}\p{M}'.-]*)(\s\p{Lu}[\p{L}\p{M}'.-]*){0,3}$/u.test(s);

// The person's name: a "Name:" line, else a name written next to their details, else the first
// short line that reads like a name, else one made from the email or handle.
function guessName(lines, found, detailLines = []) {
  for (const l of lines) if (NAME_LABEL.test(l)) return l.replace(NAME_LABEL, "").trim();
  for (const l of detailLines) {
    const part = nameText(l);
    if (looksLikeName(part)) return part;
  }
  for (const l of lines) {
    const part = nameText(l);
    const words = part.split(" ").filter(Boolean);
    if (part.length >= 2 && words.length <= 5 && !NOISE.test(part) && /\p{L}{2}/u.test(part) && !/^(hi|hey|hello|thanks|here|this|these|please|from|re|fw|fwd|meeting|call)\b/i.test(part))
      return words.map((w) => (w === w.toLowerCase() ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
  }
  const email = found.find((f) => f.type === "email")?.value;
  const handle = found.find((f) => f.kind === "account")?.url?.split("/").pop() || found.find((f) => f.type === "telegram" || f.type === "x")?.value?.slice(1);
  const base = email ? email.split("@")[0] : handle || "";
  return base
    .replace(/[._\d-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function entryFrom(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const { found, rest } = extract(text);
  if (!found.length) return null;
  const titleLine = lines.map((l) => l.match(TITLE_LABEL)).find(Boolean);
  const restLines = rest.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // What's left of each line that had a detail on it ("Pat Q pat@q.com" -> "Pat Q").
  const detailLines = lines.map((l) => extract(l)).filter((x) => x.found.length).map((x) => x.rest.trim());
  return { name: guessName(restLines, found, detailLines) || "Unknown", title: titleLine ? titleLine[1].trim() : "", details: found };
}

// CSV / TSV with a header row: columns are matched by their names.
function parseTable(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  let delim;
  const split = (l) => {
    const out = [];
    let cur = "", q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (ch === delim && !q) (out.push(cur), (cur = ""));
      else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  // A real header: short column names including a contact column, and rows with the same number of cells.
  delim = ["\t", ",", ";"].find((d) => {
    delim = d;
    const cells = split(lines[0]);
    return (
      cells.length > 1 &&
      cells.every((h) => h.length <= 30) &&
      cells.some((h) => /^(full\s*)?name$|email|e-mail|phone|telegram|github|linkedin|whatsapp/i.test(h)) &&
      lines.slice(1).filter((l) => split(l).length === cells.length).length >= (lines.length - 1) * 0.6
    );
  });
  if (!delim) return null;
  const head = split(lines[0]).map((h) => h.toLowerCase());
  const col = (re) => head.findIndex((h) => re.test(h));
  const nameCol = col(/^(full\s*)?name$|^contact$/), firstCol = col(/first/), lastCol = col(/last|surname/), titleCol = col(/title|role|position|headline/);
  return lines.slice(1).map((l) => {
    const cells = split(l);
    const name = nameCol >= 0 ? cells[nameCol] : [cells[firstCol], cells[lastCol]].filter(Boolean).join(" ");
    const details = [];
    head.forEach((h, i) => {
      const v = cells[i];
      if (!v || i === nameCol || i === firstCol || i === lastCol || i === titleCol) return;
      const labelType = Object.entries(TYPE_OF_LABEL).find(([k]) => new RegExp(`\\b${k}\\b`).test(h))?.[1];
      // Several values in one cell are separated by , ; | (spaces belong to phone numbers).
      for (const part of v.split(/\s*[,;|]\s*|\s+(?=\S*(?:@|https?:|www\.))/).filter(Boolean)) {
        const f = labelType && !/^https?:|^www\./i.test(part) && !EMAIL_RE.test(part) ? { kind: "method", type: labelType, value: cleanValue(labelType, part) } : classify(part);
        if (f) details.push(f);
      }
    });
    return details.length ? { name: name || guessName([], details), title: titleCol >= 0 ? cells[titleCol] || "" : "", details } : null;
  }).filter(Boolean);
}

// Text -> entries. Blank lines separate people; a block with several "name + detail" lines is a list, one per line.
function parsePaste(text) {
  const table = parseTable(text);
  if (table?.length) return table;
  const entries = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split(/\r?\n/).filter((l) => l.trim());
    const withDetails = lines.map((l) => ({ l, ...extract(l) })).filter((x) => x.found.length);
    const perLine =
      withDetails.length >= 2 &&
      withDetails.every((x) => /\p{L}{2}/u.test(x.rest.replace(TIME_RE, "").replace(/\b(email|phone|telegram|whatsapp|tel|mobile)\b/gi, ""))) &&
      new Set(withDetails.flatMap((x) => x.found.filter((f) => f.type === "email").map((f) => f.value))).size >= 2;
    if (perLine) for (const x of withDetails) entries.push(entryFrom(x.l));
    else entries.push(entryFrom(block));
  }
  return mergeEntries(entries.filter(Boolean));
}

const keyOf = (d) =>
  d.kind === "account" || d.kind === "upwork" ? "url:" + d.url.toLowerCase().replace(/\/+$/, "").replace("://www.", "://") : `${d.type === "outlook" ? "email" : d.type}:${String(d.value).toLowerCase().replace(/[\s()-]/g, "")}`;

// Same person pasted twice (shared email, link or handle) -> one entry.
function mergeEntries(entries) {
  const out = [];
  for (const e of entries) {
    const keys = new Set(e.details.map(keyOf));
    const twin = out.find((o) => o.details.some((d) => keys.has(keyOf(d))));
    if (!twin) out.push({ ...e, details: [...new Map(e.details.map((d) => [keyOf(d), d])).values()] });
    else {
      for (const d of e.details) if (!twin.details.some((x) => keyOf(x) === keyOf(d))) twin.details.push(d);
      if (!twin.title) twin.title = e.title;
    }
  }
  return out;
}

function contactKeys(c) {
  const keys = new Set();
  for (const m of c.methods || []) keys.add(keyOf({ kind: "method", type: m.type, value: m.value }));
  for (const a of c.accounts || []) if (a.url) keys.add(keyOf({ kind: "account", url: a.url }));
  if (c.upwork?.url) keys.add(keyOf({ kind: "upwork", url: c.upwork.url }));
  return keys;
}

// Adds details a contact doesn't have yet; returns how many were new.
function mergeInto(c, details, source, now) {
  const have = contactKeys(c);
  let added = 0;
  for (const d of details) {
    const k = keyOf(d);
    if (have.has(k)) continue;
    have.add(k);
    added++;
    if (d.kind === "method") c.methods.push({ type: d.type, value: d.value, source, sourceUrl: "", verified: false, addedAt: now });
    else if (d.kind === "account") c.accounts.push({ type: d.type, url: d.url, source, confidence: "medium", verified: false, lastVerified: now });
    else if (d.kind === "upwork") c.upwork = { ...c.upwork, url: d.url };
  }
  return added;
}

// ---------- add contacts dialog ----------
let preview = []; // [{ entry, match, newCount, include }]

$("addBtn").addEventListener("click", () => {
  $("previewBox").hidden = true;
  $("addSave").disabled = true;
  $("addDlg").showModal();
  $("pasteText").focus();
});
$("addCancel").addEventListener("click", () => $("addDlg").close());
$("pasteText").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) $("parseBtn").click();
});

$("parseBtn").addEventListener("click", () => {
  const entries = parsePaste($("pasteText").value);
  const keyed = contacts.map((c) => ({ c, keys: contactKeys(c) }));
  preview = entries.map((entry) => {
    const keys = entry.details.map(keyOf);
    const match = keyed.find((k) => keys.some((x) => k.keys.has(x)))?.c || null;
    const newCount = match ? keys.filter((x) => !contactKeys(match).has(x)).length : keys.length;
    return { entry, match, newCount, include: !match || newCount > 0 };
  });
  renderPreview();
});

function renderPreview() {
  $("previewBox").hidden = false;
  const fresh = preview.filter((p) => !p.match).length;
  const updates = preview.filter((p) => p.match && p.newCount).length;
  const same = preview.length - fresh - updates;
  $("previewTitle").textContent = preview.length
    ? `Found ${preview.length}: ${fresh} new, ${updates} to update${same ? `, ${same} already saved` : ""}`
    : "No emails, phone numbers, handles or links found in that text.";
  $("previewList").innerHTML = preview
    .map((p, i) => {
      const status = !p.match ? `<span class="tag ok">New</span>` : p.newCount ? `<span class="tag info">Adds ${p.newCount} to ${esc(p.match.name)}</span>` : `<span class="tag">Already saved as ${esc(p.match.name)}</span>`;
      return `
      <li class="${p.include ? "" : "off"}">
        <input type="checkbox" data-pi="${i}" ${p.include ? "checked" : ""} ${p.match && !p.newCount ? "disabled" : ""} aria-label="Include" />
        <div class="pv-main">
          <div class="pv-top">
            ${p.match ? `<strong>${esc(p.match.name)}</strong>` : `<input class="pv-name" data-pn="${i}" value="${esc(p.entry.name)}" aria-label="Name" />`}
            ${status}
          </div>
          <div class="pv-details">
            ${p.entry.details
              .map((d) => `<span class="tag"><b>${esc(METHOD_LABELS[d.type] || ACCOUNT_LABELS[d.type] || (d.type === "upwork" ? "Upwork" : d.type))}</b> ${esc(d.value || d.url.replace(/^https?:\/\/(www\.)?/, ""))}</span>`)
              .join("")}
          </div>
        </div>
      </li>`;
    })
    .join("");
  const n = preview.filter((p) => p.include).length;
  $("previewAll").checked = n === preview.filter((p) => !(p.match && !p.newCount)).length && n > 0;
  $("addSave").disabled = !n;
  $("addSave").textContent = n ? `Save ${n} contact${n > 1 ? "s" : ""}` : "Add contacts";
}

$("previewList").addEventListener("change", (e) => {
  const i = e.target.dataset.pi;
  if (i !== undefined) {
    preview[+i].include = e.target.checked;
    renderPreview();
  }
});
$("previewList").addEventListener("input", (e) => {
  const i = e.target.dataset.pn;
  if (i !== undefined) preview[+i].entry.name = e.target.value;
});
$("previewAll").addEventListener("change", (e) => {
  for (const p of preview) if (!(p.match && !p.newCount)) p.include = e.target.checked;
  renderPreview();
});

$("addSave").addEventListener("click", async () => {
  const source = $("pasteSource").value.trim() || "Pasted";
  const now = new Date().toISOString();
  const out = [];
  for (const p of preview.filter((x) => x.include)) {
    if (p.match) {
      const c = { ...p.match, methods: [...(p.match.methods || [])], accounts: [...(p.match.accounts || [])], upwork: { ...(p.match.upwork || {}) }, updatedAt: now };
      if (mergeInto(c, p.entry.details, source, now)) out.push(c);
    } else {
      const c = {
        id: crypto.randomUUID(),
        name: p.entry.name.trim() || "Unknown",
        description: "",
        upwork: p.entry.title ? { title: p.entry.title } : {},
        accounts: [],
        methods: [],
        status: "not_contacted",
        importedFrom: source,
        createdAt: now,
        updatedAt: now,
      };
      mergeInto(c, p.entry.details, source, now);
      out.push(c);
    }
  }
  try {
    $("addSave").disabled = true;
    const res = await api("/api/contacts/sync", { method: "POST", body: { contacts: out } });
    $("addDlg").close();
    $("pasteText").value = "";
    clearFilters();
    await load();
    const firstNew = out.find((c) => c.importedFrom === source && c.createdAt === now);
    if (firstNew) select(firstNew.id, { scroll: true });
    toast(`Saved · ${res.added} new, ${res.updated} updated`);
  } catch (err) {
    $("addSave").disabled = false;
    toast("Couldn't save: " + err.message, true);
  }
});

// ---------- GitHub lookup ----------
// Runs the extension's GitHub research (profile, README, own-commit emails, linked websites) on the backend.
let gh = null; // { github, contacts, sitesChecked, match, include: [bool] }
let ghTarget = null; // contact id when started from a contact's GitHub account
let ghTicker = null;
const ghLogin = (url) => (/github\.com\/([A-Za-z0-9-]+)/i.exec(url || "")?.[1] || "").toLowerCase();
const hasValue = (c, v) => (c?.methods || []).some((m) => String(m.value).toLowerCase() === String(v).toLowerCase());

function openGithubLookup(url = "", targetId = null) {
  gh = null;
  ghTarget = targetId;
  $("ghUrl").value = url;
  $("ghResult").hidden = true;
  $("ghResult").innerHTML = "";
  $("ghProgress").hidden = true;
  $("ghSave").disabled = true;
  $("ghSave").textContent = "Save contact";
  $("ghNote").textContent = "";
  $("ghDlg").showModal();
  if (url) runGithubLookup();
  else $("ghUrl").focus();
}
$("ghBtn").addEventListener("click", () => openGithubLookup());
$("ghCancel").addEventListener("click", () => $("ghDlg").close());
$("ghFind").addEventListener("click", () => runGithubLookup());
$("ghUrl").addEventListener("keydown", (e) => {
  if (e.key === "Enter") e.preventDefault(), runGithubLookup();
});

async function runGithubLookup() {
  const url = $("ghUrl").value.trim();
  if (!url) return $("ghUrl").focus();
  const steps = ["Reading the GitHub profile…", "Checking the email on their commits…", "Reading their profile README…", "Searching their websites…", "Almost done…"];
  let step = 0;
  $("ghProgressText").textContent = steps[0];
  $("ghProgress").hidden = false;
  $("ghResult").hidden = true;
  $("ghFind").disabled = $("ghSave").disabled = true;
  clearInterval(ghTicker);
  ghTicker = setInterval(() => ($("ghProgressText").textContent = steps[Math.min(++step, steps.length - 1)]), 2500);
  try {
    const r = await api("/api/lookup/github", { method: "POST", body: { url } });
    const login = (r.github.login || "").toLowerCase();
    const match =
      (ghTarget && contacts.find((c) => c.id === ghTarget)) ||
      contacts.find((c) => (c.accounts || []).some((a) => a.type === "github" && ghLogin(a.url) === login)) ||
      contacts.find((c) => r.contacts.some((x) => x.type === "email" && hasValue(c, x.value))) ||
      null;
    gh = { ...r, match, include: r.contacts.map((x) => !hasValue(match, x.value)) };
    renderGithubResult();
  } catch (err) {
    $("ghResult").innerHTML = `<p class="gh-error">${esc(err.message)}</p>`;
    $("ghResult").hidden = false;
  } finally {
    clearInterval(ghTicker);
    $("ghProgress").hidden = true;
    $("ghFind").disabled = false;
  }
}

function renderGithubResult() {
  const { github: g, contacts: found, match } = gh;
  const act = g.activity;
  const facts = [
    g.location,
    g.company,
    g.followers != null && `${compactNum(g.followers)} followers`,
    g.publicRepos != null && `${g.publicRepos} repos`,
    act?.lastCommitAt && `last commit ${ago(act.lastCommitAt)}`,
    g.timezone,
    g.hireable && "open to hire",
  ].filter(Boolean);
  const fresh = found.filter((x) => !hasValue(match, x.value)).length;
  $("ghResult").innerHTML = `
    <div class="gh-card">
      <img class="gh-avatar" src="https://github.com/${encodeURIComponent(g.login)}.png?size=96" alt="" loading="lazy" />
      <div class="gh-info">
        <div class="gh-name">${esc(g.name || g.login)} <a href="${esc(g.url)}" target="_blank" rel="noopener" class="meta">@${esc(g.login)}</a></div>
        ${g.bio ? `<div class="meta">${esc(g.bio)}</div>` : ""}
        <div class="facts">${facts.map((f) => `<span class="tag">${esc(f)}</span>`).join("")}${(g.topLanguages || []).map((l) => `<span class="tag info">${esc(l)}</span>`).join("")}</div>
      </div>
    </div>
    <div class="gh-target">
      ${
        match
          ? `<span class="tag info">Already saved</span> Adds to <strong>${esc(match.name)}</strong>${fresh ? "" : " · nothing new found"}`
          : `<span class="tag ok">New contact</span> <label class="field inline grow"><span>Name</span><input id="ghName" value="${esc(g.name || g.login)}" /></label>`
      }
    </div>
    <div class="preview-head"><strong>${found.length ? `Found ${found.length} detail${found.length > 1 ? "s" : ""}` : "No email, phone, Telegram or website found on this account"}</strong>
      ${gh.sitesChecked.length ? `<span class="meta">Websites checked: ${esc(gh.sitesChecked.join(", "))}</span>` : ""}</div>
    <ul class="preview gh-list">
      ${found
        .map((x, i) => {
          const saved = hasValue(match, x.value);
          return `<li class="${gh.include[i] ? "" : "off"}" style="--i:${i}">
            <input type="checkbox" data-gi="${i}" ${gh.include[i] ? "checked" : ""} ${saved ? "disabled" : ""} aria-label="Include" />
            <div class="pv-main">
              <div class="pv-top"><span class="mtype">${esc(METHOD_LABELS[x.type] || x.type)}</span> <strong>${esc(x.value)}</strong>
                ${saved ? `<span class="tag">Saved</span>` : x.confidence === "check" ? `<span class="tag warn" title="Found on a page that may not be theirs, or in a commit message: check before using">Check</span>` : ""}</div>
              <div class="meta">${link(x.sourceUrl, x.source)}</div>
            </div>
          </li>`;
        })
        .join("")}
    </ul>`;
  $("ghResult").hidden = false;
  const n = gh.include.filter(Boolean).length;
  const accountNew = !match || !(match.accounts || []).some((a) => a.type === "github");
  $("ghSave").disabled = !n && !accountNew && !!match;
  $("ghSave").textContent = match ? (n ? `Add ${n} to ${match.name}` : "Update GitHub details") : "Save contact";
  $("ghNote").textContent = found.some((x) => /commits/.test(x.source)) ? "Commit emails: keep messages personal." : "";
}

$("ghResult").addEventListener("change", (e) => {
  const i = e.target.dataset.gi;
  if (i === undefined) return;
  gh.include[+i] = e.target.checked;
  e.target.closest("li").classList.toggle("off", !e.target.checked);
  const n = gh.include.filter(Boolean).length;
  if (gh.match) $("ghSave").textContent = n ? `Add ${n} to ${gh.match.name}` : "Update GitHub details";
});

$("ghSave").addEventListener("click", async () => {
  if (!gh) return;
  const { github: g, match } = gh;
  const now = new Date().toISOString();
  const account = {
    type: "github", url: g.url, source: "GitHub lookup in Contacts app", confidence: "high", verified: true, lastVerified: now,
    bio: g.bio, topLanguages: g.topLanguages, projects: g.projects, activity: g.activity,
  };
  const picked = gh.contacts.filter((_, i) => gh.include[i]);
  const methods = (list) => {
    const out = [...(list || [])];
    for (const x of picked)
      if (!out.some((m) => String(m.value).toLowerCase() === x.value.toLowerCase()))
        out.push({ type: x.type, value: x.value, source: x.source, sourceUrl: x.sourceUrl || "", confidence: x.confidence, verified: false, addedAt: now });
    return out;
  };
  let c;
  if (match) {
    const accts = [...(match.accounts || [])];
    const i = accts.findIndex((a) => a.type === "github" && ghLogin(a.url) === g.login.toLowerCase());
    if (i >= 0) accts[i] = { ...accts[i], ...account, source: accts[i].source || account.source };
    else if (!accts.some((a) => a.type === "github")) accts.push(account);
    c = { ...match, accounts: accts, methods: methods(match.methods), updatedAt: now };
  } else {
    c = {
      id: crypto.randomUUID(),
      name: ($("ghName")?.value || "").trim() || g.name || g.login,
      description: "",
      upwork: { location: g.location || "", title: g.bio && g.bio.length <= 120 ? g.bio : "" },
      accounts: [account],
      methods: methods([]),
      status: "not_contacted",
      importedFrom: "GitHub lookup",
      createdAt: now,
      updatedAt: now,
    };
  }
  try {
    $("ghSave").disabled = true;
    await api("/api/contacts/sync", { method: "POST", body: { contacts: [c] } });
    $("ghDlg").close();
    await load();
    if (!visibleIds.includes(c.id)) clearFilters();
    select(c.id, { scroll: true });
    toast(match ? `${c.name} updated · ${picked.length} detail${picked.length === 1 ? "" : "s"} added` : `${c.name} saved · ${picked.length} detail${picked.length === 1 ? "" : "s"}`);
  } catch (err) {
    $("ghSave").disabled = false;
    toast("Couldn't save: " + err.message, true);
  }
});

function compactNum(n) {
  return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : String(n ?? 0);
}
function ago(iso) {
  const d = (Date.now() - new Date(iso)) / DAY;
  if (isNaN(d)) return "";
  if (d < 1) return "today";
  if (d < 30) return `${Math.round(d)}d ago`;
  if (d < 365) return `${Math.round(d / 30)}mo ago`;
  return `${(d / 365).toFixed(1)}y ago`;
}

// ---------- find missing emails (bulk, runs on the backend) ----------
let findStatus = null;
let findTimer = null;
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function renderFind() {
  const s = findStatus;
  if (!s) return;
  const j = s.job;
  const running = !!j?.running;
  $("findBadge").hidden = !running;
  $("findBadge").textContent = running && j.total ? `${Math.round((j.done / j.total) * 100)}%` : "";
  $("findIntro").innerHTML =
    `<b>${s.missing}</b> contact${s.missing === 1 ? " has" : "s have"} no email. ${s.withGithub} of them have a GitHub account, which is searched like ` +
    `<b>GitHub lookup</b>. For the rest, their GitHub account is found by name and used only when exactly one person matches; ` +
    `those emails are marked <span class="tag warn">Check</span>. Results are saved as they come in, and the search keeps going if you close this.`;
  $("findStats").innerHTML = j
    ? [
        ["Checked", `${j.done} / ${j.total}`],
        ["Got an email", j.withEmail],
        ["Details added", j.details],
        ["Found by name", j.byName],
      ]
        .map(([k, v]) => `<div class="stat"><div class="stat-v">${esc(v)}</div><div class="stat-k">${k}</div></div>`)
        .join("")
    : "";
  $("findProgress").hidden = !j;
  if (j) $("findBar").style.width = `${j.total ? (j.done / j.total) * 100 : 100}%`;
  $("findProgress").classList.toggle("waiting", !!j?.waitingUntil);
  $("findNow").textContent = !j
    ? ""
    : j.waitingUntil
      ? `GitHub's hourly limit is used up — continuing at ${fmtTime(j.waitingUntil)}${s.hasToken ? "" : ". A GitHub token in Settings avoids most waits"}.`
      : running
        ? `Searching ${j.current || "…"}`
        : j.error
          ? `Stopped with an error: ${j.error}`
          : `${j.stopped ? "Stopped" : "Finished"} at ${fmtTime(j.finishedAt)}.`;
  $("findStart").hidden = running;
  $("findStop").hidden = !running;
  $("findRecheck").parentElement.hidden = running || !s.checkedRecently;
  $("findStart").textContent = j && !running ? "Search again" : "Start";
  $("findStart").disabled = !s.missing;
  $("findNote").textContent = s.checkedRecently && !running ? `${s.checkedRecently} were checked in the last 30 days and are skipped.` : "";
}

async function pollFind() {
  clearTimeout(findTimer);
  const wasRunning = findStatus?.job?.running;
  findStatus = await api("/api/find-emails").catch(() => findStatus);
  renderFind();
  if (wasRunning && !findStatus?.job?.running) {
    await load().catch(() => {});
    const j = findStatus.job;
    toast(`Find emails ${j.stopped ? "stopped" : "finished"} · ${j.withEmail} contact${j.withEmail === 1 ? "" : "s"} got an email`);
  }
  // Fast while the dialog is open, slower in the background; keeps the list fresh as results arrive.
  if (findStatus?.job?.running) findTimer = setTimeout(pollFind, $("findDlg").open ? 1200 : 5000);
  if (findStatus?.job?.running && !$("findDlg").open && !document.querySelector("dialog[open]") && !pendingSaves) {
    const fresh = await api("/api/contacts").catch(() => null);
    if (fresh && JSON.stringify(fresh) !== JSON.stringify(contacts)) (contacts = fresh), renderList();
  }
}

$("findBtn").addEventListener("click", async () => {
  $("findDlg").showModal();
  await pollFind();
});
$("findClose").addEventListener("click", () => $("findDlg").close());
$("findStart").addEventListener("click", async () => {
  $("findStart").disabled = true;
  findStatus = await api("/api/find-emails", { method: "POST", body: { recheck: $("findRecheck").checked } }).catch((e) => (toast(e.message, true), findStatus));
  renderFind();
  pollFind();
});
$("findStop").addEventListener("click", async () => {
  findStatus = await api("/api/find-emails/stop", { method: "POST", body: {} }).catch(() => findStatus);
  renderFind();
});

// ---------- import JSON ----------
$("importFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try {
    const res = await api("/api/contacts/sync", { method: "POST", body: JSON.parse(await file.text()) });
    toast(`Imported · ${res.added} new, ${res.updated} updated`);
    await load();
  } catch (err) {
    toast("Import failed: " + err.message, true);
  }
});

// ---------- settings ----------
$("settingsBtn").addEventListener("click", () => {
  $("sSender").value = settings.sender || "";
  $("sSubject").value = settings.subjectTemplate || "";
  $("sBody").value = settings.bodyTemplate || "";
  $("sGithubToken").value = settings.githubToken || "";
  $("settingsDlg").showModal();
});
$("sReset").addEventListener("click", () => {
  $("sSubject").value = settings.defaults?.subjectTemplate || "";
  $("sBody").value = settings.defaults?.bodyTemplate || "";
});
$("sSave").addEventListener("click", async () => {
  try {
    const defaults = settings.defaults;
    settings = await api("/api/settings", {
      method: "PUT",
      body: { sender: $("sSender").value, subjectTemplate: $("sSubject").value, bodyTemplate: $("sBody").value, githubToken: $("sGithubToken").value.trim() },
    });
    settings.defaults = defaults;
    // New settings change the email, so drop old drafts.
    for (const k of Object.keys(drafts)) delete drafts[k];
    renderDetail();
    toast("Settings saved");
  } catch (err) {
    toast(err.message, true);
  }
});

// For tests: the paste reader without the page around it.
window.__outreach = { parsePaste, classify, parseQuery };

// ---------- start ----------
(async () => {
  try {
    settings = await api("/api/settings");
    await load();
    pollFind(); // a search started earlier may still be running
  } catch (err) {
    toast(err.message, true);
  }
  // Pick up contacts the extension syncs while this page is open.
  setInterval(async () => {
    if (document.hidden || busy.size || pendingSaves || document.querySelector("dialog[open]")) return;
    const fresh = await api("/api/contacts").catch(() => null);
    $("offlineBanner").hidden = !!fresh;
    if (!fresh || pendingSaves) return; // a save started while this was loading
    extensionSync = (await api("/api/status").catch(() => null))?.extensionSync ?? extensionSync;
    if (JSON.stringify(fresh) !== JSON.stringify(contacts)) {
      contacts = fresh;
      renderList();
      if (!document.activeElement?.matches("input, textarea, select")) {
        captureDraftEdits();
        renderDetail();
      }
    } else renderCountLine(); // keeps the extension sync note current
  }, 5000);
})();
