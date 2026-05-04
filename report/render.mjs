// Generate a self-contained HTML report.
import { writeFile, mkdir } from "node:fs/promises";
import { relative, resolve, dirname } from "node:path";
import { scoreCase, fmtScore, fmtPct } from "../scoring.mjs";
import { formatSystemLabel } from "../system-info.mjs";

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Render a per-category index.html. Returns { name, path } for each category.
export async function renderPerCategoryReports({ runDir, results }) {
  const cats = {};
  for (const r of results) (cats[r.category] ||= []).push(r);
  const out = {};
  for (const [name, list] of Object.entries(cats)) {
    const catDir = resolve(runDir, name);
    await mkdir(catDir, { recursive: true });
    const path = resolve(catDir, "index.html");
    await writeFile(path, renderCategoryHtml(name, list, catDir), "utf8");
    out[name] = path;
  }
  return out;
}

function renderCategoryHtml(name, list, catDir) {
  const rel = (p) => relative(catDir, p).replaceAll("\\", "/");
  const rows = list.map(r => {
    if (r.error) {
      return `<tr id="${escapeHtml(r.case)}" class="err"><td><b>${escapeHtml(r.case)}</b></td><td colspan="6" class="errcell">ERROR: ${escapeHtml(r.error)}</td></tr>`;
    }
    const sc = scoreCase(r);
    return `<tr id="${escapeHtml(r.case)}">
      <td><b>${escapeHtml(r.case)}</b></td>
      <td><img src="${rel(r.broPng)}" loading="lazy"></td>
      <td><img src="${rel(r.chromiumPng)}" loading="lazy"></td>
      <td><img src="${rel(r.diffPng)}" loading="lazy"></td>
      <td class="num">${(r.pixels.mismatchRatio*100).toFixed(3)}%<br><span class="dim">${r.pixels.mismatchedPixels}/${r.pixels.totalPixels} px</span></td>
      <td class="num">rect: ${r.layout.rectMismatches}<br>style: ${r.layout.styleMismatches}<br><span class="dim">of ${r.layout.totalElements} elems</span></td>
      <td class="num">L=${fmtScore(sc.layoutScore)}<br>P=${fmtScore(sc.pixelScore)}</td>
    </tr>`;
  }).join("\n");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>broparity — ${escapeHtml(name)}</title>
<style>
body { font-family: -apple-system, sans-serif; margin: 24px; background: #fafafa; color: #202020; }
h1 { margin: 0 0 4px; }
.sub { color: #606060; font-size: 13px; margin-bottom: 24px; }
table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #e0e0e0; border-radius: 6px; overflow: hidden; }
th, td { padding: 10px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
th { background: #f4f4f4; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: #606060; }
img { max-width: 280px; height: auto; border: 1px solid #d0d0d0; display: block; }
.num { font-variant-numeric: tabular-nums; font-size: 13px; }
.dim { color: #808080; font-size: 11px; }
.err td { background: #fff0f0; }
.errcell { color: #c00000; font-family: monospace; font-size: 12px; }
a { color: #1f6feb; }
</style></head><body>
<h1>${escapeHtml(name)}</h1>
<div class="sub"><a href="../index.html">all cases</a></div>
<table><thead><tr><th>Case</th><th>bro</th><th>Chromium</th><th>Diff</th><th>Pixel mismatch</th><th>Layout Δ</th><th>Score</th></tr></thead>
<tbody>${rows}</tbody></table>
</body></html>`;
}

export async function renderReport({ runDir, results, summary }) {
  // Per category (raw aggregates, kept for the breakdown table).
  const cats = {};
  for (const r of results) {
    cats[r.category] ||= { cases: 0, mismatchSum: 0, rectMismatches: 0, styleMismatches: 0 };
    cats[r.category].cases++;
    cats[r.category].mismatchSum += r.pixels?.mismatchRatio ?? 0;
    cats[r.category].rectMismatches += r.layout?.rectMismatches ?? 0;
    cats[r.category].styleMismatches += r.layout?.styleMismatches ?? 0;
  }

  const rel = (p) => relative(runDir, p).replaceAll("\\", "/");
  const layoutPct = (summary?.overall.layoutScore ?? 0) * 100;
  const pixelPct = (summary?.overall.pixelScore ?? 0) * 100;
  const caseCount = summary?.overall.caseCount ?? results.length;
  const sys = summary?.system;
  const sysLabel = sys ? formatSystemLabel(sys) : "";
  const sysRows = sys ? [
    ["OS", sys.os],
    ["CPU", sys.cpu ? `${sys.cpu}${sys.cpuCount ? ` (${sys.cpuCount} threads)` : ""}` : null],
    ["GPU", sys.gpus?.length ? sys.gpus.join(", ") : null],
    ["Architecture", sys.arch],
    ["Viewport", summary.viewport ? `${summary.viewport.w}x${summary.viewport.h}` : null]
  ].filter(([, v]) => v) : [];

  const rowsHtml = results.map(r => {
    if (r.error) {
      return `<tr class="err"><td>${escapeHtml(r.category)}/${escapeHtml(r.case)}</td><td colspan="5" class="errcell">ERROR: ${escapeHtml(r.error)}</td></tr>`;
    }
    return `
    <tr>
      <td><b>${escapeHtml(r.category)}/${escapeHtml(r.case)}</b></td>
      <td><img src="${rel(r.broPng)}" loading="lazy"></td>
      <td><img src="${rel(r.chromiumPng)}" loading="lazy"></td>
      <td><img src="${rel(r.diffPng)}" loading="lazy"></td>
      <td class="num">${(r.pixels.mismatchRatio*100).toFixed(3)}%<br><span class="dim">${r.pixels.mismatchedPixels}/${r.pixels.totalPixels} px</span>${r.pixels.sizeMismatch ? `<br><span class="warn">size mismatch: bro ${r.pixels.aSize.w}x${r.pixels.aSize.h}, chromium ${r.pixels.bSize.w}x${r.pixels.bSize.h}</span>` : ""}</td>
      <td class="num">rect: ${r.layout.rectMismatches}<br>style: ${r.layout.styleMismatches}<br><span class="dim">of ${r.layout.totalElements} elems</span></td>
    </tr>`;
  }).join("\n");

  const catRows = Object.entries(cats).map(([name, c]) => `
    <tr>
      <td>${escapeHtml(name)}</td>
      <td class="num">${c.cases}</td>
      <td class="num">${(c.mismatchSum/c.cases*100).toFixed(3)}%</td>
      <td class="num">${c.rectMismatches}</td>
      <td class="num">${c.styleMismatches}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>broparity report${sys ? ` — ${escapeHtml(sys.platformSlug || sys.platform)}` : ""}</title>
<style>
body { font-family: -apple-system, sans-serif; margin: 24px; background: #fafafa; color: #202020; max-width: 1400px; }
h1 { margin: 0 0 4px; }
.sub { color: #606060; font-size: 13px; margin-bottom: 24px; }
.headline, .system, .cats { background: #fff; border: 1px solid #e0e0e0; border-radius: 6px; padding: 18px; margin-bottom: 18px; }
.headline .lede { font-size: 15px; line-height: 1.5; color: #303030; }
.headline .lede b { color: #1a1a1a; }
.metrics { display: flex; gap: 28px; margin-top: 14px; flex-wrap: wrap; }
.metric { min-width: 160px; }
.metric .v { font-size: 28px; font-weight: 600; font-variant-numeric: tabular-nums; color: #1a1a1a; }
.metric .l { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #707070; margin-top: 2px; }
.metric .h { font-size: 11px; color: #909090; margin-top: 4px; }
.system table { width: auto; border: none; background: transparent; }
.system th, .system td { border: none; padding: 4px 16px 4px 0; font-size: 13px; text-transform: none; letter-spacing: 0; background: transparent; }
.system th { color: #707070; font-weight: 500; text-align: left; }
table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #e0e0e0; border-radius: 6px; overflow: hidden; }
th, td { padding: 10px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
th { background: #f4f4f4; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: #606060; }
img { max-width: 280px; height: auto; border: 1px solid #d0d0d0; display: block; }
.num { font-variant-numeric: tabular-nums; font-size: 13px; }
.dim { color: #808080; font-size: 11px; }
.warn { color: #c04000; font-size: 11px; }
.err td { background: #fff0f0; }
.errcell { color: #c00000; font-family: monospace; font-size: 12px; }
.bar { display: inline-block; height: 8px; background: #e8e8e8; border-radius: 4px; vertical-align: middle; width: 120px; position: relative; overflow: hidden; }
.bar > i { display: block; height: 100%; background: #4a8f4a; border-radius: 4px; }
</style>
</head><body>
<h1>broparity report</h1>
<div class="sub">Bro vs Chromium parity${sysLabel ? ` · ${escapeHtml(sysLabel)}` : ""} · ${escapeHtml(summary?.timestamp || "")}</div>
<div class="headline">
  <div class="lede">
    Bro renders <b>${layoutPct.toFixed(1)}%</b> of measured layout properties identically to Chromium across <b>${caseCount}</b> test cases${sys ? ` on <b>${escapeHtml(sys.os || sys.platform)}</b>` : ""}.
    Pixel output matches on <b>${pixelPct.toFixed(1)}%</b> of pixels.
    Scroll for the per-case screenshots and diffs.
  </div>
  <div class="metrics">
    <div class="metric">
      <div class="v">${layoutPct.toFixed(1)}%</div>
      <div class="l">Layout conformance</div>
      <div class="h">weighted rect + style + paint match, mean across categories</div>
    </div>
    <div class="metric">
      <div class="v">${pixelPct.toFixed(1)}%</div>
      <div class="l">Pixel match</div>
      <div class="h">1 − mean pixel mismatch ratio</div>
    </div>
    <div class="metric">
      <div class="v">${caseCount}</div>
      <div class="l">Cases</div>
      <div class="h">${summary?.overall.categoryCount ?? Object.keys(cats).length} categories</div>
    </div>
  </div>
</div>
${sysRows.length ? `<div class="system">
  <table><tbody>${sysRows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(String(v))}</td></tr>`).join("")}</tbody></table>
</div>` : ""}
<div class="cats">
  <table><thead><tr><th>Category</th><th>Cases</th><th>Layout match</th><th>Pixel match</th><th>Rect Δ</th><th>Style Δ</th></tr></thead>
  <tbody>${(summary?.categories ?? []).map(c => `
    <tr>
      <td>${escapeHtml(c.name)}</td>
      <td class="num">${c.n}</td>
      <td class="num">${(c.layoutScore*100).toFixed(1)}% <span class="bar"><i style="width:${(c.layoutScore*100).toFixed(1)}%"></i></span></td>
      <td class="num">${(c.pixelScore*100).toFixed(1)}% <span class="bar"><i style="width:${(c.pixelScore*100).toFixed(1)}%"></i></span></td>
      <td class="num">${cats[c.name]?.rectMismatches ?? 0}</td>
      <td class="num">${cats[c.name]?.styleMismatches ?? 0}</td>
    </tr>`).join("")}</tbody></table>
</div>
<table>
<thead><tr><th>Case</th><th>bro</th><th>Chromium</th><th>Diff</th><th>Pixel mismatch</th><th>Layout Δ</th></tr></thead>
<tbody>
${rowsHtml}
</tbody></table>
</body></html>`;

  const reportPath = resolve(runDir, "index.html");
  await writeFile(reportPath, html, "utf8");
  return reportPath;
}
