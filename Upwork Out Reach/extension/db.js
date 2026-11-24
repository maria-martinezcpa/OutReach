// Local-only contact store (IndexedDB). Email drafts are never written here.
const DB_NAME = "outreach";
const STORE = "contacts";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: "id" });
      store.createIndex("updatedAt", "updatedAt");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

export const listContacts = () =>
  tx("readonly", (s) => s.getAll()).then((rows) =>
    rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
  );
export const getContact = (id) => tx("readonly", (s) => s.get(id));
export const putContact = (c) => tx("readwrite", (s) => s.put(c));
export const deleteContact = (id) => tx("readwrite", (s) => s.delete(id));

// Deletes the backend hasn't confirmed yet. Kept until it does, so a contact deleted while the
// backend is down doesn't come back on the next sync.
const editPendingDeletes = (edit) =>
  navigator.locks.request("outreach-pending-deletes", async () => {
    const { pendingDeletes = [] } = await chrome.storage.local.get("pendingDeletes");
    const next = edit(pendingDeletes);
    if (next) await chrome.storage.local.set({ pendingDeletes: next });
    return next || pendingDeletes;
  });

async function exchangeContacts(base) {
  const call = async (path, options) => {
    let res;
    try {
      res = await fetch(base + path, { ...options, signal: AbortSignal.timeout(20_000) });
    } catch {
      throw new Error("offline");
    }
    if (!res.ok) throw new Error(`The backend answered ${res.status} for ${path}`);
    return res.json();
  };

  for (const id of await editPendingDeletes(() => null)) {
    await call(`/api/contacts/${encodeURIComponent(id)}`, { method: "DELETE" });
    await editPendingDeletes((ids) => ids.filter((x) => x !== id));
  }

  const { deleted = [] } = await call("/api/contacts/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contacts: await listContacts() }),
  });
  const remote = await call("/api/contacts");

  // Bring this side in line: removed in the app, then anything new or newer there.
  let local = new Map((await listContacts()).map((c) => [c.id, c]));
  const stillDeleting = new Set(await editPendingDeletes(() => null)); // deleted here during this sync
  let changed = 0;
  for (const id of deleted) {
    if (!local.has(id)) continue;
    await deleteContact(id);
    local.delete(id);
    changed++;
  }
  for (const c of remote) {
    if (stillDeleting.has(c.id)) continue;
    const mine = local.get(c.id);
    if (!mine || String(c.updatedAt) > String(mine.updatedAt)) {
      await putContact(c);
      changed++;
    }
  }
  return { changed, local: (await listContacts()).length, remote: remote.length };
}

// Two-way sync with the local backend's Contacts app (newest edit wins on both sides). Runs every
// 30 seconds from the background worker as well as after changes; if the backend isn't running,
// the next sync catches up. One at a time across the panel and the worker. The outcome is kept in
// storage as syncStatus for the panel to show.
export async function syncContacts(backend, removedId) {
  const base = String(backend || "http://localhost:8787").replace(/\/$/, "");
  if (removedId) await editPendingDeletes((ids) => (ids.includes(removedId) ? ids : [...ids, removedId]));
  return navigator.locks.request("outreach-sync", async () => {
    const { syncStatus: before } = await chrome.storage.local.get("syncStatus");
    const at = new Date().toISOString();
    let status;
    try {
      status = { ok: true, at, lastOkAt: at, ...(await exchangeContacts(base)) };
    } catch (e) {
      status = { ok: false, at, lastOkAt: before?.lastOkAt, error: e.message, changed: 0 };
    }
    await refreshUsedEmails();
    await chrome.storage.local.set({ syncStatus: status });
    return status.ok;
  });
}

// email (lowercase) -> when Gmail was last opened for it. Read by the panel and the Upwork bars.
export async function refreshUsedEmails() {
  const used = {};
  for (const c of await listContacts())
    for (const m of c.methods || []) {
      const k = m.value.toLowerCase();
      if (m.usedAt && !(used[k] >= m.usedAt)) used[k] = m.usedAt;
    }
  await chrome.storage.local.set({ usedEmails: used });
}

// Normalized keys used for duplicate protection.
export function normalizeUrl(raw) {
  try {
    const u = new URL(raw.startsWith("http") ? raw : "https://" + raw);
    return (u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/+$/, "")).toLowerCase();
  } catch {
    return "";
  }
}

export function contactKeys(c) {
  const keys = new Set();
  if (c.upwork?.url) keys.add("url:" + normalizeUrl(c.upwork.url));
  // Search cards may lack a profile URL, so name + title is a weaker fallback key.
  if (c.name && c.upwork?.title) keys.add("name:" + (c.name + "|" + c.upwork.title).toLowerCase());
  for (const a of c.accounts || []) if (a.url) keys.add("url:" + normalizeUrl(a.url));
  for (const m of c.methods || []) {
    const v = m.value.trim().toLowerCase();
    if (!v) continue;
    keys.add(m.type === "phone" ? "phone:" + v.replace(/[^\d+]/g, "") : m.type + ":" + v);
  }
  return [...keys];
}

export async function findDuplicates(candidate) {
  const keys = new Set(contactKeys(candidate));
  const all = await listContacts();
  return all
    .filter((c) => c.id !== candidate.id)
    .map((c) => ({ contact: c, matches: contactKeys(c).filter((k) => keys.has(k)) }))
    .filter((d) => d.matches.length);
}
