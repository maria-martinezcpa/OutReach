const SERPAPI_URL = 'https://serpapi.com/search.json';
const DEFAULT_SETTINGS = { apiKey: '', gl: 'us', hl: 'en' };

const KNOWN_SOURCES = {
  linkedin: '#0a66c2',
  indeed: '#2164f3',
  ziprecruiter: '#24a148',
  glassdoor: '#0caa41',
  monster: '#6e46ae',
  dice: '#eb1c26',
  'built in': '#f26b21',
  wellfound: '#e0457b',
  upwork: '#14a800',
};
const FALLBACK_COLORS = ['#8e44ad', '#d35400', '#16a085', '#c0392b', '#2c82c9', '#b8860b', '#7f8c8d'];

const state = {
  query: null,       // { q, location, remote }
  jobs: [],          // normalized jobs across all loaded pages
  nextToken: null,
  selectedId: null,
  loading: false,
  picked: new Set(), // job ids ticked for batch tailoring
  saved: { total: null, ready: 0, byId: new Map(), byKey: new Map(), status: new Map() }, // your saved job list (jobs.json)
  showSaved: false, // show search results that are already in that list
};

// Each tailored job is one Claude Code request on your plan.
const MAX_BATCH = 5;

const $ = (id) => document.getElementById(id);

// ---------- DOM helper (builds nodes with textContent, never innerHTML) ----------

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'style') node.style.cssText = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child != null && child !== false) node.append(child);
  }
  return node;
}

function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

// ---------- Settings & cache ----------

function getSettings() {
  return chrome.storage.sync.get(DEFAULT_SETTINGS);
}

function saveCache() {
  chrome.storage.local.set({
    lastSearch: {
      query: state.query,
      jobs: state.jobs,
      nextToken: state.nextToken,
      selectedId: state.selectedId,
    },
  });
}

// ---------- Data ----------

// "Date posted" choice (days) -> Google Jobs date chip.
const DATE_CHIPS = { 1: 'today', 3: '3days', 7: 'week', 30: 'month' };
// With a date range picked, load up to this many extra pages when too few recent jobs come back.
const TOPUP_TARGET = 10;
const TOPUP_MAX_PAGES = 2;

async function fetchJobs(query, nextToken) {
  const { apiKey, gl, hl } = await getSettings();
  if (!apiKey) {
    const err = new Error('No SerpApi key set.');
    err.noKey = true;
    throw err;
  }

  const params = new URLSearchParams({ engine: 'google_jobs', q: query.q, gl, hl, api_key: apiKey });
  if (query.location) params.set('location', query.location);
  if (query.remote) params.set('ltype', '1');
  if (DATE_CHIPS[query.datePosted]) params.set('chips', `date_posted:${DATE_CHIPS[query.datePosted]}`);
  if (nextToken) params.set('next_page_token', nextToken);

  const res = await fetch(`${SERPAPI_URL}?${params}`);
  const data = await res.json().catch(() => ({}));

  if (data.error) {
    // SerpApi reports an empty result set as an "error".
    if (/hasn't returned any results/i.test(data.error)) return { jobs: [], nextToken: null };
    throw new Error(data.error);
  }
  if (!res.ok) throw new Error(`Request failed (HTTP ${res.status}).`);

  return {
    jobs: (data.jobs_results || []).map((job) => normalizeJob(job, query.q)),
    nextToken: data.serpapi_pagination?.next_page_token || null,
  };
}

function normalizeJob(job, q) {
  const ext = job.detected_extensions || {};
  const salaryText =
    ext.salary ||
    (job.extensions || []).find((e) => /[$£€₹]|\d\s*k\b|an hour|a year|a month/i.test(e)) ||
    '';
  const applyOptions = (job.apply_options || [])
    .map((o) => ({ title: o.title, link: safeUrl(o.link) }))
    .filter((o) => o.link);
  const via = (job.via || '').replace(/^via\s+/i, '').trim() || 'Job board';

  const normalized = {
    id: job.job_id || `${job.title}|${job.company_name}|${job.location}`,
    title: job.title || 'Untitled role',
    company: job.company_name || 'Unknown company',
    location: job.location || '',
    via,
    posted: ext.posted_at || '',
    postedAt: estimatePostedAt(ext.posted_at),
    schedule: ext.schedule_type || '',
    remote: Boolean(ext.work_from_home),
    salaryText,
    salary: parseSalary(salaryText),
    description: job.description || '',
    highlights: job.job_highlights || [],
    applyOptions,
    link: applyOptions[0]?.link || safeUrl(job.share_link),
  };
  normalized.match = scoreMatch(normalized, q);
  return normalized;
}

// Converts strings like "120K–150K a year" or "45–60 an hour" to an annual range.
function parseSalary(text) {
  if (!text) return null;
  const nums = [...text.matchAll(/(\d+(?:[.,]\d+)*)\s*(k)?/gi)]
    .map((m) => parseFloat(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1))
    .filter((n) => n > 0);
  if (!nums.length) return null;

  let perYear = 1;
  if (/hour/i.test(text)) perYear = 2080;
  else if (/day/i.test(text)) perYear = 260;
  else if (/week/i.test(text)) perYear = 52;
  else if (/month/i.test(text)) perYear = 12;

  const min = Math.min(...nums) * perYear;
  const max = Math.max(...nums) * perYear;
  return { min, max, mid: (min + max) / 2 };
}

const HOUR = 3600 * 1000;
const AGE_UNITS = { minute: HOUR / 60, hour: HOUR, day: 24 * HOUR, week: 7 * 24 * HOUR, month: 30 * 24 * HOUR, year: 365 * 24 * HOUR };

// Turns Google's relative "posted_at" ("3 days ago", "30+ days ago", "yesterday") into a timestamp,
// so the date filter stays correct for results restored from an earlier session.
function estimatePostedAt(text, now = Date.now()) {
  if (!text) return null;
  if (/just|today|now/i.test(text)) return now;
  if (/yesterday/i.test(text)) return now - AGE_UNITS.day;
  const m = text.match(/(\d+)\+?\s*(minute|hour|day|week|month|year)/i);
  return m ? now - Number(m[1]) * AGE_UNITS[m[2].toLowerCase()] : null;
}

function formatAge(job) {
  if (job.postedAt == null) return job.posted;
  const hours = (Date.now() - job.postedAt) / HOUR;
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return job.posted.includes('+') ? job.posted : `${Math.floor(days / 30)}mo ago`;
}

function queryTerms(q) {
  return [...new Set((q || '').toLowerCase().split(/[^a-z0-9+#.]+/).filter((t) => t.length > 1))];
}

function scoreMatch(job, q) {
  const terms = queryTerms(q);
  if (!terms.length) return { score: 0, terms: [] };
  const title = job.title.toLowerCase();
  const body = [job.description, ...job.highlights.flatMap((h) => h.items || [])].join(' ').toLowerCase();

  const termHits = terms.map((t) => ({ term: t, inTitle: title.includes(t), hit: title.includes(t) || body.includes(t) }));
  const titleFrac = termHits.filter((t) => t.inTitle).length / terms.length;
  const anyFrac = termHits.filter((t) => t.hit).length / terms.length;
  return { score: Math.round(100 * (0.6 * titleFrac + 0.4 * anyFrac)), terms: termHits };
}

function sourceColor(via) {
  const key = via.toLowerCase();
  for (const [name, color] of Object.entries(KNOWN_SOURCES)) {
    if (key.includes(name)) return color;
  }
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

function formatMoney(n) {
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${Math.round(n)}`;
}

// ---------- Filtering ----------

function byNewest(a, b) {
  return (b.postedAt ?? -Infinity) - (a.postedAt ?? -Infinity);
}

function visibleJobs() {
  const jobs = filteredJobs();
  return $('sortBy').value === 'newest' ? [...jobs].sort(byNewest) : jobs;
}

// Number of this job in your saved list, or null if it's new.
function savedIndex(job) {
  return state.saved.byId.get(job.id) ?? state.saved.byKey.get(jobKey(job)) ?? null;
}

function setSavedJobs(savedJobs) {
  if (!savedJobs) return;
  state.saved = {
    total: savedJobs.total,
    byId: new Map(savedJobs.jobs.filter((j) => j.jobId).map((j) => [j.jobId, j.index])),
    byKey: new Map(savedJobs.jobs.map((j) => [j.key, j.index])),
    status: new Map(savedJobs.jobs.map((j) => [j.index, j.status])),
    ready: savedJobs.ready ?? savedJobs.jobs.filter((j) => j.status === 'ready').length,
  };
}

function filteredJobs({ includeSaved = state.showSaved } = {}) {
  const source = $('sourceFilter').value;
  const minPay = Number($('minSalary').value);
  const maxAgeDays = Number($('dateFilter').value);
  const cutoff = maxAgeDays ? Date.now() - maxAgeDays * AGE_UNITS.day : null;
  return state.jobs.filter((job) => {
    if (!includeSaved && savedIndex(job) != null) return false;
    if (source && job.via !== source) return false;
    // Jobs with no posting date are hidden once a date range is picked.
    if (cutoff && (job.postedAt == null || job.postedAt < cutoff)) return false;
    if (minPay && job.salary && job.salary.max < minPay) return false;
    return true;
  });
}

// ---------- Rendering ----------

function render() {
  const jobs = visibleJobs();
  renderStats(jobs);
  renderSavedNote();
  renderSourceFilter();
  renderList(jobs);

  if (!jobs.some((j) => j.id === state.selectedId)) {
    state.selectedId = jobs[0]?.id ?? null;
  }
  highlightSelected();
  renderDetail(state.jobs.find((j) => j.id === state.selectedId));

  $('moreBtn').hidden = !state.nextToken || state.loading;
  $('tailorAllBtn').hidden = !jobs.length || state.loading;
  $('tailorAllBtn').textContent = `✨ Tailor all ${jobs.length} resume${jobs.length === 1 ? '' : 's'}`;
}

function renderSavedNote() {
  const note = $('savedNote');
  const hidden = filteredJobs({ includeSaved: true }).filter((j) => savedIndex(j) != null).length;
  note.hidden = hidden === 0;
  if (!hidden) return;
  const toggle = el('button', { class: 'link-btn', type: 'button' }, state.showSaved ? 'Hide them' : 'Show them');
  toggle.onclick = () => {
    state.showSaved = !state.showSaved;
    render();
  };
  note.replaceChildren(
    state.showSaved
      ? `Showing ${hidden} job${hidden === 1 ? '' : 's'} already in your saved list. `
      : `${hidden} job${hidden === 1 ? '' : 's'} already in your saved list ${hidden === 1 ? 'is' : 'are'} hidden. `,
    toggle,
  );
}

function renderStats(jobs) {
  $('statSaved').textContent = state.saved.total == null ? '–' : `${state.saved.total} (${state.saved.ready} ready)`;
  $('statJobs').textContent =
    jobs.length === state.jobs.length ? String(jobs.length) : `${jobs.length} / ${state.jobs.length}`;
  $('statSources').textContent = String(new Set(jobs.map((j) => j.via)).size);
  const salaries = jobs.filter((j) => j.salary).map((j) => j.salary.mid);
  $('statSalary').textContent = salaries.length
    ? `${formatMoney(salaries.reduce((a, b) => a + b, 0) / salaries.length)}/yr`
    : '–';
}

function renderSourceFilter() {
  const select = $('sourceFilter');
  const current = select.value;
  const counts = new Map();
  for (const job of state.jobs) counts.set(job.via, (counts.get(job.via) || 0) + 1);

  select.replaceChildren(
    el('option', { value: '' }, `All boards (${state.jobs.length})`),
    ...[...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([via, n]) => el('option', { value: via }, `${via} (${n})`)),
  );
  select.value = counts.has(current) ? current : '';
}

function renderList(jobs) {
  const list = $('list');
  if (!state.query) {
    list.replaceChildren(el('div', { class: 'empty' }, 'Type keywords and press Search.'));
    return;
  }
  if (!jobs.length && !state.loading) {
    list.replaceChildren(
      el('div', { class: 'empty' }, state.jobs.length ? 'No jobs match these filters.' : 'No jobs found.'),
    );
    return;
  }

  list.replaceChildren(
    ...jobs.map((job) =>
      el(
        'div',
        {
          class: savedIndex(job) != null ? 'card is-saved' : 'card',
          role: 'option',
          tabindex: '0',
          'data-id': job.id,
          style: `--src: ${sourceColor(job.via)}`,
          onclick: () => selectJob(job.id),
        },
        el('div', { class: 'card-row' },
          el('input', {
            type: 'checkbox',
            class: 'pick',
            title: 'Select to tailor several resumes at once',
            'aria-label': `Select ${job.title} for batch tailoring`,
            checked: state.picked.has(job.id),
            onclick: (e) => e.stopPropagation(),
            onchange: (e) => togglePick(job.id, e.target),
          }),
          el('div', { class: 'card-title', title: job.title }, job.title),
          savedIndex(job) != null && el('span', { class: 'saved-tag', title: 'Already in your saved job list' }, `#${String(savedIndex(job)).padStart(4, '0')}${state.saved.status.get(savedIndex(job)) === 'ready' ? ' ✓ ready' : ''}`),
          el('span', { class: 'badge', title: job.via }, job.via),
        ),
        el('div', { class: 'card-meta' }, [job.company, formatAge(job)].filter(Boolean).join(' • ')),
        el('div', { class: 'card-row' },
          el('span', { class: 'card-salary' }, job.salary ? `${formatMoney(job.salary.min)} – ${formatMoney(job.salary.max)}` : job.location),
          job.match.score > 0 && el('span', { class: 'match' }, `${job.match.score}% match`),
        ),
      ),
    ),
  );
}

function highlightSelected() {
  for (const card of $('list').querySelectorAll('.card')) {
    card.setAttribute('aria-selected', String(card.dataset.id === state.selectedId));
  }
}

function renderDetail(job) {
  const detail = $('detail');
  if (!job) {
    detail.replaceChildren(
      el('div', { class: 'empty' }, state.query ? 'Select a job to see details.' : 'Results from LinkedIn, Indeed, ZipRecruiter, Glassdoor and more will appear here.'),
    );
    return;
  }

  const color = sourceColor(job.via);
  const salaryTile = job.salary
    ? `${formatMoney(job.salary.min)} – ${formatMoney(job.salary.max)}`
    : job.salaryText || 'Not listed';

  detail.replaceChildren(
    el('h2', {}, job.title),
    el('div', { class: 'sub' }, [job.company, job.location, job.remote && 'Remote'].filter(Boolean).join(' • ')),
    savedIndex(job) != null && el('div', { class: 'saved-note' }, `✓ Already saved as #${String(savedIndex(job)).padStart(4, '0')} (${state.saved.status.get(savedIndex(job)) === 'ready' ? 'Ready' : 'Not ready'}).`),
    el('div', { class: 'via-row', style: `--src: ${color}` },
      el('span', {}, el('span', { class: 'dot' }), `via ${job.via}`),
      el('span', { class: 'posted' }, formatAge(job)),
    ),
    el('div', { class: 'tiles' },
      el('div', { class: 'tile' }, el('span', { class: 'stat-label' }, 'Salary (annualized)'), el('span', { class: 'stat-value' }, salaryTile)),
      el('div', { class: 'tile' }, el('span', { class: 'stat-label' }, 'Keyword match'), el('span', { class: 'stat-value', style: 'color: var(--good)' }, `${job.match.score}%`)),
      el('div', { class: 'tile' }, el('span', { class: 'stat-label' }, 'Type'), el('span', { class: 'stat-value' }, job.schedule || '–')),
    ),
    job.match.terms.length > 0 && el('div', { class: 'section-label' }, 'Your keywords'),
    job.match.terms.length > 0 &&
      el('div', { class: 'chips' }, job.match.terms.map((t) => el('span', { class: t.hit ? 'chip hit' : 'chip' }, t.term))),
    el('div', { class: 'apply' },
      job.applyOptions.length
        ? job.applyOptions.slice(0, 4).map((o, i) =>
            el('a', { href: o.link, target: '_blank', rel: 'noopener noreferrer', class: i === 0 ? 'primary' : 'secondary' }, `Apply on ${o.title} ↗`),
          )
        : job.link && el('a', { href: job.link, target: '_blank', rel: 'noopener noreferrer', class: 'primary' }, 'View posting ↗'),
      el('button', { class: 'secondary', title: 'Tailor your resume to this job with Claude Code', onclick: () => openTailor(job) }, '✨ Tailor resume'),
    ),
    job.highlights.map((h) => [
      el('div', { class: 'section-label' }, h.title || 'Highlights'),
      el('ul', {}, (h.items || []).map((item) => el('li', {}, item))),
    ]),
    job.description && el('div', { class: 'section-label' }, 'Description'),
    job.description && el('div', { class: 'desc' }, job.description),
  );
  detail.scrollTop = 0;
}

function renderLoading(message) {
  $('list').replaceChildren(el('div', { class: 'empty' }, el('div', { class: 'spinner' }), message));
  $('detail').replaceChildren();
}

function renderError(err) {
  const box = el('div', { class: err.noKey ? 'empty' : 'empty error' }, err.message);
  if (err.noKey) {
    box.append(
      el('span', { style: 'color: var(--muted)' }, 'Add your free SerpApi key in Settings to start searching.'),
      el('button', { class: 'primary', onclick: () => chrome.runtime.openOptionsPage() }, 'Open settings'),
    );
  }
  $('list').replaceChildren(box);
  $('detail').replaceChildren();
}

// ---------- Actions ----------

function selectJob(id) {
  state.selectedId = id;
  highlightSelected();
  renderDetail(state.jobs.find((j) => j.id === id));
  saveCache();
}

// Tailoring runs in its own tab: the popup closes (and cancels requests) as soon as it loses focus.
async function openTailor(job) {
  await chrome.storage.local.set({ [`job:${job.id}`]: job });
  chrome.tabs.create({ url: `tailor.html?id=${encodeURIComponent(job.id)}` });
}

function togglePick(id, checkbox) {
  if (checkbox.checked && state.picked.size >= MAX_BATCH) {
    checkbox.checked = false;
    $('batchCount').textContent = `Up to ${MAX_BATCH} at a time`;
    return;
  }
  if (checkbox.checked) state.picked.add(id);
  else state.picked.delete(id);
  renderBatchBar();
}

function renderBatchBar() {
  const n = state.picked.size;
  $('batchBar').hidden = n === 0;
  $('batchCount').textContent = `${n} selected`;
  $('batchBtn').textContent = `✨ Tailor ${n} resume${n === 1 ? '' : 's'}`;
}

// Opens a tailoring tab for every ticked job, grouped together; each one asks Claude Code.
// The background script does the tab work because this popup closes once tabs open.
async function tailorPicked() {
  const jobs = state.jobs.filter((j) => state.picked.has(j.id));
  if (!jobs.length) return;
  await chrome.storage.local.set(Object.fromEntries(jobs.map((j) => [`job:${j.id}`, j])));
  await chrome.runtime.sendMessage({ type: 'tailorBatch', jobIds: jobs.map((j) => j.id) });
  state.picked.clear();
  window.close();
}

function setLoading(loading) {
  state.loading = loading;
  $('searchBtn').disabled = loading;
  $('searchBtn').textContent = loading ? 'Searching…' : 'Search';
  $('moreBtn').hidden = loading || !state.nextToken;
}

async function runSearch(event) {
  event.preventDefault();
  const query = {
    q: $('keywords').value.trim(),
    location: $('location').value.trim(),
    remote: $('remote').checked,
    datePosted: $('dateFilter').value,
  };
  if (!query.q || state.loading) return;

  state.query = query;
  state.jobs = [];
  state.nextToken = null;
  state.selectedId = null;
  state.picked.clear();
  renderBatchBar();
  setLoading(true);
  renderLoading('Searching job boards…');

  try {
    const page = await fetchJobs(query);
    state.jobs = page.jobs;
    state.nextToken = page.nextToken;
    await topUpRecentJobs();
    setLoading(false);
    render();
    saveCache();
  } catch (err) {
    console.error(err);
    setLoading(false);
    renderError(err);
  }
}

function addPage(page) {
  const seen = new Set(state.jobs.map((j) => j.id));
  state.jobs.push(...page.jobs.filter((j) => !seen.has(j.id)));
  state.nextToken = page.nextToken;
}

// With a date range picked, keep loading pages (each one is a SerpApi search) until there are
// enough jobs in that range or the limit is reached.
async function topUpRecentJobs() {
  if (!state.query.datePosted) return;
  for (let extra = 0; extra < TOPUP_MAX_PAGES && state.nextToken && filteredJobs().length < TOPUP_TARGET; extra++) {
    renderLoading(`Found ${filteredJobs().length} jobs in this period, looking for more…`);
    try {
      addPage(await fetchJobs(state.query, state.nextToken));
    } catch (err) {
      console.warn('Top-up stopped:', err);
      return;
    }
  }
}

async function loadMore() {
  if (!state.nextToken || state.loading) return;
  setLoading(true);
  $('moreBtn').hidden = true;

  try {
    addPage(await fetchJobs(state.query, state.nextToken));
    saveCache();
  } catch (err) {
    console.error(err);
    alert(`Could not load more jobs: ${err.message}`);
  } finally {
    setLoading(false);
    render();
  }
}

function updateMinSalaryLabel() {
  const v = Number($('minSalary').value);
  $('minSalaryLabel').textContent = v ? `${formatMoney(v)}+` : 'Any';
}

function onListKeydown(event) {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const jobs = visibleJobs();
  const idx = jobs.findIndex((j) => j.id === state.selectedId);
  const next = jobs[Math.max(0, Math.min(jobs.length - 1, idx + (event.key === 'ArrowDown' ? 1 : -1)))];
  if (!next) return;
  event.preventDefault();
  selectJob(next.id);
  const card = $('list').querySelector(`.card[data-id="${CSS.escape(next.id)}"]`);
  card?.focus();
  card?.scrollIntoView({ block: 'nearest' });
}

// ---------- Init ----------

async function init() {
  $('searchForm').addEventListener('submit', runSearch);
  $('moreBtn').addEventListener('click', loadMore);
  // Every job shown right now (filters apply; jobs already in your saved list are skipped).
  $('tailorAllBtn').addEventListener('click', async () => {
    const jobs = visibleJobs().filter((j) => savedIndex(j) == null);
    if (!jobs.length) return;
    if (jobs.length > 10 && !confirm(`Tailor ${jobs.length} resumes? Each one is a Claude Code request on your plan and takes about a minute.`)) return;
    await addToQueue(jobs);
    window.close();
  });
  $('batchBtn').addEventListener('click', tailorPicked);
  $('batchClear').addEventListener('click', () => {
    state.picked.clear();
    renderBatchBar();
    render();
  });
  $('settingsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());
  const openSaved = () => chrome.tabs.create({ url: 'saved.html' });
  $('savedBtn').addEventListener('click', openSaved);
  $('statSavedBox').addEventListener('click', openSaved);
  $('sourceFilter').addEventListener('change', render);
  $('sortBy').addEventListener('change', () => {
    chrome.storage.local.set({ sortBy: $('sortBy').value });
    render();
  });
  $('dateFilter').addEventListener('change', () => {
    chrome.storage.local.set({ dateFilter: $('dateFilter').value });
    render();
  });
  $('minSalary').addEventListener('input', () => {
    updateMinSalaryLabel();
    render();
  });
  $('list').addEventListener('keydown', onListKeydown);

  // Restore the previous search so closing the popup doesn't lose results (or API credits).
  const { lastSearch, dateFilter = '', sortBy = 'match' } = await chrome.storage.local.get(['lastSearch', 'dateFilter', 'sortBy']);
  $('dateFilter').value = dateFilter;
  $('sortBy').value = sortBy;
  if (lastSearch?.query) {
    Object.assign(state, {
      query: lastSearch.query,
      // Results cached before the date filter existed have no postedAt yet.
      jobs: (lastSearch.jobs || []).map((j) => ('postedAt' in j ? j : { ...j, postedAt: estimatePostedAt(j.posted) })),
      nextToken: lastSearch.nextToken || null,
      selectedId: lastSearch.selectedId || null,
    });
    $('keywords').value = lastSearch.query.q;
    $('location').value = lastSearch.query.location || '';
    $('remote').checked = Boolean(lastSearch.query.remote);
  }

  const { savedJobs } = await chrome.storage.local.get('savedJobs');
  setSavedJobs(savedJobs);
  updateMinSalaryLabel();
  render();
  refreshSavedJobs().then((fresh) => {
    if (!fresh) return;
    setSavedJobs(fresh);
    render();
  });

  const { apiKey } = await getSettings();
  if (!apiKey && !state.query) {
    const err = new Error('Welcome!');
    err.noKey = true;
    renderError(err);
  }
  $('keywords').focus();
}

init();
