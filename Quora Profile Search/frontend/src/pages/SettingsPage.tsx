import { FormEvent, useEffect, useState } from "react";
import { api, type AppSettings } from "../api/client";

type Field = { key: string; label: string; help: string; link?: string; secret?: boolean; placeholder?: string };

const SECTIONS: { title: string; note: string; fields: Field[] }[] = [
  {
    title: "AI (optional)",
    note: "Without a key, the app runs in free mode: details are found with rules instead of AI (fewer results), "
      + "and summaries and the assistant are basic. With a key, Claude reads each profile.",
    fields: [{ key: "anthropic_api_key", label: "Anthropic API key", secret: true, placeholder: "sk-ant-…",
               help: "console.anthropic.com → API Keys", link: "https://console.anthropic.com/settings/keys" }],
  },
  {
    title: "Search engine (required)",
    note: "Finds Quora profiles, Medium authors, Reddit posts, LinkedIn snippets and personal websites. "
      + "You only need ONE key, for the provider selected below. Tavily and Serper have free plans with no card.",
    fields: [
      { key: "tavily_api_key", label: "Tavily API key (free: about 1,000 searches a month)", secret: true, placeholder: "tvly-…",
        help: "app.tavily.com → sign up → copy your API key", link: "https://app.tavily.com" },
      { key: "serper_api_key", label: "Serper API key (free: 2,500 searches on sign-up)", secret: true,
        help: "serper.dev → sign up → API Key", link: "https://serper.dev" },
      { key: "brave_api_key", label: "Brave Search API key (paid)", secret: true,
        help: "api-dashboard.search.brave.com → API Keys", link: "https://api-dashboard.search.brave.com" },
      { key: "google_api_key", label: "Google API key (alternative to Brave)", secret: true,
        help: "Only needed if you choose Google below" },
      { key: "google_cse_id", label: "Google Programmable Search engine ID", help: "programmablesearchengine.google.com" },
    ],
  },
  {
    title: "Reddit API (optional)",
    note: "Without these keys, Reddit is still searched through the search engine, but only short snippets of each post are seen. "
      + "With the official Reddit API, the bot reads whole posts and can verify links. Create a “script” or “web app” at reddit.com/prefs/apps.",
    fields: [
      { key: "reddit_client_id", label: "Reddit client ID", help: "The short code under your app's name",
        link: "https://www.reddit.com/prefs/apps" },
      { key: "reddit_client_secret", label: "Reddit client secret", secret: true, help: "The value labeled “secret”" },
      { key: "reddit_user_agent", label: "Reddit user agent", help: "Must include your Reddit username",
        placeholder: "web:contact-discovery:1.0 (by /u/yourname)" },
      { key: "reddit_default_subreddits", label: "Default communities", help: "Comma-separated, without r/" },
    ],
  },
  {
    title: "GitHub (optional)",
    note: "A token raises GitHub's rate limit for profile lookups. It needs no scopes.",
    fields: [{ key: "github_token", label: "GitHub token", secret: true, help: "github.com/settings/tokens",
               link: "https://github.com/settings/tokens" }],
  },
];

export default function SettingsPage() {
  const [s, setS] = useState<AppSettings | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const apply = (next: AppSettings) => {
    setS(next);
    setValues(next.values);
  };
  useEffect(() => {
    api.settings().then(apply).catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      apply(await api.saveSettings(values));
      setMsg({ ok: true, text: "Saved. New searches will use these settings." });
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  if (!s) return msg ? <div className="alert">{msg.text}</div> : <div className="progress muted"><span className="spinner" />Loading…</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <div className="sub">API keys are stored only on this computer, in your user profile.</div>
        </div>
      </div>
      {!s.editable && (
        <div className="notice" style={{ marginBottom: 16 }}>
          This server is configured through its <code>.env</code> file, so settings can't be changed here.
        </div>
      )}
      <form className="stack" onSubmit={save}>
        {SECTIONS.map((sec) => (
          <div key={sec.title} className="card">
            <h2>{sec.title}</h2>
            <div className="muted small" style={{ marginBottom: 12 }}>{sec.note}</div>
            <div className="stack" style={{ gap: 12 }}>
              {sec.fields.map((f) => (
                <label key={f.key} className="field">
                  <span className="row" style={{ gap: 6 }}>
                    {f.label}
                    {f.key === "reddit_default_subreddits" ? <span className="badge">Default</span>
                      : s.configured[f.key] ? <span className="badge verified">Set</span>
                      : f.key === "reddit_user_agent" ? <span className="badge self_reported">Replace your_reddit_username</span>
                      : <span className="badge">Not set</span>}
                  </span>
                  <input
                    type={f.secret ? "password" : "text"}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={!s.editable}
                    placeholder={f.placeholder}
                    value={values[f.key] ?? ""}
                    onFocus={(e) => f.secret && e.target.value.includes("•") && setValues((v) => ({ ...v, [f.key]: "" }))}
                    onBlur={(e) => f.secret && e.target.value === "" && setValues((v) => ({ ...v, [f.key]: s.values[f.key] ?? "" }))}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                  <span className="small muted">
                    {f.help}
                    {f.link && <> · <a href={f.link} target="_blank" rel="noreferrer">open</a></>}
                  </span>
                </label>
              ))}
              {sec.title.startsWith("AI") && (
                <label className="field">Personal email addresses
                  <select disabled={!s.editable} value={String(values.include_personal_emails ?? "true")}
                          onChange={(e) => setValues((v) => ({ ...v, include_personal_emails: e.target.value }))}>
                    <option value="true">Keep them when the person published them (labeled Personal)</option>
                    <option value="false">Only keep business addresses</option>
                  </select>
                </label>
              )}
              {sec.title.startsWith("AI") && (
                <label className="field">Mode
                  <select disabled={!s.editable} value={values.ai_mode || "auto"}
                          onChange={(e) => setValues((v) => ({ ...v, ai_mode: e.target.value }))}>
                    <option value="auto">Use Claude when a key is set, otherwise free mode</option>
                    <option value="off">Always use free mode (no AI, no cost)</option>
                  </select>
                  <span className="small muted">
                    Currently using: {s.ai_active === "claude" ? "Claude (AI)" : "free mode (rules, no AI)"}
                  </span>
                </label>
              )}
              {sec.title.startsWith("Search engine") && (
                <label className="field">Search provider
                  <select disabled={!s.editable} value={values.search_provider || "tavily"}
                          onChange={(e) => setValues((v) => ({ ...v, search_provider: e.target.value }))}>
                    <option value="tavily">Tavily (free plan)</option>
                    <option value="serper">Serper / Google results (free credits)</option>
                    <option value="brave">Brave Search</option>
                    <option value="google">Google Programmable Search</option>
                  </select>
                  <span className="small muted">
                    {s.search_ready
                      ? `Searches will use ${({ tavily: "Tavily", serper: "Serper", brave: "Brave", google: "Google" } as Record<string, string>)[s.active_provider] ?? s.active_provider}. If the selected provider has no key, any other saved key is used automatically.`
                      : "Paste one search key above (Tavily is free), then save."}
                  </span>
                </label>
              )}
            </div>
          </div>
        ))}
        {msg && <div className={msg.ok ? "notice" : "alert"}>{msg.text}</div>}
        {s.editable && (
          <div className="row">
            <button className="btn primary" disabled={saving}>{saving ? "Saving…" : "Save settings"}</button>
          </div>
        )}
      </form>
    </>
  );
}
