// Shows background-run results on each freelancer card of an Upwork search page:
//   status · GitHub chip · Stack Overflow chip · [Send email]
// Relies on captureProfile() (capture.js) and helpers from insights.js.

(() => {
  const HOST_TAG = "outreach-bar";
  const tiles = new Map(); // key -> { tile, host, root }
  let run = null;
  let usedEmails = {}; // email (lowercase) -> when Gmail was opened for it
  const usedAt = (email) => usedEmails[String(email || "").toLowerCase()];

  const STYLE = `
    :host { all: initial; display: block; margin: 8px 0 4px; }
    .bar {
      display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
      padding: 6px 8px; border-radius: 10px;
      background: #151820; border: 1px solid #2a303c;
      font: 600 12px/1.3 Inter, "Segoe UI", system-ui, sans-serif; color: #e7e9ee;
    }
    .brand { display: flex; align-items: center; gap: 5px; color: #949cad; margin-right: 2px; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: #6b7385; }
    .dot.run { background: #7aa7ff; animation: pulse 1s infinite alternate; }
    .dot.ok { background: #3ddc84; }
    .dot.err { background: #f16d6d; }
    @keyframes pulse { to { opacity: .3; } }
    a.chip, .chip {
      display: inline-flex; align-items: center; gap: 5px;
      border-radius: 999px; padding: 4px 10px; text-decoration: none;
      border: 1px solid #3a4252; background: #242935; color: #e7e9ee;
    }
    .chip.yes { background: rgba(61,220,132,.14); border-color: rgba(61,220,132,.5); color: #3ddc84; }
    .chip.maybe { background: rgba(245,185,66,.12); border-color: rgba(245,185,66,.45); color: #f5b942; }
    .chip.no { color: #6b7385; }
    .chip.used { background: #242935; border-color: #3a4252; color: #949cad; }
    a.chip:hover { filter: brightness(1.15); }
    .msg { color: #949cad; font-weight: 500; }
    .err { color: #f16d6d; font-weight: 500; }
    .spacer { flex: 1; }
    .bar.found { border-color: rgba(61,220,132,.6); box-shadow: 0 0 0 1px rgba(61,220,132,.25); }
    .bar.none { opacity: .55; padding: 3px 8px; }
    button {
      display: inline-flex; align-items: center; gap: 5px; cursor: pointer;
      border-radius: 999px; padding: 5px 12px; font: inherit;
      background: #3ddc84; border: 1px solid #3ddc84; color: #06210f;
    }
    button:disabled { opacity: .6; cursor: progress; }
    button.ghost { background: #242935; border-color: #3a4252; color: #e7e9ee; }
    select {
      max-width: 260px; font: inherit; font-weight: 500; color: #e7e9ee; cursor: pointer;
      background: #242935; border: 1px solid #3a4252; border-radius: 999px; padding: 4px 8px;
    }
    svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  `;

  const ICONS = {
    github: '<svg viewBox="0 0 24 24"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>',
    so: '<svg viewBox="0 0 24 24"><path d="M4 15v5h14v-5M8 16h6M8.5 12.5l6 1.3M10 8.5l5.4 2.8M13 4.5l4.2 4.6"/></svg>',
    mail: '<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>',
  };

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function githubChip(gh, mentioned, done) {
    if (gh?.url) {
      const act = gh.activity;
      const via = gh.source?.includes("Stack Overflow") ? " (via SO)" : "";
      const label = act ? `GitHub${via} · ${compactNumber(act.totalCommits)} commits${act.lastCommitAt ? " · " + timeAgo(act.lastCommitAt) : ""}` : `GitHub${via}`;
      const tip = [gh.url, gh.topLanguages?.join(", "), ...(act?.repos || []).slice(0, 4).map((r) => `${r.name} (${r.commits})`), gh.error].filter(Boolean).join("\n");
      return `<a class="chip yes" href="${esc(gh.url)}" target="_blank" rel="noopener" title="${esc(tip)}">${ICONS.github} ${esc(label)}</a>`;
    }
    if (mentioned) return `<span class="chip maybe" title="Mentioned, but no account link (may be a skill tag)">${ICONS.github} GitHub?</span>`;
    return done ? `<span class="chip no">${ICONS.github} No GitHub</span>` : "";
  }

  function soChip(so, mentioned, done) {
    if (so?.url) {
      const label = so.reputation != null ? `Stack Overflow · ${compactNumber(so.reputation)} rep` : "Stack Overflow";
      const tip = [so.url, (so.topTags || []).map((t) => t.tag).join(", "), so.error].filter(Boolean).join("\n");
      return `<a class="chip yes" href="${esc(so.url)}" target="_blank" rel="noopener" title="${esc(tip)}">${ICONS.so} ${esc(label)}</a>`;
    }
    if (mentioned) return `<span class="chip maybe">${ICONS.so} Stack Overflow?</span>`;
    return done ? `<span class="chip no">${ICONS.so} No Stack Overflow</span>` : "";
  }

  function render(key) {
    const t = tiles.get(key);
    if (!t) return;
    const item = run?.items.find((i) => i.key === key);
    const bar = t.root.querySelector(".bar");
    if (!item) {
      bar.className = "bar";
      bar.innerHTML = `<span class="brand"><span class="dot"></span>Outreach</span><span class="msg">Press Start in the extension panel</span>`;
      return;
    }
    const done = item.state === "done";
    const a = item.accounts || {};
    const found = !!(a.github?.url || a.stackoverflow?.url);
    bar.className = "bar" + (done && found ? " found" : done ? " none" : "");
    if (done && !found) {
      bar.innerHTML = `<span class="brand"><span class="dot"></span>Outreach</span><span class="msg">No GitHub or Stack Overflow linked</span>`;
      return;
    }
    const status = {
      queued: `<span class="dot"></span>Queued`,
      checking: `<span class="dot run"></span>Checking…`,
      done: `<span class="dot ok"></span>${item.cached ? "Checked before" : "Outreach"}`,
      error: `<span class="dot err"></span>Error`,
      no_link: `<span class="dot"></span>No profile link`,
    }[item.state];

    bar.innerHTML = `
      <span class="brand">${status}</span>
      ${githubChip(a.github, a.mentions?.github, done)}
      ${soChip(a.stackoverflow, a.mentions?.stackoverflow, done)}
      ${(a.contacts || [])
        .filter((c) => c.type === "email")
        .map((c) => {
          const at = usedAt(c.value);
          return `<span class="chip ${at ? "used" : "yes"}" title="${esc(c.source)}${at ? ` · Gmail opened ${esc(new Date(at).toLocaleString())}` : ""}">${ICONS.mail} ${esc(c.value)} · ${at ? "used" : "not used"}</span>`;
        })
        .join("")}
      ${item.error ? `<span class="err">${esc(item.error)}</span>` : ""}
      ${item.saved ? `<span class="chip yes" title="Saved to Contacts">Saved</span>` : ""}
      <span class="spacer"></span>
      ${done ? emailSelect(item) : ""}
      ${
        done
          ? `<button class="${item.sent ? "ghost" : ""}" data-act="send" ${item.sending ? "disabled" : ""}>
               ${ICONS.mail} ${item.sending ? "Drafting…" : item.sent ? "Open email again" : "Send email"}
             </button>`
          : ""
      }`;
  }

  // Pick which found email the message goes to (same choice as in the side panel).
  function emailSelect(item) {
    const cands = item.accounts?.emailCandidates || [];
    const chosen = item.chosenEmail !== undefined ? item.chosenEmail : cands[0]?.value ?? "";
    const opts = cands.map((c) => ({ value: c.value, label: `${c.value} — ${usedAt(c.value) ? "used" : "not used"} — ${c.source}` }));
    if (chosen && !cands.some((c) => c.value === chosen)) opts.push({ value: chosen, label: `${chosen} — entered by you` });
    opts.push({ value: "", label: cands.length ? "No recipient" : "No public email found" });
    return `<select data-act="choose" title="Recipient">${opts
      .map((o) => `<option value="${esc(o.value)}" ${o.value === chosen ? "selected" : ""}>${esc(o.label)}</option>`)
      .join("")}</select>`;
  }

  function attach(tile, card) {
    const key = card.url || `${card.name}|${card.title}`;
    const existing = tiles.get(key);
    if (existing && existing.tile === tile && tile.contains(existing.host)) return;

    const host = document.createElement(HOST_TAG);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${STYLE}</style><div class="bar"></div>`;
    root.addEventListener("change", (e) => {
      if (e.target.dataset.act !== "choose") return;
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: "chooseEmail", key, email: e.target.value });
    });
    root.addEventListener("click", async (e) => {
      if (e.target.closest("select")) return e.stopPropagation();
      if (e.target.closest("a")) return e.stopPropagation(); // open GitHub / SO link normally
      const btn = e.target.closest("[data-act='send']");
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation(); // don't open Upwork's slide-over
      const res = await chrome.runtime.sendMessage({ type: "send", key });
      if (!res?.ok) console.warn("[Outreach]", res?.error);
    });
    host.addEventListener("click", (e) => e.stopPropagation());

    const heading = tile.querySelector("h2, h3, h4, h5, [data-test='title']");
    if (heading?.parentElement) heading.parentElement.insertAdjacentElement("afterend", host);
    else tile.prepend(host);

    tiles.set(key, { tile, host, root });
    render(key);
  }

  function scan() {
    if (/\/freelancers\/|\/fl\/|\/details\/~/.test(location.pathname)) return;
    let res;
    try {
      res = captureProfile({ withTiles: true });
    } catch {
      return;
    }
    if (res.kind !== "search") return;
    res.tiles.forEach((tile, i) => attach(tile, res.results[i]));
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.usedEmails) usedEmails = changes.usedEmails.newValue || {};
    else if (area === "session" && "run" in changes) run = changes.run.newValue || null;
    else return;
    tiles.forEach((_, key) => render(key));
  });
  chrome.storage.local.get("usedEmails").then(({ usedEmails: u }) => {
    usedEmails = u || {};
    tiles.forEach((_, key) => render(key));
  });

  chrome.storage.session.get("run").then(({ run: r }) => {
    run = r || null;
    tiles.forEach((_, key) => render(key));
  });

  // Upwork is a single-page app: rescan when results change.
  let timer;
  new MutationObserver((muts) => {
    if (muts.every((m) => [...m.addedNodes].every((n) => n.nodeName === HOST_TAG.toUpperCase()))) return;
    clearTimeout(timer);
    timer = setTimeout(scan, 600);
  }).observe(document.body, { childList: true, subtree: true });
  scan();
})();
