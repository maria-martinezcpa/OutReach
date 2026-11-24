// Upwork Outreach desktop app: runs the backend (contacts store, extension sync, GitHub lookups)
// inside this process and shows the Contacts app in a Windows 11 style window.
// Closing the window keeps it in the tray so the Chrome extension can still sync.
const { app, BrowserWindow, Tray, Menu, nativeTheme, nativeImage, shell, dialog, Notification } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { execFileSync } = require("node:child_process");

const PORT = Number(process.env.PORT) || 8787;
const APP_URL = `http://127.0.0.1:${PORT}/`;
const ICON = path.join(__dirname, "build", "icon.png");
// Electron's own browser data (cache, local storage) goes in a subfolder, apart from contacts.json.
app.setPath("userData", path.join(app.getPath("appData"), "Upwork Outreach", "desktop-app"));
const startedHidden =process.argv.includes("--background") || app.getLoginItemSettings().wasOpenedAtLogin;

if (!app.requestSingleInstanceLock()) {
  app.quit(); // already running: that copy shows its window (second-instance below)
} else {
  app.setAppUserModelId("com.upworkoutreach.contacts");
  app.on("second-instance", () => showWindow());
  app.whenReady().then(start);
}

let win = null;
let tray = null;
let quitting = false;
let hintShown = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function backendUp() {
  try {
    return (await fetch(`http://127.0.0.1:${PORT}/health`)).ok;
  } catch {
    return false;
  }
}

async function startBackend() {
  // The older tray-only UpworkOutreach.exe uses the same port; this app replaces it.
  if (await backendUp()) {
    try {
      execFileSync("taskkill", ["/IM", "UpworkOutreach.exe", "/F"], { windowsHide: true, stdio: "ignore" });
    } catch {}
    for (let i = 0; i < 20 && (await backendUp()); i++) await sleep(250);
    if (await backendUp()) {
      dialog.showErrorBox("Upwork Outreach", `Another program is using port ${PORT} (perhaps "npm start" in the backend folder). Close it and open Upwork Outreach again.`);
      app.exit(1);
      return false;
    }
  }
  process.env.OUTREACH_EMBEDDED = "1";
  await import(pathToFileURL(path.join(__dirname, "bundle", "backend", "server.js")).href);
  for (let i = 0; i < 50 && !(await backendUp()); i++) await sleep(100);
  return true;
}

// Caption buttons (minimize / maximize / close) drawn over the page's own top bar.
const overlay = () =>
  nativeTheme.shouldUseDarkColors
    ? { color: "#1b2420", symbolColor: "#e3ebe7", height: 56 }
    : { color: "#f1f6f2", symbolColor: "#1b2420", height: 56 };

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: "Upwork Outreach",
    icon: ICON,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#141b18" : "#eef3ef",
    titleBarStyle: "hidden",
    titleBarOverlay: overlay(),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: true },
  });
  win.loadURL(APP_URL);
  win.once("ready-to-show", () => !startedHidden && win.show()); // started with Windows: stay in the tray

  // Links (GitHub profiles, websites, mailto) open in the normal browser / mail app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto|tel):/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(APP_URL) && !url.startsWith(`http://localhost:${PORT}/`)) {
      e.preventDefault();
      if (/^(https?|mailto|tel):/i.test(url)) shell.openExternal(url);
    }
  });

  // Close = keep running in the tray (the extension keeps syncing); Quit is in the tray menu.
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
    if (!hintShown && Notification.isSupported()) {
      hintShown = true;
      new Notification({ title: "Upwork Outreach is still running", body: "It keeps your contacts in sync from the tray. Right-click the tray icon to quit.", icon: ICON }).show();
    }
  });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip("Upwork Outreach");
  const menu = () =>
    Menu.buildFromTemplate([
      { label: "Open Upwork Outreach", click: showWindow },
      { type: "separator" },
      {
        label: "Start with Windows",
        type: "checkbox",
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ["--background"] }),
      },
      { type: "separator" },
      { label: "Quit (stops syncing)", click: () => ((quitting = true), app.quit()) },
    ]);
  tray.setContextMenu(menu());
  tray.on("right-click", () => tray.setContextMenu(menu()));
  tray.on("click", showWindow);
}

async function start() {
  if (!(await startBackend())) return;
  createWindow();
  createTray();
  nativeTheme.on("updated", () => win?.setTitleBarOverlay(overlay()));
}

app.on("before-quit", () => (quitting = true));
app.on("window-all-closed", (e) => e.preventDefault()); // stay in the tray
