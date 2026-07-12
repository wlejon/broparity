// Generate a self-contained HTML report (dark UI).
import { writeFile, mkdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { scoreCase, fmtScore } from "../scoring.mjs";
import { formatSystemLabel } from "../system-info.mjs";

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/** Color band for a 0–100 percentage score. */
function band(p) {
  if (p >= 99.5) return "good";
  if (p >= 95) return "ok";
  if (p >= 85) return "mid";
  return "bad";
}

/** Shared dark-theme stylesheet for all report pages. */
const SHARED_CSS = `
:root {
  color-scheme: dark;
  --bg: #0d1117;
  --bg-1: #161b22;
  --bg-2: #1c2128;
  --bg-3: #21262d;
  --border: #30363d;
  --border-soft: #21262d;
  --text: #e6edf3;
  --muted: #8b949e;
  --dim: #6e7681;
  --accent: #58a6ff;
  --accent-dim: rgba(88, 166, 255, 0.15);
  --good: #3fb950;
  --ok: #56d364;
  --mid: #d29922;
  --bad: #f85149;
  --warn: #db6d28;
  --err-bg: rgba(248, 81, 73, 0.1);
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  font-family: var(--sans);
  background: var(--bg);
  color: var(--text);
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.wrap { max-width: 1280px; margin: 0 auto; padding: 28px 20px 64px; }
header.page { margin-bottom: 20px; }
header.page h1 {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.sub {
  color: var(--muted);
  font-size: 13px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  align-items: center;
}
.sub .sep { color: var(--dim); }
.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg-2);
  border: 1px solid var(--border);
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.panel {
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 16px 18px;
  margin-bottom: 14px;
}
.metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
}
.metric {
  background: var(--bg-2);
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  padding: 12px 14px;
}
.metric .v {
  font-size: 28px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
  line-height: 1.1;
}
.metric .l {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  margin-top: 4px;
}
.metric .h { font-size: 11px; color: var(--dim); margin-top: 3px; }
.metric.good .v { color: var(--good); }
.metric.ok .v { color: var(--ok); }
.metric.mid .v { color: var(--mid); }
.metric.bad .v { color: var(--bad); }
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.chip {
  font-size: 12px;
  color: var(--muted);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 9px;
}
.chip b { color: var(--text); font-weight: 500; }
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  align-items: center;
  justify-content: space-between;
  margin: 18px 0 10px;
}
.toolbar h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.controls label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
  user-select: none;
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-1);
}
.controls label:hover { border-color: var(--accent); color: var(--text); }
.controls input { accent-color: var(--accent); }
.controls input[type="search"] {
  background: var(--bg-1);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 12px;
  min-width: 180px;
  outline: none;
}
.controls input[type="search"]:focus { border-color: var(--accent); }
.controls input[type="search"]::placeholder { color: var(--dim); }
.table-wrap {
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: auto;
  margin-bottom: 14px;
}
table {
  border-collapse: collapse;
  width: 100%;
  font-size: 13px;
}
th, td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-soft);
  vertical-align: top;
  text-align: left;
}
th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--bg-2);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
  font-weight: 600;
  white-space: nowrap;
}
tr:last-child td { border-bottom: none; }
tr:hover td { background: rgba(88, 166, 255, 0.04); }
tr.ok { opacity: 0.72; }
tr.ok:hover { opacity: 1; }
body.hide-ok tr.ok { display: none; }
body.filter-active tr.filtered-out { display: none; }
.case-name {
  font-weight: 600;
  font-size: 12.5px;
  white-space: nowrap;
}
.case-name .cat { color: var(--dim); font-weight: 500; }
.num {
  font-variant-numeric: tabular-nums;
  font-size: 12.5px;
  font-family: var(--mono);
  white-space: nowrap;
}
.dim { color: var(--dim); font-size: 11px; font-weight: 400; }
.warn { color: var(--warn); font-size: 11px; }
.err td { background: var(--err-bg); }
.errcell {
  color: var(--bad);
  font-family: var(--mono);
  font-size: 12px;
  white-space: normal;
}
.score { font-weight: 600; }
.score.good, .band.good { color: var(--good); }
.score.ok, .band.ok { color: var(--ok); }
.score.mid, .band.mid { color: var(--mid); }
.score.bad, .band.bad { color: var(--bad); }
.bar {
  display: inline-block;
  height: 6px;
  width: 72px;
  background: var(--bg-3);
  border-radius: 3px;
  vertical-align: middle;
  margin-left: 8px;
  overflow: hidden;
}
.bar > i { display: block; height: 100%; border-radius: 3px; background: var(--good); }
.bar.ok > i { background: var(--ok); }
.bar.mid > i { background: var(--mid); }
.bar.bad > i { background: var(--bad); }
.shots { display: flex; gap: 8px; flex-wrap: wrap; }
.shot {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.shot span {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--dim);
}
.shot img, td > img {
  max-width: 220px;
  height: auto;
  border: 1px solid var(--border);
  border-radius: 4px;
  display: block;
  background: #fff;
  image-rendering: auto;
}
td > img { max-width: 200px; }
.stat-line { line-height: 1.55; }
.delta-zero { color: var(--dim); }
.delta-hot { color: var(--bad); font-weight: 600; }
.footer-note {
  margin-top: 20px;
  color: var(--dim);
  font-size: 12px;
}
@media (max-width: 720px) {
  .metric .v { font-size: 22px; }
  td > img { max-width: 140px; }
}
`;

function caseIsOk(r) {
  if (r.error) return false;
  const mm = r.pixels?.mismatchRatio ?? 1;
  const rect = r.layout?.rectMismatches ?? 1;
  const style = r.layout?.styleMismatches ?? 1;
  return mm === 0 && rect === 0 && style === 0;
}

function renderCaseRow(r, rel, { includeCategory = true } = {}) {
  const id = includeCategory ? `${r.category}/${r.case}` : r.case;
  const name = includeCategory
    ? `<span class="cat">${escapeHtml(r.category)}/</span>${escapeHtml(r.case)}`
    : escapeHtml(r.case);
  if (r.error) {
    return `<tr id="${escapeHtml(id)}" class="err" data-name="${escapeHtml(id.toLowerCase())}">
      <td class="case-name">${name}</td>
      <td colspan="5" class="errcell">ERROR: ${escapeHtml(r.error)}</td>
    </tr>`;
  }
  const ok = caseIsOk(r);
  const mmPct = (r.pixels.mismatchRatio * 100);
  const mmBand = mmPct === 0 ? "good" : mmPct < 0.5 ? "mid" : "bad";
  const rectHot = r.layout.rectMismatches > 0;
  const styleHot = r.layout.styleMismatches > 0;
  const sc = scoreCase(r);
  const layoutPct = sc.layoutScore * 100;
  return `<tr id="${escapeHtml(id)}" class="${ok ? "ok" : "diff"}" data-name="${escapeHtml(id.toLowerCase())}">
      <td class="case-name">${name}</td>
      <td><img src="${rel(r.broPng)}" loading="lazy" alt="bro"></td>
      <td><img src="${rel(r.chromiumPng)}" loading="lazy" alt="chromium"></td>
      <td><img src="${rel(r.diffPng)}" loading="lazy" alt="diff"></td>
      <td class="num stat-line">
        <span class="score ${mmBand}">${mmPct.toFixed(3)}%</span>
        <br><span class="dim">${r.pixels.mismatchedPixels.toLocaleString()}/${r.pixels.totalPixels.toLocaleString()} px</span>
        ${r.pixels.sizeMismatch ? `<br><span class="warn">size: bro ${r.pixels.aSize.w}×${r.pixels.aSize.h}, chromium ${r.pixels.bSize.w}×${r.pixels.bSize.h}</span>` : ""}
      </td>
      <td class="num stat-line">
        <span class="${rectHot ? "delta-hot" : "delta-zero"}">rect ${r.layout.rectMismatches}</span>
        · <span class="${styleHot ? "delta-hot" : "delta-zero"}">style ${r.layout.styleMismatches}</span>
        <br><span class="dim">${r.layout.totalElements} elems</span>
        <br><span class="score ${band(layoutPct)}">L ${fmtScore(sc.layoutScore)}</span>
        <span class="dim"> · P ${fmtScore(sc.pixelScore)}</span>
      </td>
    </tr>`;
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
  const okCount = list.filter(caseIsOk).length;
  const rows = list.map(r => renderCaseRow(r, rel, { includeCategory: false })).join("\n");
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>broparity — ${escapeHtml(name)}</title>
<style>${SHARED_CSS}</style>
</head><body>
<div class="wrap">
  <header class="page">
    <h1>${escapeHtml(name)}</h1>
    <div class="sub">
      <a href="../index.html">← all cases</a>
      <span class="sep">·</span>
      <span>${list.length} cases</span>
      <span class="sep">·</span>
      <span>${okCount} perfect</span>
      <span class="sep">·</span>
      <span>${list.length - okCount} with diffs</span>
    </div>
  </header>
  <div class="toolbar">
    <h2>Cases</h2>
    <div class="controls">
      <label><input type="checkbox" id="hide-ok"> Diffs only</label>
      <input type="search" id="q" placeholder="Filter cases…" autocomplete="off">
    </div>
  </div>
  <div class="table-wrap">
    <table>
      <thead><tr>
        <th>Case</th><th>Bro</th><th>Chromium</th><th>Diff</th><th>Pixels</th><th>Layout</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>
<script>
(() => {
  const hide = document.getElementById("hide-ok");
  const q = document.getElementById("q");
  const apply = () => {
    document.body.classList.toggle("hide-ok", hide.checked);
    const term = (q.value || "").trim().toLowerCase();
    document.body.classList.toggle("filter-active", !!term);
    for (const tr of document.querySelectorAll("tbody tr")) {
      const name = tr.dataset.name || "";
      tr.classList.toggle("filtered-out", term && !name.includes(term));
    }
  };
  hide.addEventListener("change", apply);
  q.addEventListener("input", apply);
})();
</script>
</body></html>`;
}

export async function renderReport({ runDir, results, summary }) {
  // Per category raw aggregates for rect/style totals.
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
  const catCount = summary?.overall.categoryCount ?? Object.keys(cats).length;
  const sys = summary?.system;
  const sysLabel = sys ? formatSystemLabel(sys) : "";
  const perfect = results.filter(caseIsOk).length;
  const withDiffs = results.length - perfect;

  // Category rows: worst layout score first (most useful when scanning).
  const catList = (summary?.categories ?? []).slice().sort((a, b) => a.layoutScore - b.layoutScore);
  const catRows = catList.map(c => {
    const lp = c.layoutScore * 100;
    const pp = c.pixelScore * 100;
    const lb = band(lp);
    const pb = band(pp);
    const rect = cats[c.name]?.rectMismatches ?? 0;
    const style = cats[c.name]?.styleMismatches ?? 0;
    return `<tr>
      <td><a href="#cat-${escapeHtml(c.name)}">${escapeHtml(c.name)}</a></td>
      <td class="num">${c.n}</td>
      <td class="num"><span class="score ${lb}">${lp.toFixed(1)}%</span><span class="bar ${lb}"><i style="width:${Math.min(100, lp).toFixed(1)}%"></i></span></td>
      <td class="num"><span class="score ${pb}">${pp.toFixed(1)}%</span><span class="bar ${pb}"><i style="width:${Math.min(100, pp).toFixed(1)}%"></i></span></td>
      <td class="num ${rect ? "delta-hot" : "delta-zero"}">${rect}</td>
      <td class="num ${style ? "delta-hot" : "delta-zero"}">${style}</td>
    </tr>`;
  }).join("");

  // Case rows grouped by category order (alpha), with category anchors.
  const byCat = {};
  for (const r of results) (byCat[r.category] ||= []).push(r);
  const catOrder = Object.keys(byCat).sort((a, b) => a.localeCompare(b));
  const rowsHtml = catOrder.map(cat => {
    const list = byCat[cat];
    const anchor = `<tr class="ok" id="cat-${escapeHtml(cat)}" data-name="${escapeHtml(cat.toLowerCase())}" style="display:none"></tr>`;
    return anchor + list.map(r => renderCaseRow(r, rel, { includeCategory: true })).join("\n");
  }).join("\n");

  const chips = [];
  if (sys?.os) chips.push(`<span class="chip"><b>OS</b> ${escapeHtml(sys.os)}</span>`);
  if (sys?.cpu) chips.push(`<span class="chip"><b>CPU</b> ${escapeHtml(sys.cpu)}${sys.cpuCount ? ` · ${sys.cpuCount}t` : ""}</span>`);
  if (sys?.gpus?.length) chips.push(`<span class="chip"><b>GPU</b> ${escapeHtml(sys.gpus.join(", "))}</span>`);
  if (sys?.arch) chips.push(`<span class="chip"><b>Arch</b> ${escapeHtml(sys.arch)}</span>`);
  if (summary?.viewport) chips.push(`<span class="chip"><b>Viewport</b> ${summary.viewport.w}×${summary.viewport.h}</span>`);

  const ts = summary?.timestamp
    ? new Date(summary.timestamp).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC")
    : "";

  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>broparity${sys ? ` — ${escapeHtml(sys.platformSlug || sys.platform)}` : ""}</title>
<style>${SHARED_CSS}</style>
</head><body>
<div class="wrap">
  <header class="page">
    <h1>broparity</h1>
    <div class="sub">
      <span class="badge">Bro vs Chromium</span>
      ${sys?.platformSlug || sys?.platform ? `<span>${escapeHtml(sys.platformSlug || sys.platform)}</span>` : ""}
      ${sysLabel ? `<span class="sep">·</span><span>${escapeHtml(sysLabel)}</span>` : ""}
      ${ts ? `<span class="sep">·</span><span>${escapeHtml(ts)}</span>` : ""}
    </div>
  </header>

  <div class="panel">
    <div class="metrics">
      <div class="metric ${band(layoutPct)}">
        <div class="v">${layoutPct.toFixed(1)}%</div>
        <div class="l">Layout</div>
        <div class="h">rect + style + paint</div>
      </div>
      <div class="metric ${band(pixelPct)}">
        <div class="v">${pixelPct.toFixed(1)}%</div>
        <div class="l">Pixels</div>
        <div class="h">1 − mean mismatch</div>
      </div>
      <div class="metric">
        <div class="v">${caseCount}</div>
        <div class="l">Cases</div>
        <div class="h">${catCount} categories</div>
      </div>
      <div class="metric ${withDiffs ? "mid" : "good"}">
        <div class="v">${withDiffs}</div>
        <div class="l">With diffs</div>
        <div class="h">${perfect} perfect</div>
      </div>
    </div>
    ${chips.length ? `<div class="chips">${chips.join("")}</div>` : ""}
  </div>

  <div class="toolbar">
    <h2>Categories</h2>
    <div class="controls"><span class="dim" style="font-size:12px">Sorted worst → best layout</span></div>
  </div>
  <div class="table-wrap">
    <table>
      <thead><tr>
        <th>Category</th><th>n</th><th>Layout</th><th>Pixels</th><th>Rect Δ</th><th>Style Δ</th>
      </tr></thead>
      <tbody>${catRows}</tbody>
    </table>
  </div>

  <div class="toolbar">
    <h2>Cases</h2>
    <div class="controls">
      <label><input type="checkbox" id="hide-ok"> Diffs only</label>
      <input type="search" id="q" placeholder="Filter cases…" autocomplete="off">
    </div>
  </div>
  <div class="table-wrap">
    <table>
      <thead><tr>
        <th>Case</th><th>Bro</th><th>Chromium</th><th>Diff</th><th>Pixels</th><th>Layout</th>
      </tr></thead>
      <tbody>
${rowsHtml}
      </tbody>
    </table>
  </div>

  <p class="footer-note">Scores are unweighted facts for this host — not a target. Layout = weighted rect/style/paint match; pixels = 1 − mismatch ratio (threshold 0.1).</p>
</div>
<script>
(() => {
  const hide = document.getElementById("hide-ok");
  const q = document.getElementById("q");
  const apply = () => {
    document.body.classList.toggle("hide-ok", hide.checked);
    const term = (q.value || "").trim().toLowerCase();
    document.body.classList.toggle("filter-active", !!term);
    for (const tr of document.querySelectorAll("tbody tr[data-name]")) {
      const name = tr.dataset.name || "";
      tr.classList.toggle("filtered-out", term && !name.includes(term));
    }
  };
  hide.addEventListener("change", apply);
  q.addEventListener("input", apply);
})();
</script>
</body></html>`;

  const reportPath = resolve(runDir, "index.html");
  await writeFile(reportPath, html, "utf8");
  return reportPath;
}
