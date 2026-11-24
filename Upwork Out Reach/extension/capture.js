// Shared by the Upwork content script, the background worker and the side panel
// (loaded as a classic script, so captureProfile is a global).
// Must stay self-contained: chrome.scripting serializes this function.
// Deliberately does NOT collect emails, phone numbers or messenger handles.
//
// Returns either
//   { kind: "profile", profile }            on a freelancer profile / details page
//   { kind: "search",  results: [profile] } on a talent search results page
// With { withTiles: true } (content script only) search results also include
// the matching DOM tiles, so buttons can be injected next to each freelancer.
function captureProfile(opts = {}) {
  const text = (el) => (el ? el.innerText.replace(/\s+\n/g, "\n").trim() : "");
  const lines = (el) => text(el).split("\n").map((l) => l.trim()).filter(Boolean);
  const now = new Date().toISOString();
  const path = window.location.pathname;

  const RATE = /^\$[\d.,]+\s*\/\s*hr$/i;
  const JSS = /(\d+)%\s*Job Success/i;
  const EARNED = /(\$[\d.,]+[KM]?\+?)\s*earned/i;
  const BADGES = /^(Boosted|Top Rated Plus|Top Rated|Rising Talent|Expert-Vetted|Available now|Open for work|Offers consultations)$/i;

  // Text hints that a GitHub / Stack Overflow account exists.
  const mentionsIn = (t) => ({
    github: /github/i.test(t),
    stackoverflow: /stack\s?overflow/i.test(t),
  });

  const cleanUrl = (href) => {
    try {
      const u = new URL(href, window.location.href);
      return u.origin + u.pathname;
    } catch {
      return "";
    }
  };

  const skillsIn = (root) =>
    [
      ...new Set(
        [...root.querySelectorAll('[data-test="Skill"], [data-test="skill"], [data-test="token"], .air3-token, .skill-name')]
          .map((e) => e.innerText.trim())
          .filter((t) => t && t.length < 50 && !/^\+\d+$/.test(t))
      ),
    ].slice(0, 40);

  // ---------- search results page ----------
  const isProfilePage = /\/freelancers\/|\/fl\/|\/details\/~/.test(path);

  if (!isProfilePage) {
    // Each result tile has its own "Invite to job" button; climb from it to the tile.
    const buttons = [...document.querySelectorAll("button, a")].filter((b) => /invite to job/i.test(b.innerText));
    const tiles = new Set();
    for (const b of buttons) {
      let el = b;
      while (el.parentElement && el.parentElement !== document.body) {
        const parent = el.parentElement;
        const invites = [...parent.querySelectorAll("button, a")].filter((x) => /invite to job/i.test(x.innerText));
        if (invites.length > 1) break;
        el = parent;
      }
      tiles.add(el);
    }
    // Fallback for layouts without invite buttons.
    if (!tiles.size) document.querySelectorAll('article, [data-test="FreelancerTile"]').forEach((t) => tiles.add(t));

    const results = [...tiles]
      .map((tile) => {
        const ls = lines(tile).filter((l) => !/invite to job/i.test(l));
        const content = ls.filter((l) => !BADGES.test(l));
        const name = content[0] || "";
        const heading = tile.querySelector("h2, h3, h4, h5, [data-test='title']");
        const title = (heading && text(heading) !== name ? text(heading) : content[1] || "").slice(0, 200);
        const titleIdx = content.indexOf(title);
        const loc = titleIdx >= 0 ? content[titleIdx + 1] || "" : "";
        const all = ls.join("\n");
        const link = tile.querySelector('a[href*="/freelancers/"], a[href*="/fl/"], a[href*="/details/~"]');
        const overview = content.reduce((a, b) => (b.length > a.length ? b : a), "");
        return {
          tile,
          url: link ? cleanUrl(link.href) : "",
          name,
          title,
          location: loc.length < 60 && !RATE.test(loc) ? loc : "",
          rate: ls.find((l) => RATE.test(l)) || "",
          jobSuccess: (all.match(JSS) || [])[1] ? all.match(JSS)[1] + "%" : "",
          earned: (all.match(EARNED) || [])[1] || "",
          badges: ls.filter((l) => BADGES.test(l)),
          skills: skillsIn(tile),
          overview: overview.length > 60 ? overview.slice(0, 1500) : "",
          links: [...tile.querySelectorAll("a[href]")]
            .map((a) => cleanUrl(a.href))
            .filter((u) => /github\.com\/|stackoverflow\.com\/users/i.test(u))
            .map((url) => ({ url, via: "search card link" })),
          mentions: mentionsIn(all),
          selection: "",
          source: "Upwork search results",
          searchUrl: window.location.href,
          capturedAt: now,
        };
      })
      .filter((r) => r.name && r.name.length < 60);

    const tileList = results.map((r) => r.tile);
    results.forEach((r) => delete r.tile);
    return opts.withTiles ? { kind: "search", results, tiles: tileList } : { kind: "search", results };
  }

  // ---------- profile page ----------
  const first = (selectors) => {
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el && el.innerText.trim()) return el;
    }
    return null;
  };
  // On search pages the profile opens in a slide-over; prefer that panel.
  const scope = document.querySelector('[role="dialog"], .air3-slider-content') || document;

  const name =
    text(first(['h2[itemprop="name"]', '[data-test="freelancer-name"]', "h1"])) ||
    document.title.split("|")[0].trim();

  const title = text(
    first(['[data-test="freelancer-title"]', '[data-test="title"]', "h2.h4", "section h2"])
  ).slice(0, 200);

  const overview = text(
    first([
      '[data-test="description"]',
      '[data-test="Description"]',
      '[data-test="freelancer-overview"]',
      ".air3-line-clamp-wrapper",
    ])
  ).slice(0, 4000);

  const place = text(first(['[itemprop="locality"]', '[data-test="location"]'])).slice(0, 120);
  const all = text(scope === document ? document.body : scope);

  // Every titled profile section (Work history, Portfolio, Employment history, Education,
  // Certifications, Languages, Testimonials, ...), keyed by its heading.
  const root = scope === document ? document.querySelector("main") || document.body : scope;
  const sections = {};
  for (const h of root.querySelectorAll("h2, h3, h4, [role='heading']")) {
    const heading = text(h).split("\n")[0].slice(0, 60);
    if (!heading || heading.length < 3 || heading === name || heading === title || sections[heading]) continue;
    // Climb to the smallest container that holds more than just the heading.
    let box = h.parentElement;
    while (box && box !== root && text(box).length <= heading.length + 20) box = box.parentElement;
    const body = text(box).replace(heading, "").trim();
    if (body.length > 20) sections[heading] = body.slice(0, 2500);
  }

  const stat = (re) => (all.match(re) || [])[1] || "";

  // Accounts the freelancer links from their own profile.
  const links = new Map();
  const add = (href, via) => {
    try {
      let u = new URL(href, window.location.href);
      // Upwork may wrap outbound links in its own redirect (…?url=https%3A%2F%2Fgithub.com%2F…).
      if (/(^|\.)upwork\.com$/.test(u.hostname)) {
        const inner = [...u.searchParams.values()].find((v) => /^https?:\/\//i.test(v));
        if (!inner) return;
        u = new URL(inner);
      }
      if (!/^https?:$/.test(u.protocol)) return;
      const key = u.origin + u.pathname.replace(/\/$/, "");
      if (!links.has(key)) links.set(key, { url: key, via });
    } catch {}
  };
  const accountUrl = /\b(?:https?:\/\/)?(?:www\.)?(?:github\.com\/[A-Za-z0-9-]{1,39}|stackoverflow\.com\/users\/\d+[^\s"'<>)\],]*)/gi;

  // "Linked accounts" card (GitHub / Stack Overflow connected to Upwork).
  const linkedAccounts = [];
  const laHeading = [...(scope === document ? document.body : scope).querySelectorAll("h2, h3, h4, h5, [role='heading'], div, span")].find(
    (el) => el.children.length === 0 && /^linked accounts$/i.test(el.textContent.trim())
  );
  if (laHeading) {
    let box = laHeading.parentElement;
    while (box && box !== document.body && text(box).length <= 20) box = box.parentElement;
    if (box) {
      box.querySelectorAll("a[href]").forEach((a) => add(a.href, "Upwork linked accounts"));
      // Links can also sit in data-* attributes or JSON inside the card.
      for (const m of box.outerHTML.replace(/&quot;/g, '"').replace(/\\\//g, "/").match(accountUrl) || [])
        add(m.startsWith("http") ? m : "https://" + m, "Upwork linked accounts");

      let cur = null;
      for (const line of text(box).split("\n").map((l) => l.trim()).filter(Boolean).slice(1)) {
        if (/^associated with$/i.test(line)) break;
        const provider = /^(github|stack\s?overflow)\b/i.exec(line);
        if (provider) {
          cur = { provider: /git/i.test(provider[1]) ? "github" : "stackoverflow", displayName: "", since: "", followers: null, reputation: null };
          linkedAccounts.push(cur);
        }
        if (!cur) continue;
        const since = /since\s+(\d{4})/i.exec(line);
        if (since) cur.since = since[1];
        const followers = /^([\d,]+)\s+followers?$/i.exec(line);
        if (followers) cur.followers = Number(followers[1].replace(/,/g, ""));
        const rep = /^([\d,]+)\s+reputation$/i.exec(line);
        if (rep) cur.reputation = Number(rep[1].replace(/,/g, ""));
        if (!provider && !since && !followers && !rep && !/^view profile$/i.test(line) && !cur.displayName) cur.displayName = line;
      }
    }
  }

  // All other outbound links in the profile (sidebar included, not just <main>).
  (scope === document ? document : scope)
    .querySelectorAll("main a[href], #main a[href], aside a[href], [role='dialog'] a[href], [data-test*='profile'] a[href]")
    .forEach((a) => add(a.href, "profile link"));
  for (const m of overview.match(accountUrl) || []) add(m.startsWith("http") ? m : "https://" + m, "profile text");

  return {
    kind: "profile",
    profile: {
      url: cleanUrl(window.location.href),
      name,
      title,
      overview,
      location: place,
      rate: (all.match(/\$[\d.,]+\s*\/\s*hr/i) || [""])[0],
      jobSuccess: (all.match(JSS) || [])[1] ? all.match(JSS)[1] + "%" : "",
      earned: (all.match(EARNED) || [])[1] || "",
      badges: [],
      totalJobs: stat(/([\d,]+)\s*Total jobs/i),
      totalHours: stat(/([\d,]+)\s*Total hours/i),
      hoursPerWeek: stat(/(More than 30 hrs\/week|Less than 30 hrs\/week|As needed[^\n]*)/i),
      memberSince: stat(/Member since\s*([^\n]+)/i),
      languages: stat(/Languages\s*\n([\s\S]{0,200}?)(?:\n\s*\n|Verifications|Education|$)/i).trim(),
      sections,
      linkedAccounts,
      textLength: all.length,
      skills: skillsIn(scope === document ? document : scope),
      links: [...links.values()].slice(0, 30),
      mentions: mentionsIn(all),
      selection: String(window.getSelection() || "").slice(0, 3000),
      source: "Upwork profile",
      capturedAt: now,
    },
  };
}
globalThis.captureProfile = captureProfile;
