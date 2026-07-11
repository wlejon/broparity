// Dev helper: scan out/ runs and print mismatching entries for each case seen
// (newest run per case wins). Usage: node scan-diffs.mjs [substr]
import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const outRoot = resolve(ROOT, "out");
const filter = process.argv[2] ?? "";

const runs = (await readdir(outRoot)).sort(); // ISO ids sort chronologically
const latest = new Map(); // "cat/case" -> diff path

for (const run of runs) {
  const runDir = resolve(outRoot, run);
  let cats;
  try { cats = await readdir(runDir); } catch { continue; }
  for (const cat of cats) {
    const catDir = resolve(runDir, cat);
    if (!(await stat(catDir)).isDirectory()) continue;
    for (const cs of await readdir(catDir)) {
      const p = resolve(catDir, cs, "layout.diff.json");
      try { await stat(p); latest.set(`${cat}/${cs}`, p); } catch {}
    }
  }
}

for (const [key, p] of [...latest.entries()].sort()) {
  if (filter && !key.includes(filter)) continue;
  const d = JSON.parse(await readFile(p, "utf8"));
  const bad = d.entries.filter(e => e.rectMismatch || e.styleMismatch);
  if (!bad.length) continue;
  console.log(`===== ${key}`);
  for (const e of bad) {
    console.log(" ", e.path, JSON.stringify(e.rectDelta), JSON.stringify(e.styleDeltas ?? {}));
  }
}
