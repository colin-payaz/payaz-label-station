// Copies the web app into www/ for the Android app (the repo root stays the
// GitHub Pages site). Run by `npm run sync` and by the GitHub build.
import { cpSync, rmSync, mkdirSync } from "node:fs";
rmSync("www", { recursive: true, force: true });
mkdirSync("www");
for (const p of ["index.html", "manifest.webmanifest", "js", "fonts", "img"]) cpSync(p, `www/${p}`, { recursive: true });
console.log("www/ ready");
