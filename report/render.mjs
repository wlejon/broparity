// Generate a self-contained HTML report.
import { writeFile, mkdir } from "node:fs/promises";
import { relative, resolve, dirname } from "node:path";
import { scoreCase, fmtScore, fmtPct } from "../scoring.mjs";

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

export async function renderReport({ runDir, results }) {
  const overall = {
    cases: results.length,
    avgMismatch: results.reduce((s, r) => s + (r.pixels?.mismatchRatio ?? 0), 0) / Math.max(1, results.length),
    totalRectMismatches: results.reduce((s, r) => s + (r.layout?.rectMismatches ?? 0), 0),
    totalStyleMismatches: results.reduce((s, r) => s + (r.layout?.styleMismatches ?? 0), 0)
  };

  // Per category
  const cats = {};
  for (const r of results) {
    cats[r.category] ||= { cases: 0, mismatchSum: 0, rectMismatches: 0, styleMismatches: 0 };
    cats[r.category].cases++;
    cats[r.category].mismatchSum += r.pixels?.mismatchRatio ?? 0;
    cats[r.category].rectMismatches += r.layout?.rectMismatches ?? 0;
    cats[r.category].styleMismatches += r.layout?.styleMismatches ?? 0;
  }

  const rel = (p) => relative(runDir, p).replaceAll("\\", "/");

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
<html><head><meta charset="utf-8"><title>broparity ${escapeHtml(runDir)}</title>
<style>
body { font-family: -apple-system, sans-serif; margin: 24px; background: #fafafa; color: #202020; }
h1 { margin: 0 0 4px; }
.sub { color: #606060; font-size: 13px; margin-bottom: 24px; }
.summary, .cats { background: #fff; border: 1px solid #e0e0e0; border-radius: 6px; padding: 16px; margin-bottom: 18px; }
.summary b { font-size: 18px; }
table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #e0e0e0; border-radius: 6px; overflow: hidden; }
th, td { padding: 10px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
th { background: #f4f4f4; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: #606060; }
img { max-width: 280px; height: auto; border: 1px solid #d0d0d0; display: block; }
.num { font-variant-numeric: tabular-nums; font-size: 13px; }
.dim { color: #808080; font-size: 11px; }
.warn { color: #c04000; font-size: 11px; }
.err td { background: #fff0f0; }
.errcell { color: #c00000; font-family: monospace; font-size: 12px; }
</style>
</head><body>
<h1>broparity report</h1>
<div class="sub">${escapeHtml(runDir)}</div>
<div class="summary">
  <b>${overall.cases}</b> cases &nbsp;|&nbsp;
  avg pixel mismatch: <b>${(overall.avgMismatch*100).toFixed(3)}%</b> &nbsp;|&nbsp;
  total rect mismatches: <b>${overall.totalRectMismatches}</b> &nbsp;|&nbsp;
  total style mismatches: <b>${overall.totalStyleMismatches}</b>
</div>
<div class="cats">
  <table><thead><tr><th>Category</th><th>Cases</th><th>Avg mismatch</th><th>Rect Δ</th><th>Style Δ</th></tr></thead>
  <tbody>${catRows}</tbody></table>
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
