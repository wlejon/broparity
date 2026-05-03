// Cross-category summary report. Self-contained HTML, inline CSS.
import { writeFile, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fmtPct, fmtScore } from "../scoring.mjs";

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Hand-curated, prioritized list of currently-known bro divergences. Sorted by
// approximate impact (number of cases affected × severity). Update this as new
// issues are root-caused; values are descriptive, not auto-derived.
export const TOP_ISSUES = [
  {
    title: "Tables: cell geometry diverges across every case",
    category: "tables",
    impact: "high",
    detail: "All 9 tables cases have rect deltas on every element (10–25 elem mismatches each). Cell widths, row heights, caption placement, and thead/tfoot ordering all drift from Chromium. Single-digit pixel% but pervasive layout score impact (category L=0.100). Likely a small set of root causes in cell width distribution and border model."
  },
  {
    title: "Replaced <img> intrinsic / aspect-ratio sizing",
    category: "display-types",
    impact: "high",
    detail: "img-intrinsic-size, img-aspect-ratio, img-explicit-size each show 3 rect deltas and 1.6–2.9% pixel mismatch. bro doesn't use intrinsic dimensions / aspect ratio when only one CSS dimension is set. img-css-size (both dims set) is clean."
  },
  {
    title: "Inline-block baseline + vertical-align",
    category: "display-types",
    impact: "high",
    detail: "inline-block-baseline, inline-block-vertical-align-top, inline-vs-inline-block and inline-block-basic all show 2–3 rect deltas. baseline-aligned inline-blocks land at the wrong y. Knock-on effect on form controls (button/input show identical 3-rect patterns)."
  },
  {
    title: "Negative z-index paints above background",
    category: "position",
    impact: "high",
    detail: "position/negative-zindex shows 4.08% pixel mismatch with rectΔ=0 / styleΔ=0 — a pure paint-order bug. A z-index:-1 child renders above its containing block instead of behind it. Canonical case for the paint-order axis; flag with `paint-order.fail` once confirmed manually."
  },
  {
    title: "Text layout: line-box y and font-size cascade",
    category: "text",
    impact: "medium",
    detail: "line-height-px, line-height-unitless, font-size-cascade, and inline-formatting each show 3–6 rect deltas. Line-box vertical positioning and inherited font-size computation drift from Chromium, shifting every line of text in affected blocks (text category L=0.368)."
  },
  {
    title: "Flex min-content shrink",
    category: "flex",
    impact: "medium",
    detail: "flex/min-content-shrink shows 5 rect deltas and 3.38% pixels — bro's min-content intrinsic width and negative free-space distribution disagree with Chromium. The rest of flex is clean (category L=0.885); this case is the outlier."
  },
  {
    title: "Tables caption + thead/tfoot positioning",
    category: "tables",
    impact: "medium",
    detail: "tables/caption (5.57% pixels) and tables/thead-tfoot (5.01% pixels, 25 rect deltas) are the worst-offender table cases — the row groups and caption box land in different vertical slots than Chromium."
  },
  {
    title: "box-sizing: border-box geometry",
    category: "boxmodel",
    impact: "low",
    detail: "boxmodel/box-sizing-border-box shows 3 rect / 3 style deltas at 1.11% pixels. Basic block and margin-collapse are essentially clean. The diff is small but consistent — likely a content-box-vs-border-box width arithmetic difference for one element class."
  },
  {
    title: "Sticky-basic computed style",
    category: "position",
    impact: "low",
    detail: "position/sticky-basic shows 2 styleΔ with rectΔ=0 — bro reports the computed style differently for `position: sticky` even when geometry matches. Cosmetic at non-scrolled state; would need a scrolled variant to check pinning behavior."
  }
];

// Group TOP_ISSUES by category for the README/known-divergences listing.
export function topIssuesByCategory() {
  const byCat = {};
  for (const it of TOP_ISSUES) {
    (byCat[it.category] ||= []).push(it);
  }
  return byCat;
}

export async function renderSummary({ runDir, results, scoring, perCategoryReports }) {
  const rel = (p) => relative(runDir, p).replaceAll("\\", "/");
  const { overall, categories } = scoring;

  const catRows = categories.map(c => {
    const worst = c.worst;
    const worstLabel = worst ? `${worst.category}/${worst.case}` : "—";
    let worstLink = "—";
    if (worst && perCategoryReports) {
      const reportPath = perCategoryReports[c.name];
      if (reportPath) {
        worstLink = `<a href="${rel(reportPath)}#${escapeHtml(worst.case)}">${escapeHtml(worstLabel)}</a>`;
      } else {
        worstLink = escapeHtml(worstLabel);
      }
    }
    return `<tr>
      <td><b>${escapeHtml(c.name)}</b></td>
      <td class="num">${c.n}</td>
      <td class="num"><span class="bar"><span class="barfill" style="width:${(c.layoutScore*100).toFixed(1)}%"></span></span> ${fmtScore(c.layoutScore)}</td>
      <td class="num"><span class="bar"><span class="barfill p" style="width:${(c.pixelScore*100).toFixed(1)}%"></span></span> ${fmtScore(c.pixelScore)}</td>
      <td>${worstLink}${worst && worst.score ? ` <span class="dim">(L=${fmtScore(worst.score.layoutScore)}, P=${fmtScore(worst.score.pixelScore)})</span>` : ""}</td>
    </tr>`;
  }).join("\n");

  const issuesHtml = TOP_ISSUES.map((i, idx) => `
    <li class="issue impact-${escapeHtml(i.impact)}">
      <div class="issue-h"><span class="rank">#${idx+1}</span>
        <span class="issue-title">${escapeHtml(i.title)}</span>
        <span class="issue-cat">${escapeHtml(i.category)}</span>
        <span class="issue-impact">${escapeHtml(i.impact)}</span>
      </div>
      <div class="issue-detail">${escapeHtml(i.detail)}</div>
    </li>`).join("");

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>broparity summary</title>
<style>
body { font-family: -apple-system, "Segoe UI", sans-serif; margin: 0; background: #f4f5f7; color: #1a1a1a; }
.wrap { max-width: 1100px; margin: 0 auto; padding: 28px; }
h1 { margin: 0 0 4px; font-size: 24px; }
.sub { color: #606060; font-size: 13px; margin-bottom: 20px; }
.headline { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
.card { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 18px; }
.card .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #707070; }
.card .value { font-size: 32px; font-weight: 600; margin-top: 6px; font-variant-numeric: tabular-nums; }
.card .value.layout { color: #1f6feb; }
.card .value.pixel { color: #2da44e; }
.card .sub2 { font-size: 12px; color: #707070; margin-top: 4px; }
table { border-collapse: collapse; width: 100%; background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; }
th, td { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; vertical-align: middle; text-align: left; }
th { background: #fafafa; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #606060; }
.num { font-variant-numeric: tabular-nums; }
.bar { display: inline-block; width: 90px; height: 8px; background: #eee; border-radius: 4px; overflow: hidden; vertical-align: middle; margin-right: 6px; }
.barfill { display: block; height: 100%; background: #1f6feb; }
.barfill.p { background: #2da44e; }
.dim { color: #888; font-size: 11px; }
h2 { margin: 28px 0 10px; font-size: 16px; text-transform: uppercase; letter-spacing: 0.06em; color: #404040; }
.issues { list-style: none; padding: 0; margin: 0; }
.issue { background: #fff; border: 1px solid #e0e0e0; border-left: 4px solid #888; border-radius: 6px; padding: 12px 14px; margin-bottom: 10px; }
.issue.impact-high { border-left-color: #d1242f; }
.issue.impact-medium { border-left-color: #d4a72c; }
.issue.impact-low { border-left-color: #6e7781; }
.issue-h { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.rank { font-variant-numeric: tabular-nums; color: #888; font-size: 12px; min-width: 28px; }
.issue-title { font-weight: 600; }
.issue-cat { background: #eef; color: #335; padding: 2px 8px; border-radius: 10px; font-size: 11px; }
.issue-impact { background: #f5f5f5; color: #555; padding: 2px 8px; border-radius: 10px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
.issue.impact-high .issue-impact { background: #ffe5e5; color: #a01020; }
.issue.impact-medium .issue-impact { background: #fff4d8; color: #8a6500; }
.issue-detail { color: #404040; font-size: 13px; margin-top: 6px; line-height: 1.4; }
.scoring-note { background: #fff; border: 1px solid #e0e0e0; border-radius: 6px; padding: 12px 14px; font-size: 12px; color: #505050; margin-top: 8px; }
.scoring-note code { background: #f4f4f4; padding: 1px 5px; border-radius: 3px; font-size: 11.5px; }
.cat-link a { color: #1f6feb; text-decoration: none; }
.cat-link a:hover { text-decoration: underline; }
</style>
</head><body>
<div class="wrap">
<h1>broparity — conformance summary</h1>
<div class="sub">${escapeHtml(runDir)}</div>

<div class="headline">
  <div class="card">
    <div class="label">Layout conformance</div>
    <div class="value layout">${fmtScore(overall.layoutScore)}</div>
    <div class="sub2">${fmtPct(overall.layoutScore)} — mean across ${overall.categoryCount} categor${overall.categoryCount===1?'y':'ies'}</div>
  </div>
  <div class="card">
    <div class="label">Pixel similarity</div>
    <div class="value pixel">${fmtScore(overall.pixelScore)}</div>
    <div class="sub2">${fmtPct(overall.pixelScore)} — mean across ${overall.categoryCount} categor${overall.categoryCount===1?'y':'ies'}</div>
  </div>
  <div class="card">
    <div class="label">Cases</div>
    <div class="value">${overall.caseCount}</div>
    <div class="sub2">${overall.categoryCount} categor${overall.categoryCount===1?'y':'ies'}</div>
  </div>
</div>

<h2>Per-category</h2>
<table>
<thead><tr><th>Category</th><th>n</th><th>Layout</th><th>Pixel</th><th>Worst case</th></tr></thead>
<tbody>${catRows}</tbody>
</table>
<div class="scoring-note">
  <b>Scoring:</b> per case, <code>layout = 0.5·rectFrac + 0.4·styleFrac + 0.1·paintOk</code>
  where <code>rectFrac</code>/<code>styleFrac</code> are the share of elements without a rect/style mismatch
  and <code>paintOk</code> is 1 unless flagged via <code>paint-order.fail</code>. Pixel score = <code>1 − mismatchRatio</code>.
  Category = mean over cases. Overall = mean over categories (equal weight).
</div>

<h2>Top issues</h2>
<ul class="issues">${issuesHtml}</ul>

</div></body></html>`;

  const path = resolve(runDir, "summary.html");
  await writeFile(path, html, "utf8");
  return path;
}
