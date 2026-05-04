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
import { platformSlug as detectPlatformSlug, formatSystemLabel } from "./system-info.mjs";

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

function renderLanding(manifest) {
  const platforms = Object.entries(manifest.platforms || {})
    .sort(([a], [b]) => a.localeCompare(b));
  const cards = platforms.map(([slug, p]) => {
    const layoutPct = ((p.overall?.layoutScore ?? 0) * 100).toFixed(1);
    const pixelPct = ((p.overall?.pixelScore ?? 0) * 100).toFixed(1);
    const sysLabel = p.system ? formatSystemLabel(p.system) : "";
    const cases = p.overall?.caseCount ?? 0;
    const cats = p.overall?.categoryCount ?? 0;
    const sysRows = p.system ? [
      ["OS", p.system.os],
      ["CPU", p.system.cpu ? `${p.system.cpu}${p.system.cpuCount ? ` (${p.system.cpuCount} threads)` : ""}` : null],
      ["GPU", p.system.gpus?.length ? p.system.gpus.join(", ") : null],
    ].filter(([, v]) => v) : [];
    return `
      <a class="card" href="${escapeHtml(slug)}/index.html">
        <div class="card-head">
          <div class="card-title">${escapeHtml(p.system?.os || slug)}</div>
          <div class="card-sub">${escapeHtml(sysLabel)}</div>
        </div>
        <div class="card-metrics">
          <div class="m"><div class="v">${layoutPct}%</div><div class="l">layout</div></div>
          <div class="m"><div class="v">${pixelPct}%</div><div class="l">pixels</div></div>
          <div class="m"><div class="v">${cases}</div><div class="l">cases</div></div>
        </div>
        <div class="card-sys">
          ${sysRows.map(([k, v]) => `<div><span>${escapeHtml(k)}</span> ${escapeHtml(String(v))}</div>`).join("")}
        </div>
        <div class="card-foot">View report → · published ${escapeHtml((p.publishedAt || "").slice(0, 10))} · run ${escapeHtml(p.runId || "")}</div>
      </a>`;
  }).join("");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>broparity — Bro vs Chromium rendering parity</title>
<style>
:root { color-scheme: light; }
body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 0; background: #fafafa; color: #202020; }
.wrap { max-width: 980px; margin: 0 auto; padding: 48px 24px; }
h1 { margin: 0 0 8px; font-size: 32px; }
.tag { color: #606060; font-size: 14px; margin-bottom: 28px; }
.intro { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px 22px; margin-bottom: 24px; line-height: 1.55; font-size: 15px; }
.intro p { margin: 0 0 10px; }
.intro p:last-child { margin: 0; }
.intro a { color: #1f6feb; }
h2 { font-size: 18px; margin: 28px 0 12px; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; }
.card { display: block; background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 18px; text-decoration: none; color: inherit; transition: border-color 0.1s, transform 0.1s; }
.card:hover { border-color: #1f6feb; transform: translateY(-1px); }
.card-head { margin-bottom: 14px; }
.card-title { font-size: 17px; font-weight: 600; }
.card-sub { font-size: 12px; color: #707070; margin-top: 2px; }
.card-metrics { display: flex; gap: 18px; margin-bottom: 14px; }
.m .v { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }
.m .l { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #707070; }
.card-sys { font-size: 12px; color: #505050; line-height: 1.5; margin-bottom: 12px; }
.card-sys span { color: #909090; display: inline-block; min-width: 36px; }
.card-foot { font-size: 11px; color: #909090; border-top: 1px solid #f0f0f0; padding-top: 10px; }
.empty { background: #fff; border: 1px dashed #d0d0d0; border-radius: 8px; padding: 24px; text-align: center; color: #707070; font-size: 14px; }
footer { margin-top: 40px; color: #909090; font-size: 12px; }
footer a { color: #707070; }
</style></head><body>
<div class="wrap">
  <h1>broparity</h1>
  <div class="tag">Side-by-side rendering parity: <b>Bro</b> vs <b>Chromium</b></div>
  <div class="intro">
    <p>Bro is a small HTML/CSS/JS app runtime. <a href="https://github.com/wlejon/bro">Bro</a> renders web pages with its own layout and paint engine — not by embedding a browser. <a href="https://github.com/wlejon/broparity">Broparity</a> measures how close that engine is to Chromium on a curated set of test pages.</p>
    <p>Each test case is a UA-neutral HTML page rendered by both engines. We compare the resulting pixels and a structural layout dump (every element's box and a curated set of computed styles). Numbers below are factual and unweighted: this is what bro currently produces, not a target or a claim.</p>
    <p>Rendering depends on the host system — fonts, GPU drivers, and OS text shaping all influence the result — so each platform is tracked separately.</p>
  </div>

  <h2>Reports by platform</h2>
  ${platforms.length ? `<div class="grid">${cards}</div>` : `<div class="empty">No platforms published yet.</div>`}

  <footer>
    Published from broparity at ${escapeHtml(new Date().toISOString())}.
    Source: <a href="https://github.com/wlejon/broparity">github.com/wlejon/broparity</a>
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
