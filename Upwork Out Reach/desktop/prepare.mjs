// Copies the backend, the Contacts app and the extension's lookup code into bundle/, keeping the
// same relative layout server.js expects (backend/app/*, extension/insights.js).
import fs from "node:fs";
import path from "node:path";

const here = import.meta.dirname;
const root = path.join(here, "..");
const out = path.join(here, "bundle");
fs.rmSync(out, { recursive: true, force: true });
const copy = (from, to) => {
  fs.mkdirSync(path.dirname(path.join(out, to)), { recursive: true });
  fs.cpSync(path.join(root, from), path.join(out, to), { recursive: true });
};
copy("backend/server.js", "backend/server.js");
copy("backend/package.json", "backend/package.json"); // "type": "module" for server.js
for (const f of ["index.html", "app.css", "app.js"]) copy(`backend/app/${f}`, `backend/app/${f}`);
copy("extension/insights.js", "extension/insights.js");
console.log("Bundled app files into", out);
