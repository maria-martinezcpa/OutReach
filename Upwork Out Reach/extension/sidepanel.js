// timeAgo() / compactNumber() come from insights.js (classic script).
import { listContacts, getContact, putContact, deleteContact, syncContacts } from "./db.js";

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

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
const ACCOUNT_LABELS = { github: "GitHub", stackoverflow: "Stack Overflow", linkedin: "LinkedIn", portfolio: "Portfolio" };
const DEFAULT_SETTINGS = {
  backend: "http://localhost:8787",
  sender: "",
  githubToken: "",
  concurrency: 2,
  checkWebsites: false,
};

let run = null;

// ---------- helpers ----------
function toast(msg, isError = false) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast show" + (isError ? " error" : "");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.className = "toast"), 2800);
}

async function send(type, extra = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...extra });
  if (!res?.ok) throw new Error(res?.error || "Something went wrong");
  return res.data;
}

// ---------- tabs ----------
document.querySelectorAll(".tab").forEach((tab) =>
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + tab.dataset.tab));
    if (tab.dataset.tab === "contacts") renderContacts();
  })
);

// ---------- research run ----------
$("startBtn").addEventListener("click", async () => {
  const btn = $("startBtn");
  btn.disabled = true;
  try {
    if (run?.status === "running") {
      await send("stop");
    } else if (canResume()) {
      await send("resume");
    } else {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url?.startsWith("https://www.upwork.com/")) throw new Error("Open an Upwork talent search page in this tab first.");
      const n = await send("start", { tabId: tab.id, auto: $("autoPages").checked });
      toast(`Checking ${n} freelancers in the background`);
    }
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
  }
});

// Stopped with freelancers left on this page, or an automatic run that can go on to the next page.
const canResume = () => run?.status === "stopped" && (run.auto || run.items.some((i) => i.state === "queued"));

try {
  $("autoPages").checked = localStorage.getItem("autoPages") !== "0";
} catch {}
$("autoPages").addEventListener("change", () => {
  try {
    localStorage.setItem("autoPages", $("autoPages").checked ? "1" : "0");
  } catch {}
});

// email (lowercase) -> when Gmail was opened for it; kept current by syncContacts().
let usedEmails = {};
chrome.storage.local.get("usedEmails").then(({ usedEmails: u }) => {
  usedEmails = u || {};
  renderRun();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.usedEmails) return;
  usedEmails = changes.usedEmails.newValue || {};
  renderRun();
  if ($("view-contacts").classList.contains("active")) renderContacts();
});
function usedBadge(email) {
  const at = usedEmails[String(email || "").toLowerCase()];
  return at
    ? `<span class="conf used" title="Gmail opened ${esc(new Date(at).toLocaleString())}">Used · ${esc(new Date(at).toLocaleDateString())}</span>`
    : `<span class="conf unused">Not used</span>`;
}

$("clearBtn").addEventListener("click", () => send("clear").catch((e) => toast(e.message, true)));
// Default: show only freelancers with GitHub or Stack Overflow (remembered per browser).
try {
  $("onlyAccounts").checked = localStorage.getItem("onlyAccounts") !== "0";
} catch {}
$("onlyAccounts").addEventListener("change", () => {
  try {
    localStorage.setItem("onlyAccounts", $("onlyAccounts").checked ? "1" : "0");
  } catch {}
  renderRun();
});

function hasAccount(i) {
  return !!(i.accounts?.github?.url || i.accounts?.stackoverflow?.url);
}

function renderRun() {
  const items = run?.items || [];
  const finished = items.filter((i) => !["queued", "checking"].includes(i.state)).length;
  const withGh = items.filter((i) => i.accounts?.github?.url).length;
  const withSo = items.filter((i) => i.accounts?.stackoverflow?.url).length;

  const startBtn = $("startBtn");
  startBtn.innerHTML =
    run?.status === "running"
      ? `<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1"/></svg> Stop`
      : canResume()
      ? `<svg viewBox="0 0 24 24"><path d="M6 4l14 8-14 8z"/></svg> Resume`
      : `<svg viewBox="0 0 24 24"><path d="M6 4l14 8-14 8z"/></svg> ${run ? "Start again on this page" : "Start"}`;
  startBtn.classList.toggle("stop", run?.status === "running");
  $("runHint").classList.toggle("hidden", !!run);
  $("autoBox").classList.toggle("hidden", run?.status === "running");

  $("progressBox").classList.toggle("hidden", !run);
  $("filterBox").classList.toggle("hidden", !run);
  if (run) {
    $("progressFill").style.width = items.length ? (finished / items.length) * 100 + "%" : "0";
    const t = run.totals;
    $("progressText").textContent =
      (run.auto ? `Page ${run.page} · ` : "") +
      `${finished}/${items.length} checked · ${withGh} GitHub · ${withSo} Stack Overflow` +
      (run.loading ? ` · opening page ${run.loading}…` : "") +
      (run.status === "done" ? " · done" : run.status === "stopped" ? " · stopped" : "") +
      (run.auto && t && run.pages > 1
        ? ` — ${run.pages} pages so far: ${t.checked + finished} checked, ${t.github + withGh} GitHub, ${t.stackoverflow + withSo} Stack Overflow`
        : "");
  }
  $("runNotice").textContent = run?.notice || "";
  $("runNotice").classList.toggle("hidden", !run?.notice);

  const only = $("onlyAccounts").checked;
  // While filtering, keep in-progress rows visible so you can see the run moving.
  const visible = items.map((it, idx) => ({ it, idx })).filter(({ it }) => !only || hasAccount(it) || it.state === "checking");
  const hidden = items.filter((i) => i.state === "done" || i.state === "error" || i.state === "no_link").filter((i) => !hasAccount(i)).length;
  $("runList").innerHTML =
    visible.map(({ it, idx }) => renderItem(it, idx)).join("") +
    (only && hidden ? `<li class="hidden-note">${hidden} without GitHub or Stack Overflow hidden</li>` : "") +
    (only && run && !visible.length && run.status !== "running" ? `<li class="hidden-note">No GitHub or Stack Overflow accounts found on this page.</li>` : "");
}

function renderItem(it, idx) {
  const p = it.profile || it.card;
  const a = it.accounts || {};
  const done = it.state === "done";
  const stats = [p.rate, p.jobSuccess && p.jobSuccess + " JSS", p.earned && p.earned + " earned"].filter(Boolean).join(" · ");

  const chips = [];
  if (a.github?.url) {
    const act = a.github.activity;
    chips.push(
      `<a class="chip ok" href="${esc(a.github.url)}" target="_blank" title="${esc(a.github.source || "")}">GitHub${a.github.source?.includes("Stack Overflow") ? " (via SO)" : ""}${act ? ` · ${compactNumber(act.totalCommits)} commits · ${esc(timeAgo(act.lastCommitAt))}` : ""}</a>`
    );
    if (a.github.topLanguages?.length) chips.push(`<span class="chip">${esc(a.github.topLanguages.slice(0, 3).join(", "))}</span>`);
  } else if (done) chips.push(`<span class="chip off">${a.mentions?.github ? "GitHub mentioned" : "No GitHub"}</span>`);
  if (a.stackoverflow?.url) {
    chips.push(
      `<a class="chip ok" href="${esc(a.stackoverflow.url)}" target="_blank">Stack Overflow${a.stackoverflow.reputation != null ? ` · ${compactNumber(a.stackoverflow.reputation)} rep` : ""}</a>`
    );
  } else if (done) chips.push(`<span class="chip off">${a.mentions?.stackoverflow ? "SO mentioned" : "No Stack Overflow"}</span>`);

  const state = {
    queued: `<span class="state">Queued</span>`,
    checking: `<span class="state busy">Checking…</span>`,
    error: `<span class="state err" title="${esc(it.error)}">Error</span>`,
    no_link: `<span class="state">No profile link</span>`,
    done: it.saved
      ? it.savedAs === "email" ? `<span class="state ok">Saved</span>`
        : it.savedAs === "websites" ? `<span class="state ok">Saved · websites only</span>`
        : `<span class="state ok">Saved · no email</span>`
      : it.sent ? `<span class="state">Not saved · nothing found</span>`
      : "",
  }[it.state] + (it.cached ? ` <span class="state" title="Researched in an earlier run — not searched again">Checked before</span>` : "");

  return `
    <li class="card run-item ${done && hasAccount(it) ? "has-acc" : ""}">
      <div>
        <div class="name">${esc(p.name)} ${state}</div>
        <div class="desc">${esc(p.title)}</div>
        ${stats ? `<div class="meta">${esc(stats)}</div>` : ""}
      </div>
      ${chips.length ? `<div class="chips">${chips.join("")}</div>` : ""}
      ${done ? renderEmailPicker(it, idx) : ""}
      ${it.error && done ? `<div class="err-text">${esc(it.error)}</div>` : ""}
      ${
        done
          ? `<button class="btn ${it.sent ? "" : "primary"} block" data-send="${idx}" ${it.sending ? "disabled" : ""}>
              <svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>
              ${it.sending ? "Preparing email…" : it.sent ? "Open email again" : "Send email"}
            </button>`
          : ""
      }
    </li>`;
}

function contactValue(c) {
  const link = (href, text) => `<a class="cval" href="${esc(href)}" target="_blank">${esc(text)}</a>`;
  if (c.type === "website") return link(/^https?:/.test(c.value) ? c.value : "https://" + c.value, c.value);
  if (c.type === "telegram") return link(`https://t.me/${c.value.replace(/^@/, "")}`, c.value);
  if (c.type === "whatsapp") return link(`https://wa.me/${c.value.replace(/[^\d]/g, "")}`, c.value);
  if (c.type === "phone") return link(`tel:${c.value}`, c.value);
  return `<span class="cval">${esc(c.value)}</span>`;
}

// Recipient picker: every email found on their GitHub / Stack Overflow / website, with its
// source, plus "Other" (type one) and "No recipient". You choose which is correct.
function renderEmailPicker(it, idx) {
  const cands = it.accounts?.emailCandidates || [];
  const chosen = it.chosenEmail !== undefined ? it.chosenEmail : cands[0]?.value ?? "";
  const isOther = chosen && !cands.some((c) => c.value === chosen);
  const name = `rcpt-${idx}`;
  const option = (value, label, extra = "") =>
    `<label class="rcpt ${value === chosen && !isOther ? "on" : ""}">
       <input type="radio" name="${name}" data-choose="${idx}" value="${esc(value)}" ${value === chosen && !isOther ? "checked" : ""} />
       <span class="rcpt-main">${label}</span>${extra}
     </label>`;
  return `
    <div class="rcpt-box">
      <div class="sub-head">${cands.length ? `Recipient · ${cands.length} email${cands.length > 1 ? "s" : ""} found` : "Recipient · no public email found"}</div>
      ${cands
        .map((c) =>
          option(
            c.value,
            `<span class="cval">${esc(c.value)}</span>`,
            usedBadge(c.value) +
            (c.confidence === "check" ? `<span class="conf check" title="Page doesn't mention them — may belong to a client">check</span>` : "") +
              `<a class="csrc" href="${esc(c.sourceUrl)}" target="_blank" title="${esc(c.source)}">${esc(c.source)}</a>`
          )
        )
        .join("")}
      <label class="rcpt ${isOther ? "on" : ""}">
        <input type="radio" name="${name}" data-choose="${idx}" value="__other" ${isOther ? "checked" : ""} />
        <input class="rcpt-input" data-other="${idx}" placeholder="Other email…" value="${isOther ? esc(chosen) : ""}" />
      </label>
      ${option("", `<span class="meta">No recipient (fill in Gmail)</span>`)}
    </div>`;
}

async function chooseEmail(idx, email) {
  try {
    await send("chooseEmail", { key: run.items[idx].key, email });
  } catch (e) {
    toast(e.message, true);
  }
}

$("runList").addEventListener("change", (e) => {
  const idx = e.target.dataset.choose;
  if (idx === undefined) return;
  if (e.target.value === "__other") {
    const input = document.querySelector(`[data-other="${idx}"]`);
    input.focus();
    if (input.value.trim()) chooseEmail(+idx, input.value.trim());
  } else chooseEmail(+idx, e.target.value);
});

$("runList").addEventListener("focusout", (e) => {
  if (renderRun.pending) {
    renderRun.pending = false;
    setTimeout(renderRun, 0);
  }
  const idx = e.target.dataset.other;
  if (idx === undefined) return;
  const v = e.target.value.trim();
  if (!v) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return toast("That email looks invalid", true);
  chooseEmail(+idx, v);
});

$("runList").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-send]");
  if (!btn) return;
  const item = run.items[+btn.dataset.send];
  // Commit a typed "Other" address before sending.
  const other = document.querySelector(`[data-other="${btn.dataset.send}"]`);
  if (other === document.activeElement && other.value.trim()) await chooseEmail(+btn.dataset.send, other.value.trim());
  try {
    const { saved, savedAs } = await send("send", { key: item.key });
    toast(
      savedAs === "email" ? "Gmail opened · contact saved"
      : saved ? "Gmail opened · no email found — saved with website links"
      : "Gmail opened · not saved (no email or website found)"
    );
    refreshCount();
  } catch (err) {
    toast(err.message, true);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && "run" in changes) {
    run = changes.run.newValue || null;
    // Contacts are saved automatically while a run is going.
    refreshCount();
    // Don't wipe an email you're typing; re-render when the field loses focus.
    if (document.activeElement?.classList.contains("rcpt-input")) renderRun.pending = true;
    else renderRun();
  }
});

// ---------- contacts ----------
async function backendUrl() {
  const { settings: saved } = await chrome.storage.local.get("settings");
  return ({ ...DEFAULT_SETTINGS, ...saved }.backend || "").replace(/\/$/, "");
}
// Keep the Contacts app (served by the backend) in step with this panel.
const syncToApp = async (removedId) => syncContacts(await backendUrl(), removedId);

// Every sync, from here or the background worker, reports through storage.
function renderSyncStatus(s) {
  const pill = $("syncPill");
  const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const differ = s?.ok && s.local !== s.remote;
  const offline = s && !s.ok && s.error === "offline";
  pill.className = "sync-pill " + (!s ? "" : s.ok && !differ ? "ok" : differ ? "warn" : "bad");
  pill.textContent = !s ? "Sync: checking…" : differ ? "Sync: counts differ" : s.ok ? `Synced ${time(s.at)}` : offline ? "App offline" : "Sync failed";
  pill.title = !s ? "" : `${s.ok ? `${s.local} contacts here, ${s.remote} in the app.` : s.error === "offline" ? "The Contacts app backend isn't running." : s.error} Click to sync now.`;
  $("syncWarn").textContent =
    s && !s.ok
      ? (offline ? "Contacts app is offline. Start UpworkOutreach.exe." : `Sync failed: ${s.error}.`) +
        " Your changes are safe here and will sync once it's back." +
        (s.lastOkAt ? ` Last synced ${new Date(s.lastOkAt).toLocaleString()}.` : "")
      : "";
  $("syncWarn").classList.toggle("hidden", !s || s.ok);
}
chrome.storage.local.get("syncStatus").then(({ syncStatus }) => renderSyncStatus(syncStatus));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.syncStatus) return;
  const s = changes.syncStatus.newValue;
  renderSyncStatus(s);
  // Redrawing the list would wipe an email being typed into a card, so wait until the next redraw.
  const typing = document.activeElement?.closest?.("#contactList");
  if (s?.changed && $("view-contacts").classList.contains("active") && !typing) renderContacts();
  else refreshCount();
});
$("syncPill").addEventListener("click", () => syncToApp());

async function refreshCount() {
  $("contactCount").textContent = (await listContacts()).length;
}

$("statusFilter").innerHTML += Object.entries(STATUSES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");

async function renderContacts() {
  const q = $("search").value.trim().toLowerCase();
  const sf = $("statusFilter").value;
  const all = await listContacts();
  $("contactCount").textContent = all.length;
  const rows = all.filter(
    (c) => (!sf || c.status === sf) && (!q || JSON.stringify([c.name, c.description, c.upwork?.skills, c.methods]).toLowerCase().includes(q))
  );
  $("contactList").innerHTML = rows
    .map(
      (c) => `
      <li class="card">
        <div class="card-top">
          <div>
            <div class="name">${esc(c.name)}</div>
            <div class="desc">${esc(c.upwork?.title || "")}</div>
          </div>
          <select data-status="${c.id}" class="status-${c.status}">
            ${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}" ${k === c.status ? "selected" : ""}>${v}</option>`).join("")}
          </select>
        </div>
        ${c.description ? `<div class="desc">${esc(c.description)}</div>` : ""}
        <div class="links">
          ${c.upwork?.url ? `<a href="${esc(c.upwork.url)}" target="_blank">Upwork</a>` : ""}
          ${(c.accounts || []).map((a) => `<a href="${esc(a.url)}" target="_blank">${ACCOUNT_LABELS[a.type] || a.type}</a>`).join("")}
        </div>
        ${
          (c.methods || []).some((m) => m.type === "email" || m.type === "outlook")
            ? `<ul class="contact-list">${c.methods
                .filter((m) => m.type === "email" || m.type === "outlook")
                .map((m) => `<li><span class="ctype">email</span>${contactValue(m)}${usedBadge(m.value)}${m.source ? `<span class="csrc" title="${esc(m.source)}">${esc(m.source)}</span>` : ""}</li>`)
                .join("")}</ul>`
            : `<div class="meta">No email saved</div>`
        }
        <div class="row">
          <input class="grow" data-email-for="${c.id}" placeholder="Email they shared with you" />
          <button class="btn small" data-add-email="${c.id}">Add</button>
        </div>
        <div class="actions">
          <span class="meta grow">Updated ${new Date(c.updatedAt).toLocaleDateString()}</span>
          <button class="btn small ghost danger" data-del="${c.id}">Delete</button>
        </div>
      </li>`
    )
    .join("");
}

$("search").addEventListener("input", renderContacts);
$("statusFilter").addEventListener("change", renderContacts);

$("contactList").addEventListener("change", async (e) => {
  const id = e.target.dataset.status;
  if (!id) return;
  const c = await getContact(id);
  await putContact({ ...c, status: e.target.value, updatedAt: new Date().toISOString() });
  e.target.className = "status-" + e.target.value;
  syncToApp();
});

$("contactList").addEventListener("click", async (e) => {
  const { del, addEmail } = e.target.dataset;
  if (addEmail) {
    const input = document.querySelector(`[data-email-for="${addEmail}"]`);
    const value = input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return toast("That email looks invalid", true);
    const c = await getContact(addEmail);
    const methods = [...(c.methods || []), { type: "email", value, source: "Shared by them", verified: true, addedAt: new Date().toISOString() }];
    await putContact({ ...c, methods, updatedAt: new Date().toISOString() });
    toast("Email saved — used as recipient next time");
    renderContacts();
    syncToApp();
  }
  if (del && confirm("Delete this contact permanently?")) {
    await deleteContact(del);
    renderContacts();
    syncToApp(del);
  }
});

$("openAppBtn").addEventListener("click", async () => {
  const ok = await syncToApp();
  if (!ok) return toast("Backend not running — start UpworkOutreach.exe.", true);
  chrome.tabs.create({ url: (await backendUrl()) + "/" });
});
// Contacts saved before the app existed (or while the backend was down) catch up here.
syncToApp();

$("exportBtn").addEventListener("click", async () => {
  const blob = new Blob([JSON.stringify(await listContacts(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `contacts-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---------- settings ----------
async function loadSettings() {
  const { settings: saved } = await chrome.storage.local.get("settings");
  const s = { ...DEFAULT_SETTINGS, ...saved };
  $("sBackend").value = s.backend;
  $("sSender").value = s.sender;
  $("sGhToken").value = s.githubToken;
  $("sSites").checked = s.checkWebsites;
  $("sConcurrency").value = s.concurrency;
}

$("sSaveBtn").addEventListener("click", async () => {
  const settings = {
    backend: $("sBackend").value.trim() || DEFAULT_SETTINGS.backend,
    sender: $("sSender").value.trim(),
    githubToken: $("sGhToken").value.trim(),
    checkWebsites: $("sSites").checked,
    concurrency: Math.min(Math.max(Number($("sConcurrency").value) || 2, 1), 3),
  };
  await chrome.storage.local.set({ settings });
  toast("Settings saved");
});

// Checking personal websites needs access to any site; ask only when turned on.
$("sSites").addEventListener("change", async (e) => {
  if (!e.target.checked) return;
  const granted = await chrome.permissions.request({ origins: ["<all_urls>"] });
  if (!granted) {
    e.target.checked = false;
    toast("Permission needed to read personal websites", true);
  }
});

// ---------- init ----------
(async () => {
  await loadSettings();
  refreshCount();
  run = (await chrome.storage.session.get("run")).run || null;
  renderRun();
})();
