// Packages the backend + Contacts app into one executable (Node single executable application).
//   npm run build  ->  dist/UpworkOutreach.exe (or dist/UpworkOutreach on macOS/Linux)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const dist = path.join(here, "dist");
const exe = path.join(dist, "UpworkOutreach" + (process.platform === "win32" ? ".exe" : ""));
// npx is a .cmd script on Windows, so it needs a shell; quote paths for it (they contain spaces).
const run = (cmd, args) =>
  cmd === "npx" && process.platform === "win32"
    ? execFileSync(cmd, args.map((a) => (/\s/.test(a) ? `"${a}"` : a)), { cwd: here, stdio: "inherit", shell: true })
    : execFileSync(cmd, args, { cwd: here, stdio: "inherit" });

fs.mkdirSync(dist, { recursive: true });
// A running copy can't be overwritten on Windows, but it can be renamed: move it aside so the
// new build takes its place, and clear out older leftovers that are no longer running.
for (const f of fs.readdirSync(dist)) {
  if (/^UpworkOutreach\.old-\d+(\.exe)?$/.test(f))
    try {
      fs.rmSync(path.join(dist, f), { force: true });
    } catch {} // still running — removed by a later build
}
for (const f of fs.readdirSync(dist).filter((f) => !f.startsWith("UpworkOutreach.old-") && f !== ".env")) {
  const p = path.join(dist, f);
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    fs.renameSync(p, path.join(dist, `UpworkOutreach.old-${Date.now()}${path.extname(f)}`));
  }
}

// 1. Single executables run CommonJS, so turn server.js's imports into requires.
const src = fs
  .readFileSync(path.join(here, "server.js"), "utf8")
  .replace(/^import (\w+) from "(node:[\w/]+)";$/gm, 'const $1 = require("$2");')
  .replace(/^import \{ ([\w, ]+) \} from "(node:[\w/]+)";$/gm, 'const { $1 } = require("$2");')
  .replaceAll("import.meta.dirname", "__dirname");
if (/^import /m.test(src)) throw new Error("server.js has an import the build can't convert");
fs.writeFileSync(path.join(dist, "server.cjs"), src);

// 2. Bundle it with the app files as embedded assets.
const config = {
  main: path.join(dist, "server.cjs"),
  output: path.join(dist, "sea-prep.blob"),
  disableExperimentalSEAWarning: true,
  assets: {
    ...Object.fromEntries(["index.html", "app.css", "app.js"].map((f) => [f, path.join(here, "app", f)])),
    // The extension's GitHub / website lookup, shared with the app's GitHub lookup.
    "insights.js": path.join(here, "..", "extension", "insights.js"),
  },
};
fs.writeFileSync(path.join(dist, "sea-config.json"), JSON.stringify(config, null, 2));
run(process.execPath, ["--experimental-sea-config", path.join(dist, "sea-config.json")]);

// 3. Copy this Node binary and inject the blob into it.
fs.copyFileSync(process.execPath, exe);
const postject = [
  "--yes", "postject@1.0.0-alpha.6", exe, "NODE_SEA_BLOB", config.output,
  "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
];
if (process.platform === "darwin") postject.push("--macho-segment-name", "NODE_SEA");
run("npx", postject);

// 4. Windows: mark it as a GUI program so no console window opens. It lives in the tray instead.
if (process.platform === "win32") {
  const fd = fs.openSync(exe, "r+");
  const header = Buffer.alloc(1024);
  fs.readSync(fd, header, 0, header.length, 0);
  const pe = header.readUInt32LE(0x3c);
  if (header.toString("latin1", pe, pe + 4) !== "PE\0\0") throw new Error("Unexpected executable format");
  const subsystem = pe + 24 + 68; // PE signature + COFF header + offset in the optional header
  fs.writeSync(fd, Buffer.from([2, 0]), 0, 2, subsystem); // IMAGE_SUBSYSTEM_WINDOWS_GUI
  fs.closeSync(fd);
}

for (const f of ["server.cjs", "sea-config.json", "sea-prep.blob"]) fs.rmSync(path.join(dist, f));
if (fs.existsSync(path.join(here, ".env"))) fs.copyFileSync(path.join(here, ".env"), path.join(dist, ".env"));
console.log(`\nBuilt ${exe}`);
