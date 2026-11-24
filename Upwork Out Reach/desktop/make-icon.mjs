// Renders the app icon (build/icon.png, 512×512, transparent) from SVG with headless Chrome.
// Run once: node make-icon.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5fd39a"/><stop offset="1" stop-color="#16774c"/></linearGradient>
    <linearGradient id="env" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e3f5ea"/></linearGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#0b3d27" flood-opacity="0.35"/></filter>
  </defs>
  <rect x="24" y="24" width="464" height="464" rx="104" fill="url(#bg)"/>
  <rect x="24" y="24" width="464" height="232" rx="104" fill="#ffffff" opacity="0.08"/>
  <g filter="url(#sh)">
    <rect x="112" y="150" width="288" height="212" rx="30" fill="url(#env)"/>
    <path d="M128 172 L256 270 L384 172" fill="none" stroke="#1f8a5b" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <circle cx="384" cy="150" r="54" fill="#ffd166" stroke="#16774c" stroke-width="14"/>
  <path d="M362 150 l15 15 l28 -30" fill="none" stroke="#16774c" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const out = path.join(import.meta.dirname, "build", "icon.png");
fs.mkdirSync(path.dirname(out), { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "icon-"));
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--remote-debugging-port=9335", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 40 && !target; i++) {
  await sleep(250);
  target = await fetch("http://127.0.0.1:9335/json/list").then((r) => r.json()).then((l) => l.find((t) => t.type === "page")).catch(() => null);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const waiting = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (waiting.has(d.id)) waiting.get(d.id)(d), waiting.delete(d.id);
};
const cdp = (method, params = {}) => new Promise((r) => (waiting.set(++id, r), ws.send(JSON.stringify({ id, method, params }))));
await cdp("Emulation.setDeviceMetricsOverride", { width: 512, height: 512, deviceScaleFactor: 1, mobile: false });
await cdp("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
await cdp("Page.navigate", { url: "data:text/html," + encodeURIComponent(`<style>html,body{margin:0;background:transparent}</style>${SVG}`) });
await sleep(800);
const shot = await cdp("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 512, height: 512, scale: 1 } });
fs.writeFileSync(out, Buffer.from(shot.result.data, "base64"));
ws.close();
chrome.kill();
console.log("Wrote", out);
