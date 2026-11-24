# Upwork Outreach Assistant

Dark-themed Chrome side panel for user-initiated freelancer research, local contact management, and Claude-drafted collaboration emails.

```
extension/   Chrome MV3 side panel (capture, accounts, contacts, Gmail compose)
backend/     Tiny Node server that holds the Claude API key and drafts emails
```

## Run

1. Backend — drafts emails through your local **Claude Code** login (no API key)
   ```
   cd backend
   npm start                   # http://localhost:8787
   ```
   `claude.exe` is found on PATH, in `~/.local/bin`, or in the VS Code extension; set `CLAUDE_PATH` in `backend/.env` to override.
   Check with `http://localhost:8787/health`.
2. Extension: `chrome://extensions` → Developer mode → **Load unpacked** → select `extension/`.
3. On an Upwork talent search page, open the side panel and press **Start**.
   Each freelancer profile is read in the background (one at a time, 3–7 s apart), and linked
   GitHub / Stack Overflow accounts are enriched via their public APIs (commits, languages, reputation, top tags).
4. Results appear both in the panel and as a bar on each Upwork card. **Send email** drafts a tailored
   email with Claude, opens it in Gmail, and saves the contact.
5. Optional: add a GitHub token in Settings to raise the API rate limit.

## Design boundaries

- Capture runs only when you click **Capture this profile**, and only reads the open tab. No crawling or background scraping.
- Email, phone and Telegram are never scraped; you add them manually with a source and verification flag.
- Only accounts you tick as "same person" are sent to Claude.
- Contacts live in IndexedDB on your machine. Email drafts are never stored.
- Gmail opens a compose window; you review and click Send.

## Contacts app

A separate page for working through saved contacts, served by the backend at
**http://localhost:8787/** (open it directly, or use **Open Contacts app** in the extension's Contacts tab).

- The extension and the app sync both ways through the backend: every 30 seconds while Chrome is open, and
  whenever a contact is saved, edited or deleted. The newest edit of a contact wins. If the backend is down,
  changes wait and sync when it returns, including deletes. The side panel header shows the sync state; click
  it to sync now. You can also **Import JSON** from the extension's "Export contacts".
- Pick the recipient (any saved email, or type another), press **Send email**: Claude Code drafts a tailored
  email, you can edit it, and Gmail opens with it filled in. The chosen address is remembered and the status
  moves to "Draft opened".
- **GitHub lookup**: paste a GitHub profile link to find the person's email, Telegram, phone and websites
  with the same method the extension uses for GitHub accounts linked on Upwork (profile and README, the
  author email of their own commits, and the websites they link). Pick which details to keep, then save
  them as a new contact, or add them to the matching saved contact. A saved GitHub account also has a
  **Find contact info** button. Add a GitHub token in **Settings** for more than about 10 lookups an hour.
  The backend runs `extension/insights.js` (embedded in the .exe), so both always search the same way.
- Email settings (your name, goals, tone) are under **Settings** in the app.
- Drafts are kept only in the open page, never saved. Only localhost pages and the extension can reach the data.

### Desktop app (installer)

`cd desktop && npm install && npm run dist` builds **`desktop/dist/UpworkOutreach-Setup-1.0.0.exe`**, a per-user
installer (no admin rights) with Start menu and desktop shortcuts and an uninstaller in Settings → Apps.
The app runs the same backend inside itself and shows the Contacts app in its own window with a Windows 11 title bar.
Closing the window keeps it in the tray, so the extension keeps syncing. Right-click the tray icon for
**Start with Windows** and **Quit**. It replaces `UpworkOutreach.exe` below and closes that if it's running.
Contacts and settings stay in `%APPDATA%\Upwork Outreach`. The window's own browser data goes in its `desktop-app` subfolder.
`npm start` in `desktop/` runs it without installing. When starting it from a VS Code terminal, clear
`ELECTRON_RUN_AS_NODE` first: VS Code sets it, and it makes Electron run as plain Node.

- **Find emails** (top bar) searches GitHub for every contact without an email: their GitHub account if they
  have one, otherwise an account found by name (used only when exactly one person matches; those emails are
  marked **Check**). It runs in the background, saves results as they arrive, waits out GitHub's rate limit,
  and skips contacts checked in the last 30 days.

### Older tray app (Windows .exe)

`cd backend && npm run build` packages the backend and the Contacts app into **`backend/dist/UpworkOutreach.exe`**
(one file, Node not required on the machine). Double-click it: it starts the backend on port 8787 and opens the
Contacts app in its own Chrome window. There is no console window: it keeps running in the system tray after you
close the Contacts window. Click the tray icon to reopen the app; right-click it for **Start with Windows** and
**Quit**. Running the .exe again while it's already running just opens another window.

- Contacts and settings are stored in `%APPDATA%\Upwork Outreach` (shared with `npm start`), along with `app.log`,
  which records starts, stops and errors.
- Optional settings (`PORT`, `CLAUDE_PATH`, `CLAUDE_MODEL`, `ALLOWED_EXTENSION_ID`) go in a `.env` next to the .exe.
- Windows may show a SmartScreen warning the first time because the .exe isn't code-signed: **More info → Run anyway**.
