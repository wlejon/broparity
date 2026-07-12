// Publish a parity run to the gh-pages branch under a per-platform subdirectory,
// and regenerate a top-level landing page that summarizes each platform.
//
// Usage:
//   node publish.mjs                                  # publish most recent out/<run>/, auto-detect platform
//   node publish.mjs --platform windows               # force the platform slug
//   node publish.mjs --platform macos out/<run>/      # publish specific run as macos
//   node publish.mjs --dry-run                        # build the worktree but don't commit/push
//   node publish.mjs --no-push                        # commit locally, skip push
//
// Site layout produced on gh-pages:
//   /index.html         landing page (auto-generated from manifest.json)
//   /manifest.json      what's published per platform
//   /windows/           full report (index.html + summary.html + tables/...)
//   /macos/             same shape, added when you publish from a Mac
//   /linux/             same shape
//   /.nojekyll
//
// The published site URL is https://wlejon.github.io/broparity/

import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync, rmSync, cpSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { platformSlug as detectPlatformSlug } from "./system-info.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const noPush = args.includes("--no-push");
let forcedPlatform = null;
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--platform") { forcedPlatform = args[++i]; continue; }
  if (a === "--dry-run" || a === "--no-push") continue;
  positional.push(a);
}

const REPO = resolve(import.meta.dirname);
const OUT = resolve(REPO, "out");
const WT = resolve(REPO, ".gh-pages-wt");
const BRANCH = "gh-pages";
const SITE_URL = "https://wlejon.github.io/broparity/";

function sh(cmd, opts = {}) {
  return execSync(cmd, { cwd: REPO, stdio: opts.silent ? "pipe" : "inherit", encoding: "utf8", ...opts });
}
function shOut(cmd, opts = {}) {
  return execSync(cmd, { cwd: REPO, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", ...opts }).trim();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function resolveRunDir() {
  if (positional[0]) {
    const p = resolve(positional[0]);
    if (!existsSync(join(p, "index.html"))) throw new Error(`No index.html in ${p} — is this a run dir?`);
    return p;
  }
  if (!existsSync(OUT)) throw new Error(`No out/ directory at ${OUT}`);
  const runs = readdirSync(OUT)
    .map(n => ({ n, full: join(OUT, n) }))
    .filter(e => statSync(e.full).isDirectory() && existsSync(join(e.full, "index.html")))
    .sort((a, b) => b.n.localeCompare(a.n));
  if (!runs.length) throw new Error("No runs found in out/");
  return runs[0].full;
}

function readSummary(runDir) {
  const p = join(runDir, "summary.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

function ensureWorktree() {
  if (existsSync(WT)) {
    try { sh(`git worktree remove --force "${WT}"`, { silent: true }); } catch {}
    if (existsSync(WT)) rmSync(WT, { recursive: true, force: true });
  }
  let hasLocal = false;
  try { shOut(`git show-ref --verify refs/heads/${BRANCH}`, { silent: true }); hasLocal = true; } catch {}
  let hasRemote = false;
  try {
    sh(`git fetch origin ${BRANCH}`, { silent: true });
    shOut(`git show-ref --verify refs/remotes/origin/${BRANCH}`, { silent: true });
    hasRemote = true;
  } catch {}

  if (hasLocal) {
    sh(`git worktree add "${WT}" ${BRANCH}`);
  } else if (hasRemote) {
    sh(`git worktree add -b ${BRANCH} "${WT}" origin/${BRANCH}`);
  } else {
    console.log(`Creating new orphan ${BRANCH} branch.`);
    sh(`git worktree add --detach "${WT}"`);
    sh(`git -C "${WT}" checkout --orphan ${BRANCH}`);
    try { sh(`git -C "${WT}" rm -rf .`, { silent: true }); } catch {}
  }
}

function readManifest() {
  const p = join(WT, "manifest.json");
  if (!existsSync(p)) return { platforms: {} };
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return { platforms: {} }; }
}

function writeManifest(m) {
  writeFileSync(join(WT, "manifest.json"), JSON.stringify(m, null, 2) + "\n");
}

function copyRun(runDir, platformDir) {
  if (existsSync(platformDir)) rmSync(platformDir, { recursive: true, force: true });
  cpSync(runDir, platformDir, { recursive: true });
}

function scoreBand(p) {
  if (p >= 99.5) return "good";
  if (p >= 95) return "ok";
  if (p >= 85) return "mid";
  return "bad";
}

function renderLanding(manifest) {
  const platforms = Object.entries(manifest.platforms || {})
    .sort(([a], [b]) => a.localeCompare(b));
  const cards = platforms.map(([slug, p]) => {
    const layoutN = (p.overall?.layoutScore ?? 0) * 100;
    const pixelN = (p.overall?.pixelScore ?? 0) * 100;
    const layoutPct = layoutN.toFixed(1);
    const pixelPct = pixelN.toFixed(1);
    const cases = p.overall?.caseCount ?? 0;
    const cats = p.overall?.categoryCount ?? 0;
    const os = p.system?.os || slug;
    const cpu = p.system?.cpu
      ? `${p.system.cpu}${p.system.cpuCount ? ` · ${p.system.cpuCount}t` : ""}`
      : null;
    const gpu = p.system?.gpus?.length ? p.system.gpus.join(", ") : null;
    const published = (p.publishedAt || "").slice(0, 10);
    return `
      <a class="card" href="${escapeHtml(slug)}/index.html">
        <div class="card-top">
          <span class="slug">${escapeHtml(slug)}</span>
          ${published ? `<span class="date">${escapeHtml(published)}</span>` : ""}
        </div>
        <div class="card-title">${escapeHtml(os)}</div>
        <div class="card-metrics">
          <div class="m"><div class="v ${scoreBand(layoutN)}">${layoutPct}%</div><div class="l">layout</div></div>
          <div class="m"><div class="v ${scoreBand(pixelN)}">${pixelPct}%</div><div class="l">pixels</div></div>
          <div class="m"><div class="v">${cases}</div><div class="l">cases</div></div>
        </div>
        <div class="card-meta">
          ${cpu ? `<div>${escapeHtml(cpu)}</div>` : ""}
          ${gpu ? `<div>${escapeHtml(gpu)}</div>` : ""}
          ${cats ? `<div>${cats} categories</div>` : ""}
        </div>
        <div class="card-foot">Open report →</div>
      </a>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>broparity — Bro vs Chromium</title>
<style>
:root {
  color-scheme: dark;
  --bg: #0d1117;
  --bg-1: #161b22;
  --bg-2: #1c2128;
  --border: #30363d;
  --text: #e6edf3;
  --muted: #8b949e;
  --dim: #6e7681;
  --accent: #58a6ff;
  --good: #3fb950;
  --ok: #56d364;
  --mid: #d29922;
  --bad: #f85149;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 960px; margin: 0 auto; padding: 40px 20px 64px; }
header h1 {
  margin: 0 0 6px;
  font-size: 28px;
  font-weight: 650;
  letter-spacing: -0.03em;
}
.tag {
  color: var(--muted);
  font-size: 14px;
  margin-bottom: 22px;
}
.intro {
  color: var(--muted);
  font-size: 14px;
  line-height: 1.55;
  margin-bottom: 28px;
  max-width: 62ch;
}
.intro a { color: var(--accent); text-decoration: none; }
.intro a:hover { text-decoration: underline; }
.intro strong { color: var(--text); font-weight: 550; }
h2 {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  margin: 0 0 12px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
}
.card {
  display: flex;
  flex-direction: column;
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px;
  text-decoration: none;
  color: inherit;
  transition: border-color 0.12s, background 0.12s, transform 0.12s;
}
.card:hover {
  border-color: var(--accent);
  background: var(--bg-2);
  transform: translateY(-1px);
  text-decoration: none;
}
.card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.slug {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--accent);
  background: rgba(88, 166, 255, 0.12);
  padding: 2px 8px;
  border-radius: 999px;
}
.date { font-size: 11px; color: var(--dim); font-variant-numeric: tabular-nums; }
.card-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 14px;
  letter-spacing: -0.01em;
}
.card-metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 14px;
}
.m .v {
  font-size: 22px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
  line-height: 1.1;
}
.m .v.good { color: var(--good); }
.m .v.ok { color: var(--ok); }
.m .v.mid { color: var(--mid); }
.m .v.bad { color: var(--bad); }
.m .l {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--dim);
  margin-top: 3px;
}
.card-meta {
  font-size: 12px;
  color: var(--muted);
  line-height: 1.45;
  flex: 1;
}
.card-meta div { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-foot {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  font-size: 12px;
  color: var(--accent);
  font-weight: 500;
}
.empty {
  background: var(--bg-1);
  border: 1px dashed var(--border);
  border-radius: 10px;
  padding: 28px;
  text-align: center;
  color: var(--muted);
  font-size: 14px;
}
footer {
  margin-top: 36px;
  color: var(--dim);
  font-size: 12px;
}
footer a { color: var(--muted); text-decoration: none; }
footer a:hover { color: var(--accent); }
</style>
</head><body>
<div class="wrap">
  <header>
    <h1>broparity</h1>
    <div class="tag">Bro vs Chromium rendering parity</div>
  </header>
  <p class="intro">
    <a href="https://github.com/wlejon/bro"><strong>Bro</strong></a> is an HTML/CSS/JS runtime with its own layout engine.
    <a href="https://github.com/wlejon/broparity">Broparity</a> compares Bro to Chromium on UA-neutral test pages
    (pixels + structural layout dumps). Host-dependent — tracked per platform.
  </p>

  <h2>Platforms</h2>
  ${platforms.length ? `<div class="grid">${cards}</div>` : `<div class="empty">No platforms published yet.</div>`}

  <footer>
    Updated ${escapeHtml(new Date().toISOString().slice(0, 10))} ·
    <a href="https://github.com/wlejon/broparity">github.com/wlejon/broparity</a>
  </footer>
</div>
</body></html>
`;
}

function commitAndPush(runId, platformSlug) {
  sh(`git -C "${WT}" add -A`);
  const status = shOut(`git -C "${WT}" status --porcelain`);
  if (!status) {
    console.log("No changes to publish — site already matches this run.");
    return false;
  }
  const msg = `publish ${platformSlug}: parity report ${runId}`;
  sh(`git -C "${WT}" commit -m "${msg}"`);
  if (noPush) {
    console.log("--no-push: skipping push.");
  } else {
    sh(`git -C "${WT}" push origin ${BRANCH}`);
  }
  return true;
}

function main() {
  const runDir = resolveRunDir();
  const runId = basename(runDir);
  const summary = readSummary(runDir);
  const platform = forcedPlatform || summary?.system?.platformSlug || detectPlatformSlug();

  console.log(`Publishing run: ${runId}`);
  console.log(`Platform:       ${platform}`);
  console.log(`From:           ${runDir}`);
  if (!summary) {
    console.warn("WARNING: this run has no summary.json. Re-run with the latest run.mjs to get system info on the landing page.");
  }

  ensureWorktree();
  const platformDir = join(WT, platform);
  copyRun(runDir, platformDir);

  const manifest = readManifest();
  manifest.platforms ||= {};
  manifest.platforms[platform] = {
    runId,
    publishedAt: new Date().toISOString(),
    system: summary?.system ?? null,
    overall: summary?.overall ?? null,
    viewport: summary?.viewport ?? null
  };
  writeManifest(manifest);

  writeFileSync(join(WT, ".nojekyll"), "");
  writeFileSync(join(WT, "index.html"), renderLanding(manifest), "utf8");

  if (dryRun) {
    console.log(`--dry-run: worktree built at ${WT}, no commit.`);
    return;
  }

  const pushed = commitAndPush(runId, platform);
  try { sh(`git worktree remove --force "${WT}"`, { silent: true }); } catch {}

  if (pushed) {
    console.log(`Done. Site will update at ${SITE_URL}`);
    console.log(`Direct platform report: ${SITE_URL}${platform}/`);
  }
}

main();
